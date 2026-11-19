import type { EngineInterface } from 'claude-code'

// Count UTF-8 bytes without requiring Node or sandbox globals.
export function bytes(text: string): number {
  let size = 0
  for (const c of text) {
    const n = c.codePointAt(0)!
    size += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4
  }
  return size
}

// Bound whole-file reads and reject symlinks below the trusted session root.
// Stat/read is not atomic; another local process can still race these checks.
export async function readBounded($: EngineInterface, base: string, path: string, maxBytes: number) {
  if (!path.startsWith(base + '/')) throw new Error('Path outside session storage.')
  let current = base
  for (const part of path.slice(base.length + 1).split('/')) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid storage path.')
    current += '/' + part
    const stat = await $.fs.stat(current)
    if (stat.isLink) throw new Error('Symlink in session storage.')
    if (current === path && (stat.kind !== 'file' || stat.size > maxBytes)) throw new Error('Oversized or invalid storage file.')
  }
  return $.fs.read(path)
}
