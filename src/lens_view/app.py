"""lens-view: terminal viewer for lens traces (J-lens, logit lens, tuned lens, ...).

The UI below is a placeholder until the viewer is designed.
"""
from __future__ import annotations
import argparse
from pathlib import Path

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.widgets import Footer, Header, Static

from .trace import FORMAT, Trace, load_trace

HINT = 'q close · r reload · l next lens'


class LensView(App):
    TITLE = 'lens-view'
    CSS = '''
    Screen { background: #111820; }
    #filepath { height: auto; padding: 0 1; color: #edf5fc; text-style: bold; }
    #hint { height: auto; padding: 0 1; background: #203040; color: #c8deef; }
    #status { height: auto; padding: 0 1; color: #92b6ce; }
    #body { padding: 1 2; }
    '''
    BINDINGS = [Binding('q', 'quit', 'Close'), Binding('r', 'reload', 'Reload'), Binding('l', 'next_lens', 'Next lens')]

    def __init__(self, path: Path | None, hint: str = HINT, lens: str | None = None):
        super().__init__()
        self.path = path.expanduser().absolute() if path else None
        self.hint = hint
        self.requested_lens = lens
        self.trace: Trace | None = None
        self.lens_index = 0

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static(str(self.path) if self.path else 'No trace loaded', id='filepath', markup=False)
        yield Static(self.hint, id='hint', markup=False)
        yield Static('', id='status', markup=False)
        with VerticalScroll():
            yield Static('', id='body', markup=False)
        yield Footer()

    def on_mount(self):
        self.theme = 'textual-dark'
        self.action_reload()

    def action_reload(self):
        status, body = self.query_one('#status', Static), self.query_one('#body', Static)
        if not self.path:
            status.update('No trace given')
            body.update(f'Open a {FORMAT} trace file. See FORMAT.md in the lens-view repository.')
            return
        try:
            self.trace = load_trace(self.path)
        except (OSError, ValueError) as exc:
            status.update(str(exc))
            return
        names = [l.name for l in self.trace.lenses]
        if self.requested_lens in names:
            self.lens_index = names.index(self.requested_lens)
        self.show()

    def action_next_lens(self):
        if self.trace:
            self.lens_index = (self.lens_index + 1) % len(self.trace.lenses)
            self.show()

    def show(self):
        trace, lens = self.trace, self.trace.lenses[self.lens_index]
        self.query_one('#status', Static).update(
            f'{trace.model} · {len(trace.tokens)} tokens · lens {lens.name} ({self.lens_index + 1}/{len(trace.lenses)}) · l next lens · r reload')
        # Placeholder rendering: final-layer top-1 per position.
        rows = [f'prompt: {trace.prompt}', f'layers: {", ".join(lens.layers)}', '']
        for position, token in enumerate(trace.tokens):
            top = lens.top_k[-1][position]
            guess = f'{top[0][0]!r} {float(top[0][1]):.2f}' if top else '—'
            rows.append(f'{position:>4}  {token!r:<16} → {guess}')
        self.query_one('#body', Static).update('\n'.join(rows))


def main():
    parser = argparse.ArgumentParser(prog='lens-view', description=__doc__.splitlines()[0])
    parser.add_argument('path', type=Path, nargs='?')
    parser.add_argument('--lens', help='Lens name to show first')
    parser.add_argument('--hint', default=HINT, help='One-line help shown under the title (embedders pass their own)')
    args = parser.parse_args()
    LensView(args.path, args.hint, args.lens).run()


if __name__ == '__main__':
    main()
