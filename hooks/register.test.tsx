import { expect, test } from 'claude-code/testing'

const TOKENS = ['The', ' Eiffel', ' Tower', ' is', ' in']
const LAYERS = Array.from({ length: 12 }, (_, i) => String(i))
const META = {
  format: 'lens-view.v0',
  path: '/t/trace.json.gz',
  model: 'test model',
  prompt: 'The Eiffel Tower is in',
  tokens: TOKENS,
  targets: [...TOKENS.slice(1), null],
  lenses: [
    { name: 'jlens', layers: LAYERS },
    { name: 'logitlens', layers: LAYERS },
  ],
  k: 10,
  next_prob: [0.5, 0.9, 0.01, 0.8, null],
}

// Position p, layer l: ten tokens named after both, the actual next token first at the last layer.
function cell(p: number) {
  const row = (lens: string, l: number) =>
    Array.from({ length: 10 }, (_, i) => [l === 11 && i === 0 ? (TOKENS[p + 1] ?? '?') : `${lens}${p}.${l}.${i}`, 0.5 / (i + 1)])
  return { jlens: LAYERS.map((_, l) => row('j', l)), logitlens: LAYERS.map((_, l) => row('g', l)) }
}

// The engine's side, which the test stands in for.
function engine(on: any, files: Record<string, string> = {}) {
  on('session.start', async (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: {} }))
  on('tool.register', async (_: unknown, e: { name: string }) => ({ value: { tool: `mcp__lens-view__${e.name}` } }))
  on('ui.open', async () => ({ value: {} }))
  on('fs.read', async (_: unknown, e: { path: string }) => {
    if (e.path === '/c/meta.json') return { value: JSON.stringify(META) }
    const m = /pos-(\d+)\.json$/.exec(e.path)
    if (m) return { value: JSON.stringify(cell(Number(m[1]))) }
    if (files[e.path]) return { value: files[e.path] }
    throw new Error(`no file ${e.path}`)
  })
}

const PROPS = {
  title: 'lens-view',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

// Throws naming the pattern, so a failure says which view was missing.
async function shows(pane: any, pattern: RegExp, present = true) {
  const found = await pane.find({ in: 'viewer', text: pattern })
  if (present !== (found !== undefined)) throw new Error(`${present ? 'missing' : 'unexpected'}: ${pattern}`)
}

async function opened($: any, on: any, surface: 'terminal' | 'desktop') {
  engine(on)
  let argv: readonly string[] = []
  on('process.run', async (_: unknown, e: { argv: readonly string[] }) => {
    argv = e.argv
    return { value: { exitCode: 0, stdout: JSON.stringify({ cache: '/c' }), stderr: '' } }
  })
  await $.session.start({ source: 'startup', cwd: '/t' })
  const ran = await $.tool.call({ tool: 'mcp__lens-view__open', path: '/t/trace.json.gz' })
  expect(argv).toContain('lens-view-json')
  expect(String(ran.result)).toContain('5 tokens')
  const pane = await $.ui.mount({ plugin: 'lens-view', surface, component: 'Pane', props: PROPS, requestId: 'lens-view' })
  return pane
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`walks the transcript and shows the top 5 per layer (${surface})`, async ($, on) => {
    const pane = await opened($, on, surface)
    await shows(pane, /▸ 0\/4\s+"The"/)
    // Starts at the final layers: layer 11 holds the actual next token.
    await shows(pane, /^ Eiffel/)
    await shows(pane, /j0\.11\.4/)
    await shows(pane, /j0\.11\.5/, false)

    await pane.pointer({ type: 'down', x: 1, y: 1, button: 'left' }) // a click gives the region the keys
    await pane.key({ key: 'right' })
    await shows(pane, /▸ 1\/4\s+" Eiffel"/)
    await pane.key({ key: 'left' })
    await pane.key({ key: 'end' })
    await shows(pane, /▸ 4\/4/)

    await pane.key({ key: '+' })
    await shows(pane, /jlens · top 6/)
    await pane.key({ key: 'l' })
    await shows(pane, /logitlens · top 6/)
  })
}

test('a click on a token selects it', async ($, on) => {
  const pane = await opened($, on, 'terminal')
  // Row 1 is the transcript's first line: "The Eiffel Tower is in"; x 5 is inside " Eiffel".
  await pane.pointer({ type: 'down', x: 5, y: 1, button: 'left' })
  await shows(pane, /▸ 1\/4/)
})

test('k changes when asked, within what the trace stores', async ($, on) => {
  const pane = await opened($, on, 'terminal')
  const ran = await $.tool.call({ tool: 'mcp__lens-view__configure', k: 8 })
  expect(String(ran.result)).toContain('k = 8')
  await shows(pane, /top 8/)
  await $.tool.call({ tool: 'mcp__lens-view__configure', k: 50 })
  await shows(pane, /top 10/)
})

test('the wheel scrolls the half it is over', async ($, on) => {
  const pane = await opened($, on, 'terminal')
  // 20 body rows: header, 11 transcript rows, the selection bar, 6 layer rows, the hint.
  await shows(pane, /layers 6–11 of 12/)
  const wheel = (row: number, by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'lens-view', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 10, row } })
  await wheel(15, -3)
  await shows(pane, /layers 3–8 of 12/)
  await wheel(3, -3) // over the transcript, which fits: nothing moves below
  await shows(pane, /layers 3–8 of 12/)
})

test('shows the parser error', async ($, on) => {
  engine(on)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: JSON.stringify({ error: 'Not a lens trace' }), stderr: '' } }))
  await $.session.start({ source: 'startup', cwd: '/t' })
  await $.command.run({ command: 'lens-view', args: 'bad.json' })
  const pane = await $.ui.mount({ plugin: 'lens-view', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'lens-view' })
  await shows(pane, /Not a lens trace/)
})
