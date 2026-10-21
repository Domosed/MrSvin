import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './client'
import { Icon } from './Icons'
import { isClaude, type ChatContext, type ChatSession, type ContextCategory } from './types'
import './context-meter.css'

const short = (value: number) => (Math.round(value * 10) / 10).toString()
const tokens = (value: number | null | undefined) => value == null ? '—' : value >= 1e6 ? `${short(value / 1e6)}M` : value >= 1e3 ? `${short(value / 1e3)}k` : String(value)
const percent = (value: number | null | undefined, digits = 0) => value == null ? '—' : `${value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: 1 })} %`
const time = (at: string) => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// Claude Code's own colors for the largest categories; the rest stay neutral.
const colors: Record<string, string> = { 'System tools': '#3d84f5', Messages: '#e0592f', 'MCP tools': '#18a064', 'System prompt': '#d99a16', 'Autocompact buffer': '#5d5f6a', 'Free space': '#2c2d35' }
const color = (item: ContextCategory) => colors[item.name] || (item.deferred ? '#45474f' : '#a4a4ae')
const titles: Record<string, string> = { 'MCP Tools': 'Инструменты MCP', 'Memory Files': 'Файлы памяти', Skills: 'Навыки', 'Custom Agents': 'Собственные агенты', Agents: 'Агенты' }
const reserved = ['Autocompact buffer', 'Free space']
// Largest first, then the reserved space, then tools that load only on demand.
const rank = (item: ContextCategory) => item.deferred ? 2 : reserved.includes(item.name) ? 1 : 0
const ordered = (items: ContextCategory[]) => [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? reserved.indexOf(a.name) - reserved.indexOf(b.name) : (b.tokens || 0) - (a.tokens || 0)))

export default function ContextMeter({ session }: { session: ChatSession }) {
  const [data, setData] = useState<ChatContext | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const id = session.id
  const load = useCallback(async () => {
    try { setData(await api<ChatContext>(`/sessions/${id}/context`)) } catch { /* The next update retries. */ }
  }, [id])
  // A finished turn changes the totals; the interval covers status-line updates during long turns.
  useEffect(() => {
    void Promise.resolve().then(load)
    const timer = window.setInterval(() => void load(), open || pending ? 1500 : 15000)
    return () => clearInterval(timer)
  }, [load, open, pending, session.completionVersion, session.activity, session.nativeId])
  // /context records its report in the transcript; wait for one newer than the request.
  useEffect(() => {
    if (!pending) return
    const at = Date.parse(data?.breakdown?.at || '') || 0
    const done = at >= pending - 2000
    const timer = window.setTimeout(() => { setPending(null); if (!done) setError('Claude не показал /context. Проверьте терминал чата.') }, done ? 0 : Math.max(0, pending + 20000 - Date.now()))
    return () => clearTimeout(timer)
  }, [pending, data])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
  }, [open])
  const refresh = async () => {
    setError('')
    try { const result = await api<{ at: string }>(`/sessions/${id}/context`, {}); setPending(Date.parse(result.at) || Date.now()) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  if (!data?.supported) return null
  const { total, breakdown } = data, claude = isClaude(session.agent)
  const used = total?.percent ?? null
  const level = used == null ? '' : used >= 80 ? 'high' : used >= 60 ? 'warn' : ''
  const scale = breakdown?.window || 0
  const segments = breakdown && scale ? breakdown.categories.filter(item => !item.deferred && !reserved.includes(item.name) && item.tokens) : []
  const label = total?.compacted ? 'после /compact' : total ? `${percent(used)} · ${tokens(total.used)} / ${tokens(total.window)}` : 'нет данных'
  return <div className="context-meter" ref={box}>
    <button className={`context-chip ${level}`} aria-expanded={open} aria-label={`Контекст: ${label}`} title="Контекст чата" onClick={() => setOpen(value => !value)}>
      <span className="context-chip-bar"><i style={{ width: `${Math.min(100, used ?? 0)}%` }} /></span>
      <span className="context-chip-percent">{total?.compacted ? '—' : percent(used)}</span>
      {total && !total.compacted && <span className="context-chip-tokens">{tokens(total.used)} / {tokens(total.window)}</span>}
    </button>
    {open && <section className="context-panel" aria-label="Контекст">
      <header><strong>Контекст</strong><button className="desk-icon" onClick={() => setOpen(false)} aria-label="Закрыть контекст"><Icon name="close" size={15} /></button></header>
      <div className="context-total"><span>Использовано: {percent(used)}</span><span>{tokens(total?.used)} / {tokens(total?.window)}</span></div>
      <div className={`context-stack ${level}`} role="img" aria-label={`Заполнено ${percent(used)}`}>
        {segments.length ? segments.map(item => <i key={item.name} style={{ width: `${(item.tokens || 0) / scale * 100}%`, background: color(item) }} />) : <i style={{ width: `${Math.min(100, used ?? 0)}%` }} />}
      </div>
      {total?.compacted && <p className="context-note">Контекст сжат через /compact. Значение обновится после следующего ответа.</p>}
      {!total && <p className="context-note">Данные появятся после первого ответа агента.</p>}
      {total?.source === 'transcript' && total.window == null && <p className="context-note">Размер окна станет известен после /context или ответа с активной статус-строкой.</p>}
      {breakdown ? <ul className="context-categories">{ordered(breakdown.categories).map(item => <li key={item.name} className={item.deferred ? 'deferred' : ''}>
        <i style={{ background: color(item) }} /><span>{item.name}</span><span>{tokens(item.tokens)}</span><strong>{item.deferred ? '—' : percent(item.percent, 1)}</strong>
      </li>)}</ul> : <p className="context-note">{claude ? 'Разбивка по категориям появится после /context. Нажмите «Обновить».' : 'Codex не сообщает разбивку по категориям.'}</p>}
      {breakdown?.lists.map(list => <details key={list.title} className="context-list"><summary><span>{titles[list.title] || list.title}</span><small>{list.items.length}</small></summary>
        <ul>{list.items.map((item, index) => <li key={`${item.name}-${index}`}><span title={item.detail || undefined}>{item.name}{item.detail && <small>{item.detail}</small>}</span><span>{tokens(item.tokens)}</span></li>)}</ul>
      </details>)}
      {claude && <footer>
        <span>{breakdown?.at ? `Разбивка из /context · ${time(breakdown.at)}` : 'Разбивки ещё нет'}</span>
        <button className="context-refresh" disabled={!data.refreshable || !!pending} onClick={() => void refresh()} title={data.refreshable ? 'Отправить /context в этот чат. Команда локальная и не тратит токены.' : 'Доступно, когда чат запущен и агент свободен'}>
          <Icon name="refresh" size={12} />{pending ? 'Обновляю…' : 'Обновить'}
        </button>
      </footer>}
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
    </section>}
  </div>
}
