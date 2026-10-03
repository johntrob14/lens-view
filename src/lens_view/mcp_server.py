"""MCP server for lens-view: opens the viewer in a tmux pane beside the agent (Claude Code, Codex, ...)."""
from __future__ import annotations
import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .pane import LaunchError, navigation, open_pane

server = FastMCP('lens-view', instructions=(
    'lens-view opens in a tmux pane beside the agent. What it shows is never returned to the agent; '
    'report that the viewer opened without claiming to have read the trace, and relay the navigation '
    'reminder from each result to the user.'))


@server.tool()
def lens_view(path: str | None = None, lens: str | None = None, pane: str | None = None) -> str:
    """Open lens-view, the terminal viewer for lens traces (J-lens, logit lens, tuned lens, ...).

    Use when the user asks to open lens-view, the J-lens viewer, or a lens trace. `path` is a
    lens-view.v0 JSON trace (format: FORMAT.md in the lens-view repository); omit it to open the viewer
    empty. `lens` selects which lens to show first by name. `pane` is an explicit tmux pane id such
    as %3, only when the user's pane is known.
    """
    args = []
    if path:
        file = Path(path).expanduser()
        file = (file if file.is_absolute() else Path(os.getcwd()) / file).absolute()
        if not file.is_file():
            raise RuntimeError(f'Not a regular file: {file}')
        args.append(str(file))
    if lens:
        args += ['--lens', lens]
    try:
        result = open_pane(args, pane)
    except LaunchError as exc:
        raise RuntimeError(str(exc)) from None
    label = 'lens-view' + (f' for {args[0]}' if path else '')
    return (f'Opened {label} in tmux pane {result["viewer_pane"]} beside agent pane {result["agent_pane"]}. '
            f'The content was not returned to you and has not been verified. {navigation(result["prefix"])}')


def main():
    server.run()


if __name__ == '__main__':
    main()
