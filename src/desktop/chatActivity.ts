import type { ChatSession } from './types'

// What the chat needs from its user: an answer, a permission, or a look at the terminal.
export function chatRequest(session: ChatSession) {
  return session.waitingFor || (session.status === 'running' && session.activity === 'waiting' ? 'attention' : null)
}

export function chatActivityLabel(session: ChatSession) {
  const working = session.status === 'running' && session.activity === 'working'
  const request = chatRequest(session)
  if (request === 'question') return working ? 'Working · asks a question' : 'Waiting for your answer'
  if (request === 'permission') return 'Waiting for your permission'
  if (session.unread) return working ? 'Working · unread result' : 'Finished · unread result'
  if (working) return 'Working'
  if (session.status !== 'running') return session.status === 'starting' ? 'Starting' : 'Stopped'
  if (request) return 'Needs attention · check terminal'
  return ['codex', 'claude', 'opencode'].includes(session.agent) ? 'Ready' : 'Terminal open'
}
