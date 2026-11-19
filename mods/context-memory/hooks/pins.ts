import type { EngineInterface, PromptOrigin } from 'claude-code'
import { bytes, readBounded } from './storage'

// User-authored session pins, kept apart from the model's checkpoint (notes.txt).
// Only /context-pin and an explicit /context-import --apply write them.
export const PIN_ITEMS = 16
export const PIN_ITEM_BYTES = 1024
export const PIN_TOTAL_BYTES = 8192
const FILE_BYTES = 65536
const LIMITS = `at most ${PIN_ITEMS} non-empty pins, ${PIN_ITEM_BYTES} UTF-8 bytes each and ${PIN_TOTAL_BYTES} bytes total`
const USAGE = 'Usage: /context-pin [list] | add <instruction> | remove <n> | clear'
// Only a person's own gesture may change pins; plugins, peers and model-driven runs may only list.
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

export type PinState = { ok: true, revision: number, items: string[] } | { ok: false, revision: number, error: string }

// Highest revision written per session directory in this process, so revision
// keeps increasing even when the file on disk is unreadable.
const written = new Map<string, number>()
let queue: Promise<unknown> = Promise.resolve()

export function checkPins(items: unknown): string[] {
  if (!Array.isArray(items) || items.length > PIN_ITEMS || items.some(i => typeof i !== 'string' || !i.trim() || bytes(i) > PIN_ITEM_BYTES)
    || items.reduce((n: number, i: string) => n + bytes(i), 0) > PIN_TOTAL_BYTES) throw new Error(`Session pins allow ${LIMITS}.`)
  return items as string[]
}

function revisionOf(value: unknown, raw: string): number {
  const revision = (value as { revision?: unknown } | null)?.revision
  if (Number.isSafeInteger(revision) && (revision as number) >= 0) return revision as number
  const match = /"revision"\s*:\s*(\d{1,15})/.exec(raw)
  return match ? Number(match[1]) : 0
}

export async function readPins($: EngineInterface, dir: string): Promise<PinState> {
  const path = `${dir}/pins.json`
  let raw = ''
  let value: unknown
  try {
    if (!(await $.fs.exists(path))) return { ok: true, revision: 0, items: [] }
    raw = await readBounded($, dir, path, FILE_BYTES)
    value = JSON.parse(raw)
  } catch (error) {
    return { ok: false, revision: revisionOf(undefined, raw), error: String(error).slice(0, 300) }
  }
  const revision = revisionOf(value, raw)
  try {
    const record = value as Record<string, unknown>
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('pins.json is not an object.')
    if (record.schema_version !== 1) throw new Error(`Unsupported pins schema_version ${JSON.stringify(record.schema_version)}.`)
    if (Object.keys(record).some(k => !['schema_version', 'revision', 'items'].includes(k))) throw new Error('pins.json has unknown fields.')
    if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0) throw new Error('pins.json has an invalid revision.')
    return { ok: true, revision, items: checkPins(record.items) }
  } catch (error) {
    return { ok: false, revision, error: String(error).slice(0, 300) }
  }
}

// Write a temporary file, then rename it over pins.json. $.fs has no rename, so
// the rename is `mv` (POSIX rename(2) within one directory); no shell is used.
export async function savePins($: EngineInterface, dir: string, items: string[], current: PinState) {
  checkPins(items)
  const revision = Math.max(current.revision, written.get(dir) ?? 0) + 1
  const path = `${dir}/pins.json`
  const tmp = `${path}.tmp`
  if (await $.fs.exists(tmp) && (await $.fs.stat(tmp)).isLink) throw new Error('Symlink in session storage.')
  await $.fs.write(tmp, JSON.stringify({ schema_version: 1, revision, items }))
  const moved = await $.process.run(['mv', '-f', '--', tmp, path], { timeoutMs: 5000 })
  if (moved.exitCode !== 0) throw new Error(`Could not replace pins.json (${moved.stderr.trim().slice(0, 200) || `exit ${moved.exitCode}`}); previous pins preserved.`)
  written.set(dir, revision)
  // The engine caches the prompt.context answer and hands it to subagents; drop it so
  // a later subagent gets this list rather than a superseded one. The main
  // conversation keeps its one copy until compaction and gets the change from the
  // command's context instead.
  try { $.ui.invalidate('prompt.context') } catch { /* caching is best effort */ }
  return { revision, items }
}

