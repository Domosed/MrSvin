import { useEffect, useRef, useState } from 'react'
import { api, reportError } from './client'
import type { ChatSession } from './types'
import './app-menu.css'

// The app menu in the Chats header. A restart saves every chat first, and the
// app reopens them with their conversations.
export default function AppMenu({ chats }: { chats: ChatSession[] }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => { setOpen(false); setConfirming(false) }
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('mousedown', outside); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('keydown', escape) }
  }, [open])
  const working = chats.filter(item => item.status === 'running' && item.activity === 'working').length
  const restart = async () => {
    setRestarting(true)
    // On success the app closes this window; the label stays until then.
    try { await api('/restart', {}) } catch (error) { setRestarting(false); reportError(error) }
  }
  return <div className="app-menu" ref={root}>
    <button className={`desk-icon ${open ? 'active' : ''}`} title="Menu" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open); setConfirming(false) }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
    {open && <div className="app-menu-list" role="menu">
      {confirming ? <div className="app-menu-confirm" role="group" aria-label="Restart">
        <p>Open chats are saved and reopen with their conversations.</p>
        {working > 0 && <p className="app-menu-warning">{working === 1 ? '1 chat is' : `${working} chats are`} still working. A restart stops the current reply, and it does not continue by itself.</p>}
        <div><button className="app-menu-go" disabled={restarting} onClick={restart}>{restarting ? 'Restarting…' : 'Restart now'}</button><button disabled={restarting} onClick={() => setConfirming(false)}>Cancel</button></div>
      </div> : <button role="menuitem" onClick={() => setConfirming(true)}>Save all chats and restart</button>}
    </div>}
  </div>
}
