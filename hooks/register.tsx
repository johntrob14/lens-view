import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LensViewTrace } from '../types'

const PANE = 'lens-view'
const view = atom({ plugin: 'lens-view', key: 'view' } as const, {
  path: null,
  trace: null,
  error: null,
  lensIndex: 0,
})

// Python owns the trace format: lens-view-json parses the file and prints it normalized.
async function load($: EngineInterface, path: string, lens?: string): Promise<string> {
  const argv = ['uv', 'run', '--quiet', '--frozen', '--no-dev', '--project', $.plugin.root, 'lens-view-json', path]
  let trace: LensViewTrace | null = null
  let error: string | null = null
  try {
    const { stdout, stderr, isStdoutTruncated } = await $.process.run(argv, { timeoutMs: 120_000 })
    if (isStdoutTruncated) error = 'Trace is too large for the pane (over 4 MiB as JSON).'
    else {
      const out = JSON.parse(stdout || '{}')
      if (out.error || !out.lenses) error = out.error ?? (stderr.trim() || 'lens-view-json printed nothing.')
      else trace = out
    }
  } catch (exc) {
    error = `Could not run lens-view-json (is uv installed?): ${String(exc)}`
  }
  const found = trace && lens ? trace.lenses.findIndex(l => l.name === lens) : -1
  await update($, view, () => ({ path, trace, error, lensIndex: Math.max(found, 0) }))
  return error ?? `Loaded ${path}: ${trace!.tokens.length} tokens, lenses ${trace!.lenses.map(l => l.name).join(', ')}.`
}

async function nextLens($: EngineInterface) {
  await update($, view, v => ({ ...v, lensIndex: v.trace ? (v.lensIndex + 1) % v.trace.lenses.length : 0 }))
}

async function reload($: EngineInterface) {
  const v = await read($, view)
  if (v.path) await load($, v.path, v.trace?.lenses[v.lensIndex]?.name)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lens-view',
      description: 'Open a lens trace (J-lens, logit lens) in a pane: /lens-view <path>',
    })
    await $.tool.register({
      name: 'open',
      description:
        'Open a lens trace (J-lens, logit lens, tuned lens) in the lens-view pane beside the conversation. ' +
        'Use when the user asks to open lens-view, the J-lens viewer, or a lens trace. The pane shows the ' +
        'trace to the user; its contents are not returned to you.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Trace file (lens-view.v0 JSON), absolute or relative to the working directory' },
          lens: { type: 'string', description: 'Name of the lens to show first' },
        },
        required: ['path'],
      },
    })
    return next(e)
  })

  on('command.run', { command: 'lens-view' }, async ($, e) => {
    const path = e.args.trim()
    const text = path ? await load($, path) : 'Opened lens-view.'
    await $.ui.open({ id: PANE, title: 'lens-view', focus: true })
    return { text }
  })

  on('tool.call', { tool: 'mcp__lens-view__open' }, async ($, e) => {
    const input = e.input as { path?: string; lens?: string }
    if (!input.path) return { deny: 'path is required.' }
    const text = await load($, input.path, input.lens)
    await $.ui.open({ id: PANE, title: 'lens-view' })
    return { result: `${text} The pane shows it to the user; its contents were not returned to you.` }
  })

  // Placeholder drawing until the viewer is designed: final-layer top-1 per position.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { path, trace, error, lensIndex } = await read($, view)
    if (!trace) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{path ?? 'No trace loaded. Run /lens-view <path>.'}</Text>
          {error && <Text color="red">{error}</Text>}
        </Box>
      )
    }
    const lens = trace.lenses[lensIndex] ?? trace.lenses[0]
    const final = lens.top_k[lens.top_k.length - 1]
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    return (
      <Box flexDirection="column">
        <Text bold>{path}</Text>
        <Text dimColor>
          {trace.model} · {trace.tokens.length} tokens · lens {lens.name} ({lensIndex + 1}/{trace.lenses.length})
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="next-lens" label="next lens" hotkey="l" onPress={() => nextLens($)} />
          <Button key="reload" label="reload" hotkey="r" onPress={() => reload($)} />
        </Box>
        {error && <Text color="red">{error}</Text>}
        {trace.tokens.slice(0, room).map((token, i) => {
          const top = final[i]?.[0]
          return (
            <Text>
              {String(i).padStart(4)}  {JSON.stringify(token).padEnd(16)} → {top ? `${JSON.stringify(top[0])} ${top[1].toFixed(2)}` : '—'}
            </Text>
          )
        })}
      </Box>
    )
  })
}
