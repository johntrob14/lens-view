// Transcript layout: tokens wrapped into lines of at most `width` cells.

export type Piece = { text: string; pos: number }

// Control characters the surface refuses to draw: C0 (but newline, which layout breaks on), DEL and C1.
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g
const hex = (c: string) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`

// How a token reads on screen: newlines and tabs made visible, other control characters escaped, empty tokens marked.
export function shown(token: string): string {
  if (token === '') return '∅'
  return token.replace(/\t/g, '⇥').replace(/\r/g, '␍').replace(CONTROL, hex)
}

// A token as the body of a quoted string: JSON's escapes, plus DEL and C1, which JSON leaves raw.
export function quoted(token: string): string {
  return JSON.stringify(token).slice(1, -1).replace(/[\x7f-\x9f]/g, hex)
}

export function layout(tokens: string[], width: number): { lines: Piece[][]; lineOf: number[] } {
  const lines: Piece[][] = [[]]
  const lineOf: number[] = []
  let used = 0
  const newLine = () => {
    lines.push([])
    used = 0
  }
  tokens.forEach((token, pos) => {
    const parts = shown(token).split('\n')
    lineOf[pos] = lines.length - 1
    parts.forEach((part, i) => {
      // A newline inside the token: mark it, then break.
      let text = i < parts.length - 1 ? part + '⏎' : part
      if (text === '' && i > 0) return
      if (used > 0 && used + text.length > width && text.length <= width) newLine()
      if (i === 0) lineOf[pos] = lines.length - 1
      while (text.length > 0) {
        const room = width - used
        if (room <= 0) {
          newLine()
          continue
        }
        lines[lines.length - 1]!.push({ text: text.slice(0, room), pos })
        used += Math.min(room, text.length)
        text = text.slice(room)
      }
      if (i < parts.length - 1) newLine()
    })
  })
  return { lines, lineOf }
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}
