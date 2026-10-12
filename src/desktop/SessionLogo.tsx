import { AgentLogo } from './Icons'
import { chatActivityLabel, chatRequest } from './chatActivity'
import type { ChatSession } from './types'
import './session-request.css'

export default function SessionLogo({ session, size = 17 }: { session: ChatSession; size?: number }) {
  const working = session.status === 'running' && session.activity === 'working'
  const request = chatRequest(session)
  return <span className={`session-logo ${working ? 'is-working' : ''}`} style={{ width: size, height: size }} title={chatActivityLabel(session)} aria-hidden="true">
    <AgentLogo agent={session.agent} size={size} />
    {request ? <i className="session-waiting">{request === 'question' ? '?' : '!'}</i> : session.unread && <i className="session-unread" />}
  </span>
}
