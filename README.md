# lens-view

A viewer for lens traces: what a [Jacobian lens](https://github.com/anthropics/jacobian-lens), logit lens or tuned lens reads out at every layer and token position. It runs beside a coding agent, so you can look at a trace while you work on the code that produced it.

The trace format is described in [FORMAT.md](FORMAT.md). It is a draft and will change.

## Front ends

| Where | What you get | Install |
| --- | --- | --- |
| Claude Code (default) | A mod: a `/lens-view <path>` command and a tool the model calls, both opening a pane inside Claude Code | Plugin, below |
| Codex, or any agent with MCP | An MCP tool, `lens_view`, that opens the terminal viewer in a tmux pane beside the agent | MCP, below |
| A terminal | The terminal viewer on its own: `lens-view trace.json` | `uv tool install git+https://github.com/johntrob14/lens-view` |

All three read traces through the Python package (`src/lens_view/trace.py`). The mod calls `lens-view-json`, which prints a trace as normalized JSON, so there is one parser.

All three need [uv](https://docs.astral.sh/uv/). The tmux front end needs the agent to run inside tmux.

### Claude Code plugin

```
/plugin marketplace add johntrob14/lens-view
/plugin install lens-view@lens-view
```

### Codex and other MCP clients

```toml
# ~/.codex/config.toml
[mcp_servers.lens-view]
command = "uv"
args = ["run", "--quiet", "--frozen", "--no-dev", "--project", "/path/to/lens-view", "lens-view-mcp"]
env_vars = ["TMUX", "TMUX_PANE"]
```

The repository also carries a Codex plugin manifest (`.codex-plugin/plugin.json`, `mcp.json`).

## Layout

| Path | What |
| --- | --- |
| `src/lens_view/trace.py` | Trace format: parsing, loading, `lens-view-json` |
| `src/lens_view/app.py` | Terminal viewer (Textual), `lens-view` |
| `src/lens_view/pane.py`, `mcp_server.py` | tmux pane launcher and MCP server, `lens-view-mcp` |
| `.claude-plugin/`, `hooks/`, `types/` | Claude Code plugin: the mod |
| `.codex-plugin/`, `mcp.json` | Codex plugin |

## Development

```bash
uv run --group dev pytest           # Python
claude plugin validate . && claude plugin test .   # the mod
```
