import type { IBufferLine, IDecoration, ILink, ILinkProvider, IMarker, Terminal } from '@xterm/xterm'

// File and folder paths in an agent's terminal: a click shows the file in
// Explorer, and a folder icon on the first free cell after an existing path
// does the same. Absolute Windows paths are always links; relative ones, such as
// .cache\backup or src/app.ts, count only when they exist in the chat folder.

export type PathKinds = Record<string, 'file' | 'folder'>
type Cell = { x: number; y: number }
type Line = { text: string; cells: Cell[] }
type Mention = { index: number; length: number; path: string; absolute: boolean }

const windowsPath = /(?<![\p{L}\p{N}_\\/])[A-Za-z]:[\\/][^\s"'<>|*?`]*[^\s"'<>|*?`.,;:!)\]}»]/gu
const relativePath = /(?<![\p{L}\p{N}_.\\/:~-])(?:\.{1,2}[\\/])?(?:[\p{L}\p{N}_.-]+[\\/])+[\p{L}\p{N}_-][\p{L}\p{N}_.-]*[\\/]?/gu

// A :line or :line:column suffix points inside the file; closing punctuation is not part of the path.
export function terminalMentions(text: string): Mention[] {
  const found: Mention[] = []
  for (const match of text.matchAll(windowsPath)) found.push({ index: match.index ?? 0, length: match[0].length, path: match[0].replace(/:\d+(?::\d+)?$/, ''), absolute: true })
  for (const match of text.matchAll(relativePath)) {
    const value = match[0].replace(/[.,;:]+$/, ''), index = match.index ?? 0
    if (found.some(item => index < item.index + item.length && item.index < index + value.length)) continue
    if (value.length > 2 && !/^\d+[\\/]\d+$/.test(value)) found.push({ index, length: value.length, path: value, absolute: false })
  }
  return found
}

// The text of one row and the cell of each UTF-16 code unit; a wide character's second cell has no text.
function row(line: IBufferLine, cols: number, y: number, into: Line) {
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x)
    if (!cell || cell.getWidth() === 0) continue
    const chars = cell.getChars() || ' '
    for (let index = 0; index < chars.length; index++) into.cells.push({ x, y })
    into.text += chars
  }
}

// A long path wraps onto the next rows: read the whole logical line around row y.
function logicalLine(terminal: Terminal, y: number) {
  const buffer = terminal.buffer.active
  let first = y, last = y
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--
  while (last - first < 50 && buffer.getLine(last + 1)?.isWrapped) last++
  const line: Line = { text: '', cells: [] }
  for (let index = first; index <= last; index++) { const part = buffer.getLine(index); if (part) row(part, terminal.cols, index, line) }
  return { line, first, last }
}

// Asks which paths exist, once per path; a missing path is asked again after ten seconds.
export function pathChecker(ask: (paths: string[]) => Promise<PathKinds>) {
  const known = new Map<string, { kind: 'file' | 'folder' | null; at: number }>()
  return async (paths: string[]): Promise<PathKinds> => {
    const now = Date.now(), unknown = [...new Set(paths)].filter(path => { const item = known.get(path); return !item || (!item.kind && now - item.at > 10000) })
    if (unknown.length) {
      const found = await ask(unknown.slice(0, 300)).catch(() => null)
      if (found) for (const path of unknown.slice(0, 300)) known.set(path, { kind: found[path] || null, at: now })
    }
    return Object.fromEntries(paths.flatMap(path => { const kind = known.get(path)?.kind; return kind ? [[path, kind]] : [] }))
  }
}

export function terminalPathLinks(terminal: Terminal, check: (paths: string[]) => Promise<PathKinds>, open: (path: string) => void): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const current = y - 1, { line } = logicalLine(terminal, current)
      const mentions = terminalMentions(line.text).filter(item => {
        const start = line.cells[item.index], end = line.cells[item.index + item.length - 1]
        return start && end && end.y >= current && start.y <= current
      })
      if (!mentions.length) { callback(undefined); return }
      void check(mentions.filter(item => !item.absolute).map(item => item.path)).then(found => {
        const links: ILink[] = mentions.filter(item => item.absolute || found[item.path]).map(item => {
          const start = line.cells[item.index], end = line.cells[item.index + item.length - 1]
          return { text: line.text.slice(item.index, item.index + item.length), range: { start: { x: start.x + 1, y: start.y + 1 }, end: { x: end.x + 1, y: end.y + 1 } }, decorations: { pointerCursor: true, underline: true }, activate: () => open(item.path) }
        })
        callback(links.length ? links : undefined)
      })
    },
  }
}

const folderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3Z"/></svg>'

// Folder icons for the existing paths on screen. Each sits on the first blank
// cell after its path (past closing punctuation), so it never covers text.
export function terminalPathIcons(terminal: Terminal, check: (paths: string[]) => Promise<PathKinds>, open: (path: string) => void) {
  let icons: { marker: IMarker; decoration: IDecoration; x: number; path: string }[] = []
  let disposed = false, scanning = false, again = false
  const drop = (keep: (icon: typeof icons[number]) => boolean) => {
    icons = icons.filter(icon => { if (keep(icon) && !icon.marker.isDisposed) return true; icon.decoration.dispose(); icon.marker.dispose(); return false })
  }
  // Two free cells give a larger icon.
  const blankAfter = (end: Cell): (Cell & { width: number }) | null => {
    const line = terminal.buffer.active.getLine(end.y), blank = (x: number) => x < terminal.cols && !(line?.getCell(x)?.getChars() || '').trim()
    for (let x = end.x + 1; x <= end.x + 3 && x < terminal.cols; x++) {
      if (blank(x)) return { x, y: end.y, width: blank(x + 1) ? 2 : 1 }
      if (!/^[.,;:!?)\]}»"'`]$/.test(line?.getCell(x)?.getChars() || '')) return null
    }
    return null
  }
  const add = (spot: Cell & { width: number }, path: string) => {
    const buffer = terminal.buffer.active
    const marker = terminal.registerMarker(spot.y - (buffer.baseY + buffer.cursorY))
    const decoration = marker && terminal.registerDecoration({ marker, x: spot.x, width: spot.width, layer: 'top' })
    if (!marker || !decoration) { marker?.dispose(); return }
    decoration.onRender(element => {
      if (element.dataset.path === path) return
      element.dataset.path = path; element.dataset.column = String(spot.x)
      // xterm positions the element through its own xterm-decoration class.
      element.classList.add('terminal-path-icon')
      element.title = `Show in Explorer\n${path}`
      element.setAttribute('role', 'button'); element.setAttribute('aria-label', `Show in Explorer: ${path}`)
      element.innerHTML = folderIcon
      const stop = (event: Event) => { event.preventDefault(); event.stopPropagation() }
      element.addEventListener('mousedown', stop); element.addEventListener('mouseup', stop)
      element.addEventListener('click', event => { stop(event); open(path) })
    })
    icons.push({ marker, decoration, x: spot.x, path })
  }
  const scan = async () => {
    if (disposed) return
    if (scanning) { again = true; return }
    scanning = true
    try {
      const buffer = terminal.buffer.active, top = buffer.viewportY, bottom = top + terminal.rows - 1, type = buffer.type
      const wanted: { spot: Cell & { width: number }; path: string }[] = [], candidates: { end: Cell; path: string }[] = []
      for (let y = top; y <= bottom;) {
        const { line, last } = logicalLine(terminal, y)
        for (const item of terminalMentions(line.text)) {
          const end = line.cells[item.index + item.length - 1]
          if (end && end.y >= top && end.y <= bottom) candidates.push({ end, path: item.path })
        }
        y = Math.max(y, last) + 1
      }
      const found = await check(candidates.map(item => item.path))
      if (disposed || terminal.buffer.active.type !== type || terminal.buffer.active.viewportY !== top) { again = true; return }
      for (const { end, path } of candidates) { const spot = found[path] && blankAfter(end); if (spot) wanted.push({ spot, path }) }
      const same = (icon: typeof icons[number], item: typeof wanted[number]) => icon.marker.line === item.spot.y && icon.x === item.spot.x && icon.path === item.path
      // Rows on screen may have been redrawn; icons in the scrollback stay.
      drop(icon => icon.marker.line < top || icon.marker.line > bottom || wanted.some(item => same(icon, item)))
      for (const item of wanted) if (!icons.some(icon => same(icon, item))) add(item.spot, item.path)
      // The oldest icons go first.
      let excess = icons.length - 300
      if (excess > 0) drop(() => excess-- <= 0)
    } finally {
      scanning = false
      if (again && !disposed) { again = false; window.setTimeout(() => void scan(), 100) }
    }
  }
  return { scan, clear: () => drop(() => false), dispose: () => { disposed = true; drop(() => false) } }
}

// An OSC 8 hyperlink to a local file, such as file:///C:/Projects/x.blend.
export function fileUrlPath(url: URL) {
  if (url.protocol !== 'file:') return null
  const path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1')
  return url.host ? `\\\\${url.host}${path.replace(/\//g, '\\')}` : path
}
