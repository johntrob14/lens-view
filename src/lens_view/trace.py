"""Lens trace format (FORMAT.md). parse_trace is the only code that reads it; load_trace is the
seam to the lens implementation (files now, a live source later)."""
from __future__ import annotations
from dataclasses import dataclass
import json
from pathlib import Path

FORMAT = 'lens-view.v0'
MAX_BYTES = 200 * 1024 * 1024
EXAMPLE = Path(__file__).with_name('example.json')


@dataclass
class Lens:
    name: str
    layers: list[str]
    top_k: list  # [layer][position] -> [[token, prob], ...]
    target_prob: list | None = None  # [layer][position] -> prob of trace.targets[position]


@dataclass
class Trace:
    model: str
    prompt: str
    tokens: list[str]
    targets: list[str] | None
    lenses: list[Lens]


def parse_trace(data) -> Trace:
    if not isinstance(data, dict) or data.get('format') != FORMAT:
        raise ValueError(f'Not a lens trace: expected "format": "{FORMAT}".')
    tokens = data.get('tokens')
    if not isinstance(tokens, list) or not tokens:
        raise ValueError('Trace needs a non-empty "tokens" list.')
    lenses = []
    for raw in data.get('lenses') or []:
        name = str(raw.get('name', f'lens {len(lenses)}'))
        layers, top_k = raw.get('layers'), raw.get('top_k')
        if not isinstance(layers, list) or not isinstance(top_k, list) or len(top_k) != len(layers) \
                or any(len(row) != len(tokens) for row in top_k):
            raise ValueError(f'Lens "{name}": top_k must be shaped [layer][position].')
        lenses.append(Lens(name, [str(l) for l in layers], top_k, raw.get('target_prob')))
    if not lenses:
        raise ValueError('Trace has no lenses.')
    return Trace(str(data.get('model', 'unknown model')), str(data.get('prompt', '')),
                 [str(t) for t in tokens], data.get('targets'), lenses)


def load_trace(path: Path) -> Trace:
    """File source for now. A live source (socket from a running model) can replace this later."""
    with path.open('rb') as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Trace exceeds the 200 MiB limit.')
    return parse_trace(json.loads(raw))


def to_json(trace: Trace) -> dict:
    """The trace as front ends without a parser of their own read it (the Claude Code mod)."""
    return {'format': FORMAT, 'model': trace.model, 'prompt': trace.prompt, 'tokens': trace.tokens,
            'targets': trace.targets,
            'lenses': [{'name': l.name, 'layers': l.layers, 'top_k': l.top_k, 'target_prob': l.target_prob}
                       for l in trace.lenses]}


def main():
    """lens-view-json PATH: print the trace at PATH, normalized; errors as {"error": ...}, exit 1."""
    import sys
    if len(sys.argv) != 2:
        sys.exit('usage: lens-view-json PATH')
    try:
        out = to_json(load_trace(Path(sys.argv[1])))
    except (OSError, ValueError) as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
    json.dump(out, sys.stdout, ensure_ascii=False, separators=(',', ':'))
