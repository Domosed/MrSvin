import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ExtraProps } from 'react-markdown'
import { api, reportError } from './client'
import { Icon } from './Icons'
import { fileManager } from './platform'

// A button that shows a mentioned file in Explorer, with the file selected, or
// opens a mentioned folder. The service resolves paths against the chat folder,
// and only paths that exist get the button.

type Found = Record<string, 'file' | 'folder'>
const Paths = createContext<{ sessionId: string; found: Found; check: (path: string) => void } | null>(null)

// Asks the service once, in batches, which of the mentioned paths exist.
export function PathProvider({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const [found, setFound] = useState<Found>({})
  const asked = useRef(new Set<string>()), queue = useRef(new Set<string>()), timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const check = useCallback((path: string) => {
    if (asked.current.has(path)) return
    asked.current.add(path); queue.current.add(path)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const paths = [...queue.current].slice(0, 300); queue.current.clear()
      api<{ found: Found }>('/paths/check', { sessionId, paths })
        .then(result => { if (Object.keys(result.found).length) setFound(current => ({ ...current, ...result.found })) })
        .catch(() => { for (const path of paths) asked.current.delete(path) })
    }, 80)
  }, [sessionId])
  const value = useMemo(() => ({ sessionId, found, check }), [sessionId, found, check])
  return <Paths.Provider value={value}>{children}</Paths.Provider>
}

export function PathReveal({ path }: { path: string }) {
  const paths = useContext(Paths), check = paths?.check
  useEffect(() => { check?.(path) }, [check, path])
  const kind = paths?.found[path]
  if (!paths || !kind) return null
  const label = `Show ${kind === 'folder' ? 'folder' : 'file'} in ${fileManager}`
  return <button type="button" className="path-reveal" title={`${label}\n${path}`} aria-label={`${label}: ${path}`}
    onClick={event => { event.preventDefault(); event.stopPropagation(); api('/reveal', { path, sessionId: paths.sessionId }).catch(reportError) }}><Icon name="folder" size={12} /></button>
}

// Markdown elements that remarkPaths marked with data-path.
type Marked<T> = T & ExtraProps & { 'data-path'?: string }
export function PathSpan(props: Marked<React.ComponentProps<'span'>>) {
  const { node, 'data-path': path, children, ...rest } = props
  void node
  return <span {...rest}>{children}{path && <PathReveal path={path} />}</span>
}
export function PathCode(props: Marked<React.ComponentProps<'code'>>) {
  const { node, 'data-path': path, ...rest } = props
  void node
  return path ? <><code {...rest} /><PathReveal path={path} /></> : <code {...rest} />
}
