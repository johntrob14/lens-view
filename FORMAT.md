# Lens trace format (draft, `lens-view.v0`)

`lens-view` reads one JSON file per prompt. The format is a draft; change it when the J-lens implementation shows what it actually produces. `parse_trace` in `src/lens_view/trace.py` is the only code that reads it.

```json
{
  "format": "lens-view.v0",
  "model": "model name",
  "prompt": "The Eiffel Tower is in",
  "tokens": ["The", " E", "iff", "el", " Tower", " is", " in"],
  "targets": [" E", "iff", "el", " Tower", " is", " in", " Paris"],
  "lenses": [
    {
      "name": "logit",
      "layers": ["embed", "0", "1", "final"],
      "top_k": [[[[" the", 0.12], [",", 0.08]], "... one cell per position"], "... one row per layer"],
      "target_prob": [[0.01, "... per position"], "... per layer"]
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Always `lens-view.v0` for this version. |
| `tokens` | yes | Input tokens as decoded strings, one per position. |
| `targets` | no | Token each position is scored against, usually the next token. |
| `lenses[].name` | yes | Free text: `jlens`, `logit`, `tuned`, … |
| `lenses[].layers` | yes | Row labels. Lenses may cover different layers. |
| `lenses[].top_k` | yes | `[layer][position]` → list of `[token, prob]`, highest first. |
| `lenses[].target_prob` | no | `[layer][position]` → probability of `targets[position]`. |

Extra keys are ignored, so producers can attach lens-specific data (per-cell entropy, KL to final layer, Jacobian norms) before the viewer uses it.

## Connecting the implementation

1. **Now:** the lens code (notebook or script on the compute machine) writes a trace file. Copy or sync it locally and ask the agent to open it in lens-view; press `r` after rewriting the file.
2. **Later:** replace or supplement `load_trace` with a live source, e.g. a socket served by the process holding the model, so the viewer can request new prompts or layers.

`src/lens_view/example.json` is a tiny synthetic trace (not model output) for tests and a first look.
