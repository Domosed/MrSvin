import { useCallback, useEffect, useRef, useState } from 'react'
import { api, openWebLink } from './client'
import { Icon } from './Icons'
import type { AgentInfo, ClaudeUsage, Usage, UsageLimit } from './types'
import './usage.css'

function resets(limit: UsageLimit, agent: string, now: number) {
  if (limit.reset || !limit.resetsAt) return `Reset · updates after the next ${agent} reply`
  const minutes = Math.max(1, Math.round((limit.resetsAt * 1000 - now) / 60000))
  if (minutes >= 24 * 60) return `Resets ${new Date(limit.resetsAt * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
  return `Resets in ${minutes >= 60 ? `${Math.floor(minutes / 60)} h ` : ''}${minutes % 60} min`
}

function updated(at: string, now: number) {
  const minutes = Math.floor((now - Date.parse(at)) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Meter({ label, limit, agent, now }: { label: string; limit: UsageLimit; agent: string; now: number }) {
  const used = Math.round(limit.usedPercentage)
  return <div className={`usage-meter ${used >= 95 ? 'high' : used >= 80 ? 'warn' : ''}`}>
    <div className="usage-meter-label"><span>{label}</span><strong>{used}%</strong></div>
    <div className="usage-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, used)}><i style={{ width: `${Math.min(100, used)}%` }} /></div>
    <small>{resets(limit, agent, now)}</small>
  </div>
}

function Provider({ name, color, usage, weekly, empty, site, url, now }: { name: string; color: string; usage: Usage; weekly: string; empty: string; site: string; url: string; now: number }) {
  const meters: [string, UsageLimit | null][] = [['Current session · 5 h', usage.fiveHour], [weekly, usage.sevenDay], ['Spend limit', usage.spendLimit]]
  return <div className="usage-provider" role="group" aria-label={`${name} usage`}>
    <h3><span style={{ color }}>{name}</span>{usage.updatedAt && <small>Updated {updated(usage.updatedAt, now)}</small>}</h3>
    {usage.available ? meters.map(([label, limit]) => limit && <Meter key={label} label={label} limit={limit} agent={name} now={now} />) : <p className="usage-empty">{empty}</p>}
    <button className="usage-link" onClick={event => openWebLink(url, event.ctrlKey || event.metaKey)}>Open usage on {site}<Icon name="external" size={12} /></button>
  </div>
}

export default function UsagePanel({ agents, onClose }: { agents: AgentInfo[]; onClose: () => void }) {
  const [usage, setUsage] = useState<{ claude: ClaudeUsage; claude2: ClaudeUsage; codex: Usage } | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(0)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try { const result = await api<{ claude: ClaudeUsage; claude2: ClaudeUsage; codex: Usage }>('/usage'); if (request === generation.current) { setUsage(result); setNow(Date.now()); setError('') } }
    catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : String(error)) }
  }, [])
  useEffect(() => {
    void Promise.resolve().then(refresh); const onFocus = () => { void refresh() }; window.addEventListener('focus', onFocus)
    const timer = window.setInterval(onFocus, 30000)
    return () => { invalidate(); window.removeEventListener('focus', onFocus); clearInterval(timer) }
  }, [refresh, invalidate])
  const claudes = agents.filter(item => ['claude', 'claude2'].includes(item.id) && item.available), codex = agents.find(item => item.id === 'codex' && item.available)
  return <section className="usage-panel" aria-label="Usage">
    <header><span><Icon name="gauge" size={16} /><strong>Usage</strong></span><div>
      <button className="desk-icon" onClick={() => void refresh()} title="Refresh usage" aria-label="Refresh usage"><Icon name="refresh" size={14} /></button>
      <button className="desk-icon" onClick={onClose} aria-label="Close usage"><Icon name="close" size={16} /></button>
    </div></header>
    {error && <p className="desk-error-inline" role="alert">{error}</p>}
    {usage && claudes.map(claude => { const limits = usage[claude.id as 'claude' | 'claude2']; return <Provider key={claude.id} name={claude.id === 'claude2' ? 'Claude 2' : 'Claude'} color={claude.color} usage={limits} weekly="Weekly · all models" site="claude.ai" url="https://claude.ai/settings/usage" now={now}
      empty={limits.customStatusLine ? 'Your own Claude status line is active, so Mr. Свин does not replace it to read usage.' : !limits.enabled ? 'Mr. Свин cannot add its Claude status line from this installation path.' : 'Usage appears after Claude replies in a chat started or resumed here. It is available for Claude Pro and Max plans.'} /> })}
    {usage && codex && <Provider name="Codex" color={codex.color} usage={usage.codex} weekly="Weekly" site="chatgpt.com" url="https://chatgpt.com/codex/settings/usage" now={now}
      empty="Usage appears after Codex replies in a chat. It is available when Codex is signed in with a ChatGPT plan." />}
  </section>
}
