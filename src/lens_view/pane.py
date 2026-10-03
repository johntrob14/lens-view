"""Open lens-view in a tmux pane beside the agent. Only paths and status cross the tool boundary."""
from __future__ import annotations
import os
import shlex
import shutil
import subprocess
import sys


class LaunchError(RuntimeError):
    """Messages are safe to return to the agent: they never contain document contents."""


def tmux(*args):
    result = subprocess.run(['tmux', *args], capture_output=True, text=True)
    if result.returncode:
        raise LaunchError('tmux operation failed; check the session and pane target.')
    return result.stdout.strip()


def parent_pid(pid: int) -> int:
    out = subprocess.run(['ps', '-o', 'ppid=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
    return int(out) if out.isdigit() else 0


def agent_pane(explicit: str | None = None) -> str | None:
    """Explicit pane, then TMUX_PANE, then the tmux pane whose process is an ancestor of this one.

    The ancestor walk covers agents that strip TMUX_PANE from MCP server environments.
    """
    if explicit:
        return explicit
    if os.environ.get('TMUX_PANE'):
        return os.environ['TMUX_PANE']
    try:
        rows = tmux('list-panes', '-a', '-F', '#{pane_pid} #{pane_id}')
    except LaunchError:
        return None
    panes = dict(line.split(' ', 1) for line in rows.splitlines() if ' ' in line)
    pid = os.getppid()
    while pid > 1:
        if str(pid) in panes:
            return panes[str(pid)]
        pid = parent_pid(pid)
    return None


def open_pane(args: list[str], target: str | None = None, width: str = '45%') -> dict:
    # Never open or read the document here; the renderer process owns document I/O.
    if not shutil.which('tmux'):
        raise LaunchError('tmux is missing. Install tmux, start the agent inside a tmux session, and retry.')
    target = agent_pane(target)
    if not target:
        raise LaunchError('No tmux pane found. Start the agent inside tmux (tmux new -s work), then retry, or pass an explicit pane id.')
    origin = tmux('display-message', '-p', '-t', target, '#{pane_id}')
    prefix = tmux('show-options', '-v', '-t', origin, 'prefix') or tmux('show-options', '-gv', 'prefix')
    prefix = prefix.replace('C-', 'Ctrl+').replace('M-', 'Alt+')
    hint = f'tmux: {prefix}, then o switch · {prefix}, then arrow select · {prefix}, then z zoom · q close viewer'
    # Same interpreter as this server, so the viewer runs with the package's dependencies.
    command = shlex.join([sys.executable, '-m', 'lens_view', *args, '--hint', hint])
    # Pane output belongs to tmux, never to the agent. No pipe-pane, capture-pane, or tee.
    pane = tmux('split-window', '-h', '-d', '-l', width, '-t', origin, '-P', '-F', '#{pane_id}', command)
    return {'viewer_pane': pane, 'agent_pane': origin, 'prefix': prefix, 'hint': hint}


def navigation(prefix: str) -> str:
    return (f'Tell the user how to navigate (press {prefix}, release, then the next key; not simultaneously): '
            f'{prefix} then o switches between agent and viewer; {prefix} then an arrow selects a neighboring pane; '
            f'{prefix} then z toggles full screen; q in the viewer closes it.')
