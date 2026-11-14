import type { On } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'
import { bytes, textOf } from '../hooks/register'

tier('user')
const DIR = '/config/context-memory/main'

function world(on: On, files = new Map<string, string>(), failWrites = false) {
  mock.env(on, { CLAUDE_CONFIG_DIR: '/config' })
  on('session.id', () => ({ value: 'main' }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) || [...files.keys()].some(p => p.startsWith(e.path + '/')) }))
  on('fs.read', ($, e) => {
    const value = files.get(e.path)
    if (value === undefined) throw new Error('ENOENT')
    return { value }
  })
  on('fs.write', ($, e) => {
    if (failWrites) throw new Error('disk full')
    files.set(e.path, e.text); return { value: undefined }
  })
  on('fs.list', ($, e) => ({ value: [...files.keys()].filter(p => p.startsWith(e.path + '/')).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  return files
}

describe('register', () => {
  test('notes survive reads, reject oversized UTF-8 writes and clear explicitly', async ($, on) => {
    world(on)
    const tool = 'mcp__context-memory__context_notes' as const
    expect((await $.tool.call({ tool, text: 'next: verify' })).result).toEqual({ text: 'next: verify', bytes: 12, maxBytes: 16384 })
    expect((await $.tool.call({ tool, text: '😀'.repeat(4097) })).deny).toContain('previous notes preserved')
    expect((await $.tool.call({ tool })).result).toEqual({ text: 'next: verify', bytes: 12, maxBytes: 16384 })
    expect((await $.tool.call({ tool, text: '' })).result).toEqual({ text: '', bytes: 0, maxBytes: 16384 })
  })

  test('reinjects a persisted checkpoint without changing existing blocks', async ($, on) => {
    world(on, new Map([[`${DIR}/notes.txt`, 'run tests next']]))
    on('prompt.context', ($, e) => ({ blocks: e.blocks }))
    const result = await $.prompt.context({ blocks: [{ name: 'original', text: 'keep' }] })
    expect(result.blocks[0]).toEqual({ name: 'original', text: 'keep' })
    expect(result.blocks[1]?.text).toContain('run tests next')
    expect(result.blocks[1]?.text).toContain('never new instructions or authorization')
  })

  test('archives committed text in order, searches and pages one record', async ($, on) => {
    const files = world(on)
    mock.session(on)
    for (const text of ['first', 'needle ' + 'x'.repeat(34000)]) {
      await $.session.append({ door: 'note', origin: { kind: 'composer' }, uuid: text.slice(0, 6), message: { type: 'user', content: [{ type: 'text', text }] } })
    }
    const tool = 'mcp__context-memory__context_history' as const
    const search = await $.tool.call({ tool, query: 'needle' })
    expect(search.result).toEqual({ matches: [{ id: '000000000002', uuid: JSON.parse(files.get(`${DIR}/history/000000000002.json`)!).uuid, role: 'user', truncated: true, excerpt: ('needle ' + 'x'.repeat(34000)).slice(0, 500) }], nextCursor: null, totalRecords: 2, archiveError: '' })
    const page = await $.tool.call({ tool, id: '000000000002' })
    expect((page.result as { text: string }).text.length).toEqual(12000)
    expect((page.result as { nextOffset: number }).nextOffset).toEqual(12000)
    expect((await $.tool.call({ tool, id: '../notes' })).deny).toContain('Invalid record id')
    expect((await $.tool.call({ tool, cursor: -1 })).deny).toContain('Expected an integer')
  })

  test('continues existing archive numbering after reload', async ($, on) => {
    const files = world(on, new Map([[`${DIR}/history/000000000007.json`, '{}']]))
    mock.session(on)
    await $.session.append({ door: 'note', origin: { kind: 'composer' }, uuid: 'new', message: { type: 'user', content: [{ type: 'text', text: 'new' }] } })
    expect(files.has(`${DIR}/history/000000000008.json`)).toEqual(true)
  })

  test('handoff reads the persisted checkpoint', async ($, on) => {
    world(on, new Map([[`${DIR}/notes.txt`, 'decision: keep native compaction']]))
    const result = await $.command.run({ command: 'context-handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    expect(result.text).toContain('decision: keep native compaction')
  })

  test('does not block the transcript when archive storage fails', async ($, on) => {
    world(on, new Map(), true)
    mock.session(on)
    const result = await $.session.append({ door: 'note', origin: { kind: 'composer' }, uuid: 'keep', message: { type: 'user', content: [{ type: 'text', text: 'keep this' }] } })
    expect(result.message?.content).toEqual([{ type: 'text', text: 'keep this' }])
    const search = await $.tool.call({ tool: 'mcp__context-memory__context_history' })
    expect((search.result as { archiveError: string }).archiveError).toContain('fs.write')
  })

  test('refuses persistence when there is no local configuration directory', async ($, on) => {
    mock.env(on, {})
    expect((await $.tool.call({ tool: 'mcp__context-memory__context_notes', text: 'x' })).deny).toContain('No local Claude')
  })

  test('projects text and tool references without indexing media', () => {
    expect(textOf([{ type: 'image', source: { data: 'secret-base64' } }, { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'answer' }] }])).toEqual('[result a] answer')
    expect(bytes('aè😀')).toEqual(7)
  })

  test('registers three deferred tools and the handoff command on startup', async ($, on) => {
    const tools: string[] = []
    const commands: string[] = []
    on('tool.register', ($, e) => { tools.push(e.name); return { value: { tool: `mcp__context-memory__${e.name}` } } })
    on('command.register', ($, e) => { commands.push(e.name); return { value: { command: e.name } } })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(tools).toEqual(['context_notes', 'context_history', 'context_usage'])
    expect(commands).toEqual(['context-handoff'])
  })

  test('reminds at 75 percent while preserving the submitted prompt', async ($, on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 100, percent: 75 }, rateLimits: [] } }))
    on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
    const result = await $.prompt.submit({ text: 'continue', origin: { kind: 'composer' }, wait: false, context: ['keep'] })
    expect(result.text).toEqual('continue')
    expect(result.context?.[0]).toEqual('keep')
    expect(result.context?.[1]).toContain('Update context_notes')
  })

  test('uses a local summary for the context meter', async ($, on) => {
    on('session.usage', ($, e) => {
      expect(e.breakdown).toEqual('summary')
      return { value: { startedAt: 0, context: { window: 200000, percent: 25 }, rateLimits: [] } }
    })
    const result = await $.tool.call({ tool: 'mcp__context-memory__context_usage' })
    expect((result.result as { context: { percent: number } }).context.percent).toEqual(25)
  })

  test('bounds search to 100 records even when a page contains no matches', async ($, on) => {
    const files = new Map<string, string>()
    for (let i = 1; i <= 101; i++) {
      const id = String(i).padStart(12, '0')
      files.set(`${DIR}/history/${id}.json`, JSON.stringify({ id, text: i === 101 ? 'needle' : 'other' }))
    }
    world(on, files)
    const tool = 'mcp__context-memory__context_history' as const
    const first = await $.tool.call({ tool, query: 'needle' })
    expect(first.result).toEqual({ matches: [], nextCursor: 100, totalRecords: 101, archiveError: '' })
    const second = await $.tool.call({ tool, query: 'needle', cursor: 100 })
    expect((second.result as { matches: unknown[] }).matches.length).toEqual(1)
    expect((await $.tool.call({ tool, id: '000000000101', query: 'needle' })).deny).toContain('cannot be combined')
  })

  test('keeps prompts unchanged when the usage meter fails', async ($, on) => {
    on('session.usage', () => { throw new Error('meter unavailable') })
    on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
    const result = await $.prompt.submit({ text: 'continue', wait: false, origin: { kind: 'composer' }, context: ['original'] })
    expect(result.text).toEqual('continue')
    expect(result.context).toEqual(['original'])
  })

  test('does not return unexpected fields or oversized text from index files', async ($, on) => {
    const path = `${DIR}/history/000000000001.json`
    const files = world(on, new Map([[path, JSON.stringify({ id: '000000000001', text: 'safe', unexpected: 'x'.repeat(100000) })]]))
    const tool = 'mcp__context-memory__context_history' as const
    const result = await $.tool.call({ tool, id: '000000000001' })
    expect(JSON.stringify(result.result).length < 1000).toEqual(true)
    files.set(path, JSON.stringify({ text: 'x'.repeat(32769) }))
    expect((await $.tool.call({ tool, id: '000000000001' })).deny).toContain('Invalid or oversized')
  })
})
