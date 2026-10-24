import { useEffect, useRef } from 'react'
import { chatRequest } from './chatActivity'
import type { ChatSession, Settings } from './types'

// Quiet notification tones for chats, synthesized here: no audio files. "done"
// falls by a fourth; "waiting" rises and repeats, so the two differ by ear.
const tones = {
  done: [[1046.5, 0], [784, 0.14]],
  waiting: [[784, 0], [1046.5, 0.13], [784, 0.42], [1046.5, 0.55]],
} as const
export type ChatSound = keyof typeof tones
export const defaultChatSoundVolume = 30

let context: AudioContext | null = null
const audio = () => {
  context ||= new AudioContext()
  if (context.state === 'suspended') void context.resume().catch(() => { /* Resumed by the next click. */ })
  return context
}
// Web views start audio only after a gesture; any click or key in the window allows it.
if (typeof window !== 'undefined') for (const name of ['pointerdown', 'keydown'] as const) window.addEventListener(name, () => { try { audio() } catch { /* No audio device. */ } }, { capture: true, passive: true })

export function playChatSound(kind: ChatSound, volume = defaultChatSoundVolume) {
  if (!(volume > 0)) return
  try {
    const ctx = audio(), start = ctx.currentTime + 0.03
    // Perceived loudness grows with the square; 100% stays well below full scale.
    const peak = Math.min(1, volume / 100) ** 2 * 0.3
    for (const [frequency, offset] of tones[kind]) {
      // A sine with a faint octave sounds like a soft bell.
      for (const [ratio, share] of [[1, 1], [2, 0.18]]) {
        const oscillator = ctx.createOscillator(), envelope = ctx.createGain(), at = start + offset
        oscillator.type = 'sine'; oscillator.frequency.value = frequency * ratio
        envelope.gain.setValueAtTime(0, at)
        envelope.gain.linearRampToValueAtTime(peak * share, at + 0.015)
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.42)
        oscillator.connect(envelope).connect(ctx.destination)
        oscillator.start(at); oscillator.stop(at + 0.45)
      }
    }
  } catch { /* No audio output. */ }
}

// Plays a tone when a chat finishes its turn or starts waiting for an answer or
// a permission. Chats seen for the first time (start-up, a new tab) stay silent.
export function useChatSounds(sessions: ChatSession[], settings: Settings) {
  const previous = useRef(new Map<string, { completion: number; waiting: string | null }>())
  const lastPlayed = useRef(0)
  const enabled = settings.chatSound !== false, volume = settings.chatSoundVolume ?? defaultChatSoundVolume
  useEffect(() => {
    let sound: ChatSound | null = null
    const next = new Map<string, { completion: number; waiting: string | null }>()
    for (const session of sessions) {
      const waiting = chatRequest(session), before = previous.current.get(session.id)
      next.set(session.id, { completion: session.completionVersion, waiting })
      if (!before) continue
      if (waiting && waiting !== before.waiting) sound = 'waiting'
      else if (session.completionVersion > before.completion) sound ||= 'done'
    }
    previous.current = next
    // Several chats finishing together ring once.
    if (!sound || !enabled || Date.now() - lastPlayed.current < 1500) return
    lastPlayed.current = Date.now()
    playChatSound(sound, volume)
  }, [sessions, enabled, volume])
}
