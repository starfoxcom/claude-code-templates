import type { Timer } from 'claude-code'

import type { Pause } from './plan'
import type { Zone } from './texts'

/** register.tsx's module state: a hot reload starts it over, which is safe because the pause lives in a file. */
export type Live = {
  zone: Zone
  isTurnRunning: boolean
  isStarted: boolean
  /** The session id whose tool calls changed something: a /clear goes on under a new id with none. */
  workSession?: string
  isStatusShown: boolean
  wakeTimer?: Timer
  /** The wake the person armed by hand (`armedWake`), counting down in this module. */
  armTimer?: Timer
  /** A wrap-up due when the running turn ends: the pause it is for. */
  pendingWrapUp?: Pause
  /** A wrap-up started: once its turn ends, the session may compact before the pause. */
  compactAfterTurn?: Pause
  /** How this session's last compaction went, with its time, for /usage-guard to repeat. */
  lastCompaction?: string
  /** A compaction that ran, waiting for the next reply's size: the size before it, and the paused-until text. */
  measuring?: { before?: number; pausedUntil?: string }
  /** Claims this module already holds or found taken, so a 60-second check spawns no helper. */
  handled: Set<string>
  wrapUpAt: number
  delayMinutes: number
  compactAbovePercent: number
  catchUpMinutes: number
  /** The folder for saved arms exists: made once per module load, before the first save. */
  isArmsDirMade: boolean
}
