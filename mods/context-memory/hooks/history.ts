import type { EngineInterface } from 'claude-code'
import { readBounded } from './storage'

const PAGE = 12000
export function pageEnd(text: string, start: number): number {
  let end = Math.min(start + PAGE, text.length)
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--
  return end
}

export async function writeFull($: EngineInterface, dir: string, id: string, text: string) {
  if (text.length <= 32768) return { status: 'inline', totalChars: text.length, chunks: [] }
  const chunks: { index: number, offset: number, length: number }[] = []
  try {
    for (let offset = 0; offset < text.length;) {
      const end = pageEnd(text, offset)
      if (chunks.length >= 10000) throw new Error('Full text exceeds 10000 chunks.')
      const index = chunks.length
      await $.fs.write(`${dir}/history-text/${id}/${String(index).padStart(12, '0')}.txt`, text.slice(offset, end))
      chunks.push({ index, offset, length: end - offset })
      offset = end
    }
    return { status: 'complete', totalChars: text.length, chunks }
  } catch (error) {
    return { status: 'unavailable', totalChars: text.length, chunks: [], error: String(error).slice(0, 500) }
  }
}

export async function readFull($: EngineInterface, dir: string, id: string, rawOffset: unknown) {
  const record = JSON.parse(await readBounded($, dir, `${dir}/history/${id}.json`, 1048576))
  if (record.id !== id || typeof record.text !== 'string' || record.text.length > 32768) throw new Error('Invalid record.')
  const meta = record.fullText
  const complete = meta?.status === 'complete' || meta?.status === 'inline' || (!meta && !record.truncated)
  if (!complete) throw new Error(meta ? 'Full text unavailable.' : 'legacy_truncated')
  const total = meta?.totalChars ?? record.text.length
  const offset = rawOffset ?? 0
  if (!Number.isSafeInteger(total) || total < 0 || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > total) throw new Error('Invalid offset or length.')
  let text: string
  if (meta?.status === 'complete') {
    if (!Array.isArray(meta.chunks) || meta.chunks.length > Math.ceil(total / 11999)) throw new Error('Invalid chunks.')
    let cursor = 0
    for (const [index, chunk] of meta.chunks.entries()) {
      if (chunk.index !== index || chunk.offset !== cursor || !Number.isInteger(chunk.length) || chunk.length < 1 || chunk.length > PAGE) throw new Error('Invalid chunks.')
      cursor += chunk.length
    }
    if (cursor !== total) throw new Error('Incomplete chunks.')
    text = ''
    for (const chunk of meta.chunks) {
      if (chunk.offset + chunk.length <= offset || chunk.offset >= offset + PAGE) continue
      const value = await readBounded($, dir, `${dir}/history-text/${id}/${String(chunk.index).padStart(12, '0')}.txt`, 48000)
      if (value.length !== chunk.length) throw new Error('Invalid chunk length.')
      text += value.slice(Math.max(0, offset - chunk.offset))
    }
  } else {
    if (total !== record.text.length) throw new Error('Invalid inline length.')
    text = record.text.slice(offset)
  }
  if (/^[\uDC00-\uDFFF]/.test(text)) throw new Error('Offset splits a surrogate pair.')
  text = text.slice(0, pageEnd(text, 0))
  return { id, text, offset, totalChars: total, complete: true, nextOffset: offset + text.length < total ? offset + text.length : null }
}
