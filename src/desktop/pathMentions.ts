// Files and folders an agent's answer mentions: links, paths in `code` and paths
// in the text. remarkPaths marks them with data-path for PathReveal.

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: { hName?: string; hProperties?: Record<string, unknown> } }

// A :line or :line:column suffix, or a #L anchor, points inside the file.
export const pathOf = (text: string) => text.trim().replace(/#L\d+.*$/, '').replace(/:\d+(?::\d+)?$/, '')
// Absolute Windows paths, and relative ones with a folder and a file extension.
const tick = '`'
const absolute = String.raw`[A-Za-z]:[\\/][^\s"'<>|*?${tick}]*[^\s"'<>|*?${tick}.,;:!)\]}»]`
const relative = String.raw`(?:\.{1,2}[\\/])?(?:[\p{L}\p{N}_.-]+[\\/])+[\p{L}\p{N}_.-]*\.[\p{L}\p{N}]{1,10}`
const mention = new RegExp(String.raw`(?<![\p{L}\p{N}_.\\/:-])(?:${absolute}|${relative})(?:(?::\d+){1,2})?(?![\p{L}\p{N}_\\/])`, 'gu')

// `code` that holds only a path; an absolute one may contain spaces.
export function codePath(value: string) {
  const text = value.trim()
  if (/^[A-Za-z]:[\\/][^<>|*?"\n]*$/.test(text)) return pathOf(text)
  if (!text.includes('://') && /^(?:\.{1,2}[\\/])?[^\s<>|*?"':]+[\\/][^\s<>|*?"]*$/u.test(text)) return pathOf(text)
  return null
}

function splitText(value: string): MdNode[] {
  const parts: MdNode[] = []
  let last = 0
  for (const match of value.matchAll(mention)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', value: value.slice(last, index) })
    parts.push({ type: 'text', value: match[0], data: { hName: 'span', hProperties: { 'data-path': pathOf(match[0]) } } })
    last = index + match[0].length
  }
  if (!parts.length) return [{ type: 'text', value }]
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) })
  return parts
}

function mark(node: MdNode) {
  // Links show their own button; code blocks are not scanned.
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return
  node.children = node.children.flatMap(child => {
    if (child.type === 'text' && child.value) return splitText(child.value)
    const path = child.type === 'inlineCode' && child.value ? codePath(child.value) : null
    if (path) child.data = { ...child.data, hProperties: { ...child.data?.hProperties, 'data-path': path } }
    mark(child)
    return [child]
  })
}

// Remark plugin for answers: marks path mentions with data-path.
export const remarkPaths = () => (tree: MdNode) => { mark(tree) }

// Markdown drops a backslash before punctuation, so S:\Game\.cache would read
// S:\Game.cache. Outside code, the backslashes of a Windows path are escaped.
const drivePath = new RegExp(String.raw`[A-Za-z]:\\[^\s"'<>|*?${tick}]*`, 'g')
export function keepPathSlashes(text: string) {
  let fence = ''
  return text.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) { fence = fence ? '' : marker; return line }
    if (fence) return line
    // Odd parts are inline code, between runs of backticks.
    return line.split(/(`+[^`]*`+)/).map((part, index) => index % 2 ? part : part.replace(drivePath, path => path.replace(/\\(?=[!-/:-@[\]^_`{-~])/g, '\\\\'))).join('')
  }).join('\n')
}
