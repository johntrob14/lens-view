import shlex
from unittest.mock import patch

from lens_view import pane


def test_explicit_and_env_pane_win():
    with patch.dict('os.environ', {'TMUX_PANE': '%7'}):
        assert pane.agent_pane('%2') == '%2'
        assert pane.agent_pane() == '%7'


def test_ancestor_walk_finds_pane_without_env():
    # Agent stripped TMUX_PANE: server pid 30 -> agent 20 -> shell 10 (pane %4).
    parents = {30: 20, 20: 10, 10: 1}
    with patch.dict('os.environ', {}, clear=True), \
            patch.object(pane, 'tmux', return_value='10 %4\n99 %5'), \
            patch.object(pane.os, 'getppid', return_value=30), \
            patch.object(pane, 'parent_pid', side_effect=parents.get):
        assert pane.agent_pane() == '%4'


def test_viewer_runs_with_this_interpreter():
    calls = []

    def tmux(*args):
        calls.append(args)
        return {'display-message': '%1', 'show-options': 'C-b', 'split-window': '%9'}[args[0]]

    with patch.object(pane, 'tmux', side_effect=tmux), patch.object(pane.shutil, 'which', return_value='/usr/bin/tmux'):
        result = pane.open_pane(['/t/trace.json'], '%1')
    assert result['viewer_pane'] == '%9'
    command = shlex.split(calls[-1][-1])
    assert command[:3] == [pane.sys.executable, '-m', 'lens_view'] and '/t/trace.json' in command
