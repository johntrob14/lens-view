import { expect, test } from 'claude-code/testing'

const TRACE = {
  format: 'lens-view.v0',
  model: 'test model',
  prompt: 'The Eiffel Tower is in',
  tokens: ['The', ' Tower'],
  targets: null,
  lenses: [
    { name: 'jlens', layers: ['0', 'final'], top_k: [[[['a', 0.1]], [['b', 0.2]]], [[[' E', 0.5]], [[' Paris', 0.9]]]], target_prob: null },
    { name: 'logit', layers: ['0', 'final'], top_k: [[[['c', 0.1]], [['d', 0.2]]], [[['x', 0.3]], [[' in', 0.4]]]], target_prob: null },
  ],
}

// The engine's side, which the test stands in for.
function engine(on: any) {
  on('session.start', async (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: {} }))
  on('tool.register', async (_: unknown, e: { name: string }) => ({ value: { tool: `mcp__lens-view__${e.name}` } }))
  on('ui.open', async () => ({ value: {} }))
}

const PROPS = { title: 'lens-view', isFocused: false, bodyColumns: 80, placement: 'dock' } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`opens a trace and cycles lenses (${surface})`, async ($, on) => {
    engine(on)
    let argv: readonly string[] = []
    on('process.run', async (_, e) => {
      argv = e.argv
      return { value: { exitCode: 0, stdout: JSON.stringify(TRACE), stderr: '' } }
    })
    await $.session.start({ source: 'startup', cwd: '/t' })
    const ran = await $.tool.call({ tool: 'mcp__lens-view__open', input: { path: '/t/trace.json', lens: 'logit' } })
    expect(argv).toContain('lens-view-json')
    expect(argv[argv.length - 1]).toBe('/t/trace.json')
    expect(String(ran.result)).toContain('2 tokens')

    const pane = await $.ui.mount({ plugin: 'lens-view', surface, component: 'Pane', props: PROPS, requestId: 'lens-view' })
    expect(await pane.find({ text: /lens logit \(2\/2\)/ })).toBeDefined()
    expect(await pane.find({ text: /" in" 0\.40/ })).toBeDefined()
    await pane.press({ key: 'next-lens' })
    expect(await pane.find({ text: /lens jlens \(1\/2\)/ })).toBeDefined()
    expect(await pane.find({ text: /" Paris" 0\.90/ })).toBeDefined()
  })
}

test('shows the parser error', async ($, on) => {
  engine(on)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: JSON.stringify({ error: 'Not a lens trace' }), stderr: '' } }))
  await $.session.start({ source: 'startup', cwd: '/t' })
  await $.command.run({ command: 'lens-view', args: 'bad.json' })
  const pane = await $.ui.mount({ plugin: 'lens-view', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'lens-view' })
  expect(await pane.find({ text: 'Not a lens trace' })).toBeDefined()
})
