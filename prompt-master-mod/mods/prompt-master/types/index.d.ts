export type Q = { id: string; ask: string; options: string[] }
export type Answer = { ask: string; answer: string }
export type Step = { tool: string; prompt: string; produces: string }
export type Plan = {
  prompt: string
  note: string
  tool: string
  toolWhy: string
  claudeModel: string
  claudeEffort: string
  claudeWhy: string
  isMulti: boolean
  steps: Step[]
  handoff: string
}
export type PM = {
  phase: 'idle' | 'working' | 'asking' | 'result' | 'editing'
  original: string
  status: string
  goal: string
  questions: Q[]
  answers: Answer[]
  plan: Plan | null
  saved: string
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-master': { pm: PM }
  }
}
