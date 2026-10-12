import { useState } from 'react'
import { api, reportError } from './client'
import type { ChatSession } from './types'
import './history-delete.css'

// Deleting a chat from History always asks first. The CLI's own copy of the
// conversation on this computer is removed only when the box is ticked.
export default function HistoryDelete({ item, agent }: { item: ChatSession; agent: string }) {
  const [confirming, setConfirming] = useState(false)
  const [native, setNative] = useState(false)
  const [busy, setBusy] = useState(false)
  const cli = item.agent === 'claude' || item.agent === 'codex'
  const remove = async () => {
    setBusy(true)
    // On success the service announces the removal and this row disappears.
    try { await api(`/sessions/${item.id}/delete`, { native: cli && native }) } catch (error) { setBusy(false); reportError(error) }
  }
  return <>
    <button className={`desk-icon history-delete ${confirming ? 'active' : ''}`} aria-label={`Delete ${item.name}`} title="Delete from History" onClick={() => { setConfirming(!confirming); setNative(false) }}>
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
    </button>
    {confirming && <div className="history-confirm" role="group" aria-label={`Delete ${item.name}`}>
      <p>Delete “{item.name}” from History?{item.open ? ' Its tab closes and the agent stops.' : ''} The saved screen is removed for good.</p>
      {cli ? <label><input type="checkbox" checked={native} disabled={busy} onChange={event => setNative(event.target.checked)} /><span>Also delete the {agent} conversation on this computer<small>Its transcript, file snapshots and prompts in the CLI history. This cannot be undone.</small></span></label>
        : item.agent !== 'shell' && <p className="history-note">{agent} keeps its own copy of the conversation. Delete it with that CLI.</p>}
      {item.agent !== 'shell' && <p className="history-note">What the provider already received stays on its servers. Change any password that was sent.</p>}
      <div><button className="history-confirm-delete" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button><button disabled={busy} onClick={() => setConfirming(false)}>Cancel</button></div>
    </div>}
  </>
}
