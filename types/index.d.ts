// The trace as `lens-view-json` prints it (src/lens_view/trace.py, to_json).
export type LensViewLens = {
  name: string
  layers: string[]
  top_k: [string, number][][][] // [layer][position] -> [token, prob], highest first
  target_prob: number[][] | null
}

export type LensViewTrace = {
  format: string
  model: string
  prompt: string
  tokens: string[]
  targets: string[] | null
  lenses: LensViewLens[]
}

export type LensViewState = {
  path: string | null
  trace: LensViewTrace | null
  error: string | null
  lensIndex: number
}

declare module 'claude-code' {
  interface PluginState {
    'lens-view': { view: LensViewState }
  }
}
