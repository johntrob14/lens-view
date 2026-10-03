"""Lens traces: the lens-view.v0 format (FORMAT.md) and saved grids (<id>.json.gz beside vocab.json,
as jlens playgrounds and qual runs write them). load_trace is the seam to the lens implementation
(files now, a live source later); export writes the per-position cache the Claude Code mod reads."""
from __future__ import annotations
from dataclasses import dataclass
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import tempfile

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
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rb') as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Trace exceeds the 200 MiB limit.')
    data = json.loads(raw)
    if isinstance(data, dict) and 'token_ids' in data and 'n_layers' in data:
        return parse_grid(data, path.parent)
    return parse_trace(data)


def parse_grid(data: dict, directory: Path) -> Trace:
    """A saved grid: per lens, ids[T][L][k] (vocab ids) and logp[T][L][k]; vocab.json beside it."""
    vocab_path = directory / 'vocab.json'
    if not vocab_path.is_file():
        raise ValueError(f'Grid needs vocab.json beside it: {vocab_path}')
    vocab = json.loads(vocab_path.read_text())
    index = directory / 'index.json'
    model = json.loads(index.read_text()).get('model', 'unknown model') if index.is_file() else 'unknown model'
    tokens = [str(t) for t in data['tokens']]
    n_layers = int(data['n_layers'])
    layers = [str(l) for l in range(n_layers)]
    lenses = []
    for name, grid in data.items():
        if not (isinstance(grid, dict) and 'ids' in grid and 'logp' in grid):
            continue
        ids, logp = grid['ids'], grid['logp']
        if len(ids) != len(tokens) or any(len(row) != n_layers for row in ids):
            raise ValueError(f'Lens "{name}": ids must be shaped [position][layer][k].')
        top_k = [[[[vocab[i], math.exp(p)] for i, p in zip(ids[t][l], logp[t][l])] for t in range(len(tokens))]
                 for l in range(n_layers)]
        lenses.append(Lens(name, layers, top_k))
    if not lenses:
        raise ValueError('Grid has no lenses.')
    return Trace(str(model), str(data.get('rendered_prompt', '')), tokens, tokens[1:] + [None], lenses)


def to_json(trace: Trace) -> dict:
    """The trace as front ends without a parser of their own read it (the Claude Code mod)."""
    return {'format': FORMAT, 'model': trace.model, 'prompt': trace.prompt, 'tokens': trace.tokens,
            'targets': trace.targets,
            'lenses': [{'name': l.name, 'layers': l.layers, 'top_k': l.top_k, 'target_prob': l.target_prob}
                       for l in trace.lenses]}


EXPORT_VERSION = 1


def cache_root() -> Path:
    if os.environ.get('LENS_VIEW_CACHE'):
        return Path(os.environ['LENS_VIEW_CACHE'])
    return Path(os.environ.get('XDG_CACHE_HOME') or Path.home() / '.cache') / 'lens-view'


def export(path: Path, root: Path | None = None) -> Path:
    """Write the trace at `path` as a cache directory: meta.json (tokens, lenses, per-position next-token
    probability) and pos-<i>.json (per lens, [layer] -> [[token, prob], ...]). Reused while the file
    is unchanged, so a front end reads one small file per position instead of the whole trace."""
    path = path.expanduser().absolute()
    stat = path.stat()
    key = hashlib.sha1(f'{path}:{stat.st_mtime_ns}:{stat.st_size}:{EXPORT_VERSION}'.encode()).hexdigest()[:16]
    root = root or cache_root()
    target = root / key
    if (target / 'meta.json').is_file():
        return target
    trace = load_trace(path)
    root.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(dir=root, prefix='.tmp-'))
    try:
        final = trace.lenses[0].top_k[-1]
        next_prob = []
        for position, target_token in enumerate(trace.targets or [None] * len(trace.tokens)):
            hits = [prob for token, prob in final[position] if token == target_token]
            next_prob.append(round(float(hits[0]), 4) if hits else (None if target_token is None else 0.0))
        meta = {'format': FORMAT, 'path': str(path), 'model': trace.model, 'prompt': trace.prompt,
                'tokens': trace.tokens, 'targets': trace.targets,
                'lenses': [{'name': l.name, 'layers': l.layers} for l in trace.lenses],
                'k': max(len(cell) for l in trace.lenses for row in l.top_k for cell in row),
                'next_prob': next_prob}
        for position in range(len(trace.tokens)):
            cell = {l.name: [[[str(t), round(float(p), 4)] for t, p in row[position]] for row in l.top_k]
                    for l in trace.lenses}
            (work / f'pos-{position}.json').write_text(json.dumps(cell, ensure_ascii=False, separators=(',', ':')))
        (work / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')))
        try:
            work.rename(target)
        except OSError:  # another process exported it first
            shutil.rmtree(work)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    return target


def main():
    """lens-view-json PATH: export the trace at PATH to the cache and print {"cache": dir};
    errors as {"error": ...}, exit 1."""
    import sys
    if len(sys.argv) != 2:
        sys.exit('usage: lens-view-json PATH')
    try:
        out = {'cache': str(export(Path(sys.argv[1])))}
    except (OSError, ValueError, KeyError, IndexError) as exc:
        print(json.dumps({'error': f'{type(exc).__name__}: {exc}' if isinstance(exc, (KeyError, IndexError)) else str(exc)}))
        sys.exit(1)
    print(json.dumps(out))
