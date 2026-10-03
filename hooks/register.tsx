import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LensViewCell, LensViewMeta, LensViewProps, LensViewSegment, LensViewState } from '../types'
import { clamp, layout, shown } from './layout'

const PANE = 'lens-view'
const DEFAULT_K = 5
const DEFAULTS: LensViewState = {
  path: null,
  cache: null,
  meta: null,
  error: null,
  pos: 0,
  k: DEFAULT_K,
  lensIndex: 0,
  topOffset: 0,
  panelOffset: Number.MAX_SAFE_INTEGER, // start at the final layers
  cell: null,
}
const view = atom({ plugin: 'lens-view', key: 'view' } as const, DEFAULTS)

// The session keeps $.state across reloads, so a value an older version wrote may lack fields
// this one reads: fill them from the defaults.
function complete(v: Partial<LensViewState>): LensViewState {
  const merged = { ...DEFAULTS, ...v }
  for (const key of ['pos', 'k', 'lensIndex', 'topOffset', 'panelOffset'] as const)
    if (!Number.isFinite(merged[key])) merged[key] = DEFAULTS[key]
  return merged
}

const current = async ($: EngineInterface) => complete(await read($, view))
const change = ($: EngineInterface, fn: (v: LensViewState) => LensViewState) => update($, view, v => fn(complete(v)))

// The pane's geometry as last drawn: what the wheel and the keys move within. Recomputed on every
// draw, so losing it on a reload costs nothing.
let geometry = { topRows: 10, panelRows: 8, lineCount: 0, layerCount: 0, lineOf: [] as number[] }
// What the pane last reported about itself, for the configure tool's answer.
let seen = 'not drawn yet'
let wheel = { events: 0, last: 'none' }
// Rows to draw when the surface reports few (an inline pane grows to its content).
const MIN_ROWS = 24

// Python owns the trace formats: lens-view-json exports the trace to a cache directory of
// meta.json and one pos-<i>.json per position, and the pane reads only what it shows.
async function load($: EngineInterface, path: string, options: { lens?: string; k?: number; position?: number } = {}) {
  const argv = ['uv', 'run', '--quiet', '--frozen', '--no-dev', '--project', $.plugin.root, 'lens-view-json', path]
  let cache: string | null = null
  let meta: LensViewMeta | null = null
  let error: string | null = null
  try {
    const { stdout, stderr } = await $.process.run(argv, { timeoutMs: 300_000 })
    const out = JSON.parse(stdout.trim() || '{}') as { cache?: string; error?: string }
    if (out.cache) {
      cache = out.cache
      meta = JSON.parse(await $.fs.read(`${cache}/meta.json`)) as LensViewMeta
    } else error = out.error ?? (stderr.trim() || 'lens-view-json printed nothing.')
  } catch (exc) {
    error = `Could not load the trace (is uv installed?): ${String(exc)}`
  }
  const lensIndex = meta && options.lens ? Math.max(0, meta.lenses.findIndex(l => l.name === options.lens)) : 0
  await change($, v => ({
    ...v,
    path,
    cache,
    meta,
    error,
    lensIndex,
    pos: 0,
    topOffset: 0,
    panelOffset: Number.MAX_SAFE_INTEGER,
    cell: null,
    k: options.k ? clamp(options.k, 1, meta?.k ?? 10) : v.k,
  }))
  if (meta) await select($, options.position ?? 0)
  return meta
    ? `Loaded ${path}: ${meta.tokens.length} tokens, lenses ${meta.lenses.map(l => l.name).join(', ')}, top ${meta.k} stored per cell.`
    : (error ?? 'Nothing loaded.')
}