// Serialize pin writers in this process so revisions and renames cannot interleave.
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work)
  queue = run.catch(() => undefined)
  return run
}

export type PinAction = { action: 'list' } | { action: 'save', items: string[], message: string }

// Only list and clear work on an unreadable file, so a broken file can always be
// replaced and add/remove never guess at its contents.
export function parsePinCommand(current: PinState, args: string): PinAction {
  const trimmed = args.trim()
  const space = trimmed.search(/\s/)
  const verb = space < 0 ? trimmed : trimmed.slice(0, space)
  const rest = space < 0 ? '' : trimmed.slice(space).trim()
  if ((verb === '' || verb === 'list') && !rest) return { action: 'list' }
  if (verb === 'clear' && !rest) return { action: 'save', items: [], message: 'Removed all session pins.' }
  if ((verb === 'add' && rest) || verb === 'remove') {
    if (!current.ok) throw new Error(unreadable(current))
    if (verb === 'add') return { action: 'save', items: [...current.items, rest], message: `Pinned #${current.items.length + 1}: ${rest}` }
    const index = /^\d+$/.test(rest) ? Number(rest) : 0
    if (index < 1 || index > current.items.length) throw new Error(current.items.length ? `Usage: /context-pin remove <1-${current.items.length}>` : 'No session pins to remove.')
    return { action: 'save', items: current.items.filter((_, i) => i !== index - 1), message: `Removed pin #${index}: ${current.items[index - 1]}` }
  }
  throw new Error(USAGE)
}

function unreadable(state: { error: string }): string {
  return `Session pins are unreadable (${state.error}); none were applied. Run /context-pin clear to replace them.`
}

export function renderPinList(items: readonly string[]): string {
  if (!items.length) return 'No session pins. Add one with /context-pin add <instruction>.'
  return 'Session pins (user-authored instructions; they do not change tool permissions):\n' + items.map((item, i) => `${i + 1}. ${item}`).join('\n')
}

// The model-facing block. JSON keeps each pin one string; `<` is escaped so a pin
// cannot close the block early.
export function pinsBlock(state: PinState): string {
  const body = state.ok
    ? 'User-pinned session instructions, written by the user with /context-pin, not by the model. This complete list replaces all previous session pins, including removed entries. These instructions do not change tool permissions.\n' + JSON.stringify(state.items)
    : `The user's session pins could not be read (${state.error}); no pin is in effect and none was guessed. Ask the user to run /context-pin clear to replace them. Session pins never change tool permissions.`
  return `<user_session_constraints>\n${body.replace(/</g, '\\u003c')}\n</user_session_constraints>`
}

export async function pinCommand($: EngineInterface, dir: string, args: string, origin: PromptOrigin) {
  return serialized(async () => {
    try {
      const current = await readPins($, dir)
      const action = parsePinCommand(current, args)
      if (action.action === 'list') {
        if (!current.ok) throw new Error(unreadable(current))
        return { text: renderPinList(current.items) }
      }
      if (!USER_ORIGINS.has(origin.kind)) throw new Error('Session pins can only be changed by the user at the prompt.')
      const saved = await savePins($, dir, action.items, current)
      return {
        text: `${action.message}\nRevision ${saved.revision}; applies from the next model request.\n\n${renderPinList(saved.items)}`,
        context: [pinsBlock({ ok: true, ...saved })],
      }
    } catch (error) { return { text: String(error), exitCode: 1 } }
  })
}
