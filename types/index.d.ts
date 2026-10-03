// What `lens-view-json` writes to its cache directory (src/lens_view/trace.py, export).
export type LensViewMeta = {
  format: string
  path: string
  model: string
  prompt: string
  tokens: string[]
  targets: (string | null)[] | null
  lenses: { name: string; layers: string[] }[]
  k: number // top-k stored per cell
  next_prob: (number | null)[] // final-layer probability of the actual next token, per position
}

// pos-<i>.json: lens name -> [layer] -> [token, prob], highest first.
export type LensViewCell = Record<string, [string, number][][]>

export type LensViewState = {
  path: string | null
  cache: string | null
  meta: LensViewMeta | null
  error: string | null
  pos: number
  k: number
  lensIndex: number
  topOffset: number // first transcript line shown
  panelOffset: number // first layer row shown
  cell: LensViewCell | null // the selected position's top-k
}

// Props of the Client that draws the pane (hooks/viewer.tsx).
export type LensViewSegment = { text: string; pos: number; style: 'even' | 'odd' | 'selected' | 'surprise' }
export type LensViewChip = { text: string; prob: number; isNext: boolean }
export type LensViewProps = {
  width: number
  title: string
  status: string
  lines: LensViewSegment[][]
  topRows: number
  selection: string
  rows: { label: string; chips: LensViewChip[] }[]
  panelRows: number
  chipWidth: number
  hint: string
}

declare module 'claude-code' {
  interface PluginState {
    'lens-view': { view: LensViewState }
  }
}
