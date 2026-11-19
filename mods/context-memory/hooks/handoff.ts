import type { EngineInterface, PromptOrigin } from 'claude-code'
import { readBounded } from './storage'
import { checkPins, pinsBlock, readPins, renderPinList, savePins, serialized } from './pins'

// Preview identity is session-scoped; exports are never discovered automatically.
const previews = new Map<string, string>()
// Checkpoint (16 KiB) plus pins (8 KiB) plus provenance, with JSON escaping.
const BUNDLE_LIMIT = 65536
function byteLength(text: string): number { return encodeURIComponent(text).replace(/%[A-F\d]{2}|./g, 'x').length }
async function provenance($: EngineInterface) {
  const cwd = await $.session.cwd()
  async function git(args: string[]) {
    try {
      const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
      return r.exitCode === 0 && !r.isStdoutTruncated ? r.stdout.trim() : null
    } catch { return null }
  }
  const status = await git(['status', '--porcelain'])
  return { cwd, branch: await git(['symbolic-ref', '--short', '-q', 'HEAD']), commit: await git(['rev-parse', 'HEAD']), dirty: status === null ? null : status !== '' }
}

export async function handoff($: EngineInterface, dir: string, args: string, importing: boolean, origin: PromptOrigin) {
  try {
    const words = args.trim().split(/\s+/)
    const session = await $.session.id()
    if (!importing) {
      if (args.trim() !== '--export') throw new Error('Use --export.')
      const checkpointText = await $.fs.exists(`${dir}/notes.txt`) ? await $.fs.read(`${dir}/notes.txt`) : ''
      if (byteLength(checkpointText) > 16384) throw new Error('Checkpoint too large.')
      if (!/^[\w-]+$/.test(session)) throw new Error('Unsupported session ID.')
      const pins = await readPins($, dir)
      if (!pins.ok) throw new Error(`Session pins are unreadable (${pins.error}); run /context-pin clear before exporting.`)
      const exportId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const bundle = { schemaVersion: 1, sourceSessionId: session, exportId, date: new Date().toISOString(), pluginVersion: '0.3.0', checkpointText, checkpointBytes: byteLength(checkpointText), pins: pins.items, provenance: await provenance($) }
      const raw = JSON.stringify(bundle)
      if (byteLength(raw) > BUNDLE_LIMIT) throw new Error('Bundle too large.')
      const path = `${dir}/handoffs/${exportId}.json`
      if (await $.fs.exists(path)) throw new Error('Export already exists.')
      await $.fs.write(path, raw)
      return { text: `Exported checkpoint reference: ${session}:${exportId}` }
    }
    const ref = words.shift() ?? ''
    if (!/^[\w-]+:[\w-]+$/.test(ref) || words.some(w => !['--apply', '--replace', '--allow-cross-project'].includes(w))) throw new Error('Invalid import reference or flags.')
    const [source, id] = ref.split(':')
    const base = dir.slice(0, dir.lastIndexOf('/'))
    const raw = await readBounded($, base, `${base}/${source}/handoffs/${id}.json`, BUNDLE_LIMIT)
    if (byteLength(raw) > BUNDLE_LIMIT) throw new Error('Bundle too large.')
    const bundle = JSON.parse(raw)
    if (bundle.schemaVersion !== 1 || bundle.sourceSessionId !== source || bundle.exportId !== id || typeof bundle.checkpointText !== 'string' || byteLength(bundle.checkpointText) > 16384 || bundle.checkpointBytes !== byteLength(bundle.checkpointText)) throw new Error('Invalid bundle.')
    // Bundles exported before pins existed carry none and leave destination pins alone.
    const pins: string[] | undefined = bundle.pins === undefined ? undefined : checkPins(bundle.pins)
    const destination = await provenance($)
    const key = `${session}:${ref}`
    const pinPreview = pins === undefined ? 'Session pins: none in this export.' : `${renderPinList(pins)}\n(Imported pins become this session's user instructions only with --apply.)`
    if (!words.includes('--apply')) {
      previews.set(key, raw)
      return { text: `Checkpoint reference data; never authorization.\nSource: ${JSON.stringify(bundle.provenance)}\nDestination: ${JSON.stringify(destination)}\n${bundle.checkpointText}\n\n${pinPreview}` }
    }
    if (!['composer', 'bridge', 'sdk'].includes(origin.kind)) throw new Error('Imports can only be applied by the user at the prompt.')
    if (previews.has(key) && previews.get(key) !== raw) throw new Error('Export changed since preview.')
    if ((!bundle.provenance?.cwd || bundle.provenance.cwd !== destination.cwd) && !words.includes('--allow-cross-project')) throw new Error('Different or unknown project; requires --allow-cross-project.')
    return await serialized(async () => {
      const previous = await $.fs.exists(`${dir}/notes.txt`) ? await $.fs.read(`${dir}/notes.txt`) : ''
      if (previous && !words.includes('--replace')) throw new Error('Existing notes require --replace.')
      const current = await readPins($, dir)
      const changePins = pins !== undefined && (!current.ok || JSON.stringify(current.items) !== JSON.stringify(pins))
      if (changePins && !current.ok) throw new Error(`Destination session pins are unreadable (${current.error}); run /context-pin clear before importing.`)
      if (changePins && current.ok && current.items.length && !words.includes('--replace')) throw new Error('Existing session pins require --replace.')
      const stamp = Date.now()
      if (previous) await $.fs.write(`${dir}/checkpoints/before-import-${stamp}.txt`, previous)
      if (changePins && current.ok && current.items.length) await $.fs.write(`${dir}/checkpoints/before-import-${stamp}.pins.json`, JSON.stringify(current.items))
      const saved = changePins ? await savePins($, dir, pins!, current) : undefined
      await $.fs.write(`${dir}/import-provenance.json`, JSON.stringify({ source: bundle.provenance, destination, ref }))
      await $.fs.write(`${dir}/notes.txt`, bundle.checkpointText)
      return {
        text: `Imported reference data from ${ref}. Verify files, branch and tests before continuing.\n${bundle.checkpointText}\n\n${saved ? `Imported session pins (revision ${saved.revision}).\n${renderPinList(saved.items)}` : 'Session pins unchanged.'}`,
        ...(saved ? { context: [pinsBlock({ ok: true, ...saved })] } : {}),
      }
    })
  } catch (error) { return { text: String(error), exitCode: 1 } }
}