async function select($: EngineInterface, pos: number) {
  const v = await current($)
  if (!v.meta || !v.cache) return
  const target = clamp(pos, 0, v.meta.tokens.length - 1)
  let cell: LensViewCell | null = null
  try {
    cell = JSON.parse(await $.fs.read(`${v.cache}/pos-${target}.json`)) as LensViewCell
  } catch (exc) {
    await change($, s => ({ ...s, error: `Could not read position ${target}: ${String(exc)}` }))
    return
  }
  // Keep the selected token in view.
  const line = geometry.lineOf[target] ?? 0
  let topOffset = v.topOffset
  if (line < topOffset) topOffset = line
  if (line >= topOffset + geometry.topRows) topOffset = line - geometry.topRows + 1
  await change($, s => ({ ...s, pos: target, cell, topOffset, error: null }))
}

async function configure($: EngineInterface, options: { k?: number; lens?: string; position?: number }) {
  const v = await current($)
  const notes: string[] = []
  if (options.k !== undefined) {
    const k = clamp(Math.round(options.k), 1, v.meta?.k ?? 10)
    await change($, s => ({ ...s, k }))
    notes.push(`k = ${k}`)
  }
  if (options.lens !== undefined && v.meta) {
    const i = v.meta.lenses.findIndex(l => l.name === options.lens)
    if (i < 0) notes.push(`no lens "${options.lens}" (have ${v.meta.lenses.map(l => l.name).join(', ')})`)
    else {
      await change($, s => ({ ...s, lensIndex: i }))
      notes.push(`lens = ${options.lens}`)
    }
  }
  if (options.position !== undefined) {
    await select($, options.position)
    notes.push(`position = ${(await current($)).pos}`)
  }
  return `lens-view: ${notes.length ? notes.join(', ') : 'nothing changed'}. Pane: ${seen}; wheel events: ${wheel.events} (last ${wheel.last}); trace: ${v.path ?? 'none'}${v.error ? `; error: ${v.error}` : ''}.`
}

async function onKey($: EngineInterface, key: string) {
  const v = await current($)
  if (!v.meta) return
  const last = v.meta.tokens.length - 1
  const lineStart = (line: number) => geometry.lineOf.findIndex(l => l === line)
  switch (key) {
    case 'left':
      return select($, v.pos - 1)
    case 'right':
    case ' ':
      return select($, v.pos + 1)
    case 'up':
    case 'down': {
      const line = (geometry.lineOf[v.pos] ?? 0) + (key === 'up' ? -1 : 1)
      const start = lineStart(clamp(line, 0, geometry.lineCount - 1))
      return start >= 0 ? select($, start) : undefined
    }
    case 'home':
      return select($, 0)
    case 'end':
      return select($, last)
    case 'pageup':
    case 'pagedown':
      return scrollPanel($, (key === 'pageup' ? -1 : 1) * geometry.panelRows)
    case '+':
    case '=':
      return configure($, { k: v.k + 1 })
    case '-':
      return configure($, { k: v.k - 1 })
    case 'l':
    case 'tab':
      return change($, s => ({ ...s, lensIndex: s.meta ? (s.lensIndex + 1) % s.meta.lenses.length : 0 }))
    case 'r':
      return v.path ? void (await load($, v.path, { lens: v.meta.lenses[v.lensIndex]?.name, k: v.k, position: v.pos })) : undefined
  }
}

async function scrollPanel($: EngineInterface, by: number) {
  const max = Math.max(0, geometry.layerCount - geometry.panelRows)
  await change($, s => ({ ...s, panelOffset: clamp(Math.min(s.panelOffset, max) + by, 0, max) }))
}

async function scrollTranscript($: EngineInterface, by: number) {
  const max = Math.max(0, geometry.lineCount - geometry.topRows)
  await change($, s => ({ ...s, topOffset: clamp(Math.min(s.topOffset, max) + by, 0, max) }))
}

