import json
import subprocess
import sys

import pytest

from lens_view.trace import EXAMPLE, load_trace, parse_trace, to_json


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


def test_json_command_round_trips_and_reports_errors(tmp_path):
    out = subprocess.run([sys.executable, '-c', 'from lens_view.trace import main; main()', str(EXAMPLE)],
                         capture_output=True, text=True, check=True)
    assert parse_trace(json.loads(out.stdout)) == load_trace(EXAMPLE)
    assert json.loads(out.stdout) == to_json(load_trace(EXAMPLE))
    bad = subprocess.run([sys.executable, '-c', 'from lens_view.trace import main; main()', str(tmp_path / 'nope.json')],
                         capture_output=True, text=True)
    assert bad.returncode == 1 and 'error' in json.loads(bad.stdout)
