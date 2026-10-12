import { useEffect, useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { mobileApi, mobileEvent, onMobileEvent, useMobile } from './client'

export default function Terminal({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null), terminalRef = useRef<Xterm | null>(null)
  const state = useMobile(), [error, setError] = useState('')
  useEffect(() => {
    if (!host.current) return
    const element = host.current
    const terminal = new Xterm({ disableStdin: true, cursorBlink: false, fontSize: 12, lineHeight: 1.25, fontFamily: 'ui-monospace, monospace', scrollback: 3000, theme: { background: '#101116', foreground: '#dedbe3', cursor: '#c4a7b8' } })
    terminal.loadAddon(new WebLinksAddon((event, text) => { event.preventDefault(); try { const url = new URL(text); if (['http:', 'https:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer') } catch { /* Invalid terminal link. */ } }))
    terminal.open(element); terminalRef.current = terminal
    let ready = false, sequence = -1, queued: { data: string; sequence: number }[] = [], generation = 0
    const subscribe = () => { ready = false; generation++; queued = []; mobileEvent({ type: 'subscribe', id }) }
    const off = onMobileEvent(event => {
      if (event.type === 'connected' || (['screen-cleared', 'terminal-resized'].includes(event.type) && event.id === id)) subscribe()
      if (event.type === 'disconnected') ready = false
      if (event.type === 'snapshot' && event.session?.id === id) {
        const current = generation; sequence = event.sequence || 0
        terminal.reset(); terminal.resize(event.session.cols, event.session.rows)
        element.style.width = `${Math.ceil(event.session.cols * 7.3 + 16)}px`
        element.style.height = `${Math.ceil(event.session.rows * 15 + 5)}px`
        terminal.write(event.data || '', () => { if (current !== generation) return; for (const chunk of queued) if (chunk.sequence > sequence) { terminal.write(chunk.data); sequence = chunk.sequence }; queued = []; ready = true })
      }
      if (event.type === 'output' && event.id === id) {
        if (!ready) { queued.push({ data: event.data || '', sequence: event.sequence || 0 }); return }
        if ((event.sequence || 0) > sequence) { terminal.write(event.data || ''); sequence = event.sequence || 0 }
      }
    })
    subscribe()
    return () => { generation++; off(); terminal.dispose(); terminalRef.current = null }
  }, [id])
  async function key(value: string) {
    if (value === 'interrupt' && !window.confirm('Interrupt the current task in this chat?')) return
    try { await mobileApi(`/sessions/${id}/key`, { key: value }); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <div className="mobile-terminal"><div className="mobile-terminal-hint">Live terminal · swipe sideways for wide lines</div><div className="mobile-terminal-viewport"><div ref={host} /></div><div className="mobile-terminal-keys" role="group" aria-label="Terminal keys">{[['left', '←', 'Arrow left'], ['up', '↑', 'Arrow up'], ['down', '↓', 'Arrow down'], ['right', '→', 'Arrow right'], ['escape', 'Esc', 'Escape'], ['enter', 'Enter', 'Enter'], ['tab', 'Tab', 'Tab'], ['interrupt', 'Stop', 'Stop task']].map(([value, label, name]) => <button key={value} aria-label={name} title={name} disabled={!state.connected} onClick={() => key(value)}>{label}</button>)}<button onClick={async () => { const term = terminalRef.current; if (!term) return; const buffer = term.buffer.active; const lines = []; for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) || ''); try { await navigator.clipboard.writeText(term.getSelection() || lines.join('\n')); setError('') } catch { setError('Copy is unavailable in this browser.') } }}>Copy</button></div>{error && <p className="mobile-error" role="alert">{error}</p>}</div>
}
