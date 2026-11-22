# Leafspelldef test harness (local)

Use this harness to reproduce browser **leafspelldef menu → test** behavior with
local `executeLEAFGraph` runs.

Script:

```sh
node .agents/skills/leaf/scripts/run-leafspelldef-test.mjs ...
```

The harness wraps `run-leaf-graph.mjs`, so it keeps the same GhostOS version
checks and supports `--version`, `--ghostos-dir`, `--skip-version-check`,
`--quiet`, `--error-json`, `--json-indent`, and `--log-file`.

## What it emulates

- **`menu-test` (default)**: builds input as browser menu/test flows normally do:

```json
{
  "touchevent": { "_refnode": "<target leafspelldef uuid>" },
  "data": "<your payload>"
}
```

- **`cast-spell`**: builds direct wildcard dispatch payload:

```json
{
  "_bname": "cast-spell",
  "_content": {
    "nodeuuid": "<target leafspelldef uuid>",
    "input": "<your payload>"
  },
  "_label": {}
}
```

## Minimal usage

Run by explicit entry-node UUID:

```sh
node .agents/skills/leaf/scripts/run-leafspelldef-test.mjs \
  --graph sessions/breezyforest-tests.graph.json \
  --target-nodeuuid ce36aee2-7e1e-4a84-ba65-6db66e0da0cb \
  --entry-refnode 9305df15-3888-4314-95fd-85369e9bbf25 \
  --input sessions/hpc-intent.json
```

Run by resolving the entry `leafspell` via spell name:

```sh
node .agents/skills/leaf/scripts/run-leafspelldef-test.mjs \
  --graph sessions/breezyforest-tests.graph.json \
  --target-nodeuuid ce36aee2-7e1e-4a84-ba65-6db66e0da0cb \
  --entry-spellname test-hpc-element \
  --input sessions/hpc-intent.json
```

Switch to direct wildcard payload mode:

```sh
node .agents/skills/leaf/scripts/run-leafspelldef-test.mjs \
  --graph sessions/breezyforest-tests.graph.json \
  --target-nodeuuid ce36aee2-7e1e-4a84-ba65-6db66e0da0cb \
  --entry-spellname test-hpc-element \
  --variant cast-spell \
  --input sessions/hpc-intent.json
```

## Output

The harness emits JSON with:

- `mode: "leafspelldef-test-harness"`
- `invocation`: resolved entry/target metadata and generated input path
- `run`: raw `run-leaf-graph.mjs` output (`runtimeOptions`, graph input, and
  runtime output)

Use `run.output` for exact runtime evidence.

## Requirements and boundaries

- `--target-nodeuuid` must be a UUID.
- Provide exactly one entry selector: `--entry-refnode` or
  `--entry-spellname`.
- `--entry-spellname` resolves only `leafspell` nodes and requires exactly one
  match in the graph fixture.
- This harness is for local/runtime reproduction; it does not mutate leaf-server
  state on its own.

