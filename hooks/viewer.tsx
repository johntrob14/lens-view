// Draws the lens-view pane: a header, the transcript (top), the selected token's top-k per layer
// (bottom). Clicks and keys go to the hooks module as posts; the wheel arrives there as ui.scroll.
import type { ClientModule } from 'claude-code'

import type { LensViewProps, LensViewSegment } from '../types'

const INK = { text: '#c0caf5', alt: '#9aa5ce', dim: '#565f89', accent: '#7aa2f7', next: '#9ece6a', warn: '#e0af68' }
const HEAT = ['#1f2335', '#283457', '#2e4482', '#3d59a1', '#4f6fc4']

function heat(prob: number): string {
  return HEAT[prob >= 0.5 ? 4 : prob >= 0.2 ? 3 : prob >= 0.05 ? 2 : prob >= 0.01 ? 1 : 0]!
}

function percent(prob: number): string {
  if (prob >= 0.995) return '100%'
  if (prob >= 0.1) return `${Math.round(prob * 100)}%`
  if (prob >= 0.001) return `${(prob * 100).toFixed(1)}%`
  return '<.1%'
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text.padEnd(width)
}

const Viewer: ClientModule<LensViewProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { width, lines, topRows, rows, panelRows, chipWidth } = props

  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') return
    const line = lines[event.y - 1]
    if (event.y < 1 || event.y > topRows || !line) return
    let x = 0
    for (const segment of line) {
      if (event.x < x + segment.text.length) return surface.post({ select: segment.pos })
      x += segment.text.length
    }
  })
  surface.onKey(event => surface.post({ key: event.key, shift: event.shift === true }))

  const segment = (s: LensViewSegment, i: number) =>
    s.style === 'selected' ? (
      <Text key={String(i)} backgroundColor={INK.accent} color="#1a1b26" bold>{s.text}</Text>
    ) : (
      <Text key={String(i)} color={s.style === 'surprise' ? INK.warn : s.style === 'odd' ? INK.alt : INK.text}>{s.text}</Text>
    )

  const transcript = Array.from({ length: topRows }, (_, row) => (
    <Box key={`t${row}`} flexDirection="row" height={1}>
      {(lines[row] ?? []).map(segment)}
    </Box>
  ))

  const panel = Array.from({ length: panelRows }, (_, row) => {
    const r = rows[row]
    if (!r) return <Box key={`p${row}`} height={1} />
    return (
      <Box key={`p${row}`} flexDirection="row" height={1}>
        <Text color={INK.dim}>{r.label.padStart(4)} </Text>
        {r.chips.map((chip, i) => (
          <Text key={String(i)} backgroundColor={heat(chip.prob)} color={chip.isNext ? INK.next : INK.text} bold={chip.isNext}>
            {fit(chip.text, chipWidth - 6) + percent(chip.prob).padStart(5) + ' '}
          </Text>
        ))}
      </Box>
    )
  })

  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" height={1} justifyContent="space-between">
        <Text color={INK.accent} bold wrap="truncate">{props.title}</Text>
        <Text color={INK.dim} wrap="truncate">{props.status}</Text>
      </Box>
      {transcript}
      <Box height={1} backgroundColor="#1f2335">
        <Text color={INK.text} bold wrap="truncate">{fit(props.selection, width)}</Text>
      </Box>
      {panel}
      <Box height={1}>
        <Text color={INK.dim} wrap="truncate">{props.hint}</Text>
      </Box>
    </Box>
  )
}

export default Viewer
