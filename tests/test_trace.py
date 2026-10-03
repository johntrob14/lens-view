import gzip
import json
import math
import os
from pathlib import Path
import subprocess
import sys

import pytest

from lens_view.trace import EXAMPLE, export, load_trace, parse_trace


def test_example_trace_parses():
    trace = load_trace(EXAMPLE)
    assert [l.name for l in trace.lenses] == ['jlens', 'logit']
    assert len(trace.lenses[0].top_k[0]) == len(trace.tokens)


def test_rejects_wrong_shape():
    data = json.loads(EXAMPLE.read_text())
    data['lenses'][0]['top_k'][0].pop()
    with pytest.raises(ValueError, match='layer'):
        parse_trace(data)
    with pytest.raises(ValueError, match='format'):
        parse_trace({'tokens': ['a']})


def write_grid(directory):
    """A saved grid as playgrounds write it: ids/logp [T][L][k] per lens, vocab.json beside it."""
    vocab = ['<s>', 'The', ' Tower', ' is', ' Paris']
    (directory / 'vocab.json').write_text(json.dumps(vocab))
    ids = [[[1, 2], [2, 3]], [[3, 4], [3, 2]], [[4, 1], [4, 3]]]  # T=3, L=2, k=2
    logp = [[[-0.1, -2.0], [-0.2, -3.0]], [[-0.5, -1.0], [-0.05, -4.0]], [[-0.3, -2.0], [-0.01, -5.0]]]
    doc = {'id': 'g', 'rendered_prompt': 'The Tower is', 'token_ids': [1, 2, 3], 'tokens': ['The', ' Tower', ' is'],
           'n_layers': 2, 'top_k': 2, 'jlens': {'ids': ids, 'logp': logp}, 'logitlens': {'ids': ids, 'logp': logp}}
    path = directory / 'g.json.gz'
    with gzip.open(path, 'wt') as f:
        json.dump(doc, f)
    return path


def test_grid_loads_layer_major_with_decoded_tokens(tmp_path):
    trace = load_trace(write_grid(tmp_path))
    assert [l.name for l in trace.lenses] == ['jlens', 'logitlens']
    assert trace.targets == [' Tower', ' is', None]
    final = trace.lenses[0].top_k[1]  # layer 1, every position
    assert final[0][0][0] == ' Tower' and abs(final[0][0][1] - math.exp(-0.2)) < 1e-9


def test_export_writes_meta_and_one_file_per_position(tmp_path):
    cache = export(write_grid(tmp_path), root=tmp_path / 'cache')
    meta = json.loads((cache / 'meta.json').read_text())
    assert meta['tokens'] == ['The', ' Tower', ' is'] and meta['k'] == 2
    # Final layer: the next token's probability where it is in the top k; none after the last token.
    assert meta['next_prob'][0] == round(math.exp(-0.2), 4) and meta['next_prob'][1] == round(math.exp(-0.05), 4) and meta['next_prob'][2] is None
    cell = json.loads((cache / 'pos-1.json').read_text())
    assert cell['jlens'][1][0] == [' is', round(math.exp(-0.05), 4)]
    assert export(tmp_path / 'g.json.gz', root=tmp_path / 'cache') == cache  # reused while unchanged


def test_json_command_prints_cache_and_reports_errors(tmp_path):
    env = {**os.environ, 'LENS_VIEW_CACHE': str(tmp_path / 'cache')}
    run = lambda path: subprocess.run([sys.executable, '-c', 'from lens_view.trace import main; main()', str(path)],
                                      capture_output=True, text=True, env=env)
    out = run(EXAMPLE)
    assert out.returncode == 0
    assert json.loads((Path(json.loads(out.stdout)['cache']) / 'meta.json').read_text())['tokens'] == load_trace(EXAMPLE).tokens
    bad = run(tmp_path / 'nope.json')
    assert bad.returncode == 1 and 'error' in json.loads(bad.stdout)
