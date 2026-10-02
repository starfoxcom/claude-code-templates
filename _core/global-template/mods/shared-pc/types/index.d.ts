export type CardTone = 'yellow' | 'blue' | 'green' | 'red'

export type SharedPcBand = {
  /** Where this session stands. */
  mine: 'seat' | 'line' | 'none'
  /** 1-based place in line, 0 when not in line. */
  position: number
  /** Who holds the seat, null when the PC is free. */
  holder: { name: string; label: string; kind: 'work' | 'hold'; heldFor: string; left?: string; isLong: boolean } | null
  /** How many sessions wait in line. */
  waiting: number
  /** Open skip-the-line requests from any session, oldest first; every session shows them. */
  requests: { session: string; name: string; reason: string; isMine: boolean }[]
  /**
   * The mod's own toasts, a bordered card at the band's right edge: a request until someone answers it
   * (with Approve and Decline), or a short notice. Claude Code's toast takes no color or border.
   */
  /** yellow: the person must act; blue: information; green: good news; red: an error. */
  cards: { key: string; body: string; tone: CardTone; requestSession?: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'shared-pc': { band: SharedPcBand | null }
  }
}
