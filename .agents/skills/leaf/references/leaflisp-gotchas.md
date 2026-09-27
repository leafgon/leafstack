# LEAFlisp Gotchas

Use this quick reference to avoid dialect drift that causes long debug loops.

## Unsupported tokens commonly seen in failed sessions

These patterns are not valid LEAFlisp authoring shortcuts in this skill:

- `(list ...)`
- `(vector ...)`
- `(array ...)`
- `inport2` (or other implicit extra inport aliases)

`preflight-runtime-dto.mjs` now blocks these patterns as static contract
violations.

## Safer replacements

- Use direct map/vector literals when needed in your target runtime grammar.
- For multi-input joins, encode provenance in bottled payload names instead of
  positional assumptions.
- Prefer `leafmixflow` as a deterministic merge barrier before downstream
  `leaflisp` lookups.

## Multi-input anti-pattern

Avoid this in `leaflisp` when multiple edges feed the node:

```clojure
(do (def a (get inport 0)) (def b (get inport 1)) ...)
```

Use provenance-safe screening/lookup instead.

## Fast recovery path

When runtime fails, run:

```sh
node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph path/to/graph.json \
  --out-key OUT1 \
  --out-kind any \
  --diagnose
```

Then apply only the first concrete fix from `diagnostics.issues`.