// bodyRows: the Client's rows (the title bar above it is the hook's own).
function draw(v: LensViewState, width: number, bodyRows: number): LensViewProps {
  const panelRows = Math.max(4, Math.floor((bodyRows - 2) * 0.38))
  const topRows = Math.max(3, bodyRows - 2 - panelRows)
  const hint = '←/→ token  ↑/↓ line  click select  wheel scroll  +/- k  l lens  r reload'
  if (!v.meta) {
    geometry = { topRows, panelRows, lineCount: 0, layerCount: 0, lineOf: [] }
    const message = v.error ?? (v.path ? `Loading ${v.path}…` : 'No trace loaded. Run /lens-view <path>, or ask Claude to open one.')
    return { width, title: 'lens-view', status: '', lines: [[{ text: message, pos: -1, style: 'odd' }]], topRows, selection: '', rows: [], panelRows, chipWidth: 12, hint }
  }
  const meta = v.meta
  const lens = meta.lenses[v.lensIndex] ?? meta.lenses[0]!
  const { lines, lineOf } = layout(meta.tokens, Math.max(10, width))
  geometry = { topRows, panelRows, lineCount: lines.length, layerCount: lens.layers.length, lineOf }
  const topOffset = clamp(v.topOffset, 0, Math.max(0, lines.length - topRows))
  const styled: LensViewSegment[][] = lines.slice(topOffset, topOffset + topRows).map(line =>
    line.map(piece => ({
      text: piece.text,
      pos: piece.pos,
      style:
        piece.pos === v.pos
          ? 'selected'
          : (meta.next_prob[piece.pos] ?? 1) < 0.05
            ? 'surprise'
            : piece.pos % 2
              ? 'odd'
              : 'even',
    })),
  )

  const panelOffset = clamp(v.panelOffset, 0, Math.max(0, lens.layers.length - panelRows))
  const next = meta.targets?.[v.pos] ?? null
  const layers = v.cell?.[lens.name] ?? []
  const rows = lens.layers.slice(panelOffset, panelOffset + panelRows).map((label, i) => ({
    label,
    chips: (layers[panelOffset + i] ?? []).slice(0, v.k).map(([text, prob]) => ({ text: JSON.stringify(text).slice(1, -1), prob, isNext: text === next })),
  }))
  const chipWidth = Math.max(8, Math.floor((width - 5) / v.k))
  const nextProb = meta.next_prob[v.pos]
  const selection =
    ` ▸ ${v.pos}/${meta.tokens.length - 1}  ${JSON.stringify(shown(meta.tokens[v.pos] ?? ''))}` +
    (next !== null ? `  → next ${JSON.stringify(next)}${nextProb != null ? ` (${(nextProb * 100).toFixed(1)}% at output)` : ''}` : '') +
    `  ·  layers ${panelOffset}–${panelOffset + rows.length - 1} of ${lens.layers.length}`
  const name = meta.path.split('/').pop() ?? meta.path
  return {
    width,
    title: `${lens.name} · top ${v.k}`,
    status: `${name} · ${meta.model}`,
    lines: styled,
    topRows,
    selection,
    rows,
    panelRows,
    chipWidth,
    hint: v.error ?? hint,
  }
}

const OPEN_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Trace file: a lens-view.v0 JSON trace, or a saved grid (<id>.json.gz with vocab.json beside it). Absolute or relative to the working directory.' },
    lens: { type: 'string', description: 'Lens to show first, e.g. jlens or logitlens' },
    k: { type: 'number', description: 'How many top tokens to show per layer (default 5)' },
    position: { type: 'number', description: 'Token position to select first (default 0)' },
  },
  required: ['path'],
}

