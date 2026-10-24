import { isWindows } from './platform'

// Keys a Codex side thread (/btw) asks for that the terminal cannot send as typed.
// On Windows, ConPTY requests win32-input-mode (CSI ? 9001 h) and reads a key as
// CSI Vk;Sc;Uc;Kd;Cs;Rc _ (down, then up). xterm.js sends Ctrl+/ as 0x1F, which
// ConPTY turns into Ctrl+Shift+-, and Ctrl+C as 0x03, which ConPTY raises as a
// console signal; in this form both reach the CLI as the exact key.
const leftCtrl = 0x08
const win32Key = (vk: number, scan: number, char: number, state: number) => [1, 0].map(down => `\x1b[${vk};${scan};${char};${down};${state};1_`).join('')

export type SideKey = 'ctrl+/' | 'ctrl+c' | 'f2'
export const sideKeys: Record<SideKey, { label: string; data: string }> = {
  'ctrl+/': { label: 'Switch thread', data: isWindows ? win32Key(0xbf, 0x35, 0x1f, leftCtrl) : '\x1f' },
  'ctrl+c': { label: 'Close side thread', data: isWindows ? win32Key(0x43, 0x2e, 0x03, leftCtrl) : '\x03' },
  f2: { label: 'View warnings', data: '\x1bOQ' },
}

// Codex names the keys in the side thread's bottom row, for example
// "Side from main thread · main finished · ctrl+/ to switch · ctrl+c to close · ⚠ 1 warning · f2 to view".
export function sideThreadKeys(rows: string[]): SideKey[] {
  const line = rows.find(row => /ctrl\+\/ to switch/i.test(row))
  if (!line) return []
  return [...line.matchAll(/\b(ctrl\+\/|ctrl\+c|f2) to \w+/gi)].map(match => match[1].toLowerCase() as SideKey).filter((key, index, list) => list.indexOf(key) === index)
}
