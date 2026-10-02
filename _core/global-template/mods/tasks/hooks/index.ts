import type { Register } from 'claude-code'

import { register as logic } from './register'
import { register as view } from './view'

// A plugin loads one hooks module: this one registers the task logic (register.ts) and its on-screen
// view (view.tsx) together. Hot reload watches this file only: change its content after editing either of them.
export const register: Register = (on, options) => {
  logic(on, options)
  view(on, options)
}