const CONFIGURE_SCHEMA = {
  type: 'object',
  properties: {
    k: { type: 'number', description: 'How many top tokens to show per layer' },
    lens: { type: 'string', description: 'Lens to show, e.g. jlens or logitlens' },
    position: { type: 'number', description: 'Token position to select' },
  },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lens-view',
      description: 'Lens traces in a pane: /lens-view <path> · /lens-view k <n> · /lens-view lens <name>',
    })
    await $.tool.register({
      name: 'open',
      description:
        'Open a lens trace (J-lens, logit lens, tuned lens) in the lens-view pane beside the conversation: the ' +
        'transcript on top, the selected token\'s top-k tokens per layer below. Use when the user asks to open ' +
        'lens-view, the J-lens viewer, or a lens trace. Its contents are not returned to you.',
      inputSchema: OPEN_SCHEMA,
    })
    await $.tool.register({
      name: 'configure',
      description:
        'Change the open lens-view pane: k (how many top tokens per layer), the lens shown, or the selected token ' +
        'position. Use when the user asks to show more or fewer top tokens, switch lens, or jump to a token.',
      inputSchema: CONFIGURE_SCHEMA,
    })
    return next(e)
  })

  on('command.run', { command: 'lens-view' }, async ($, e) => {
    const [word, value] = e.args.trim().split(/\s+/, 2)
    let text = 'Opened lens-view.'
    if (word === 'k' && value) text = await configure($, { k: Number(value) })
    else if (word === 'lens' && value) text = await configure($, { lens: value })
    else if (word) text = await load($, e.args.trim())
    const v = await current($)
    await $.ui.open({ id: PANE, title: v.path ? `lens-view · ${v.path.split('/').pop()}` : 'lens-view', focus: true })
    return { text }
  })

  // A tool's arguments sit on the event itself, beside `tool`.
  on('tool.call', { tool: 'mcp__lens-view__open' }, async ($, e) => {
    const input = e as unknown as { path?: string; lens?: string; k?: number; position?: number }
    if (!input.path) return { deny: 'path is required.' }
    try {
      const text = await load($, input.path, input)
      // Not awaited: a pane opened unasked waits for a wide enough terminal (144 columns) to seat.
      $.ui.open({ id: PANE, title: 'lens-view' }).catch(() => {})
      return { result: `${text} The pane shows it to the user (it seats once the terminal is at least 144 columns wide, or when they run /lens-view); its contents were not returned to you.` }
    } catch (exc) {
      return { result: `lens-view failed: ${String(exc)}` }
    }
  })

  on('tool.call', { tool: 'mcp__lens-view__configure' }, async ($, e) => {
    const input = e as unknown as { k?: number; lens?: string; position?: number }
    try {
      return { result: await configure($, input) }
    } catch (exc) {
      return { result: `lens-view failed: ${String(exc)}` }
    }
  })

  // The wheel: over the transcript it scrolls the transcript, over the top-k panel the layers.
  // The pane draws exactly its body, so the engine has nothing of its own to scroll.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const row = e.pointer?.row
    wheel = { events: wheel.events + 1, last: `by ${e.by}, row ${row ?? 'none (keys)'}, origin ${e.origin.kind}` }
    if (row !== undefined && row > geometry.topRows + 1) await scrollPanel($, e.by) // title bar, transcript, selection bar
    else await scrollTranscript($, e.by)
    return {}
  })

  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as { select?: number; key?: string }
    if (typeof data.select === 'number') await select($, data.select)
    else if (typeof data.key === 'string') await onKey($, data.key)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = await current($)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>lens-view draws in the terminal and the desktop app. {v.path ?? ''}</Text>
    }
    const { Box, Text, Client } = $.ui.resolve(e)
    const width = Math.max(40, e.props.bodyColumns)
    const rows = Math.max(MIN_ROWS, e.props.scroll.bodyRows)
    seen = `${e.surface}, ${e.props.placement}, body ${e.props.bodyColumns}×${e.props.scroll.bodyRows}, drawn ${width}×${rows}`
    const props = draw(v, width, rows - 1)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" height={1}>
          <Text color="#7aa2f7" bold wrap="truncate">{props.title}</Text>
          <Text color="#565f89" wrap="truncate">{props.status}</Text>
        </Box>
        <Client key="viewer" module="./viewer.tsx" props={props} width={width} height={rows - 1} />
      </Box>
    )
  })
}
