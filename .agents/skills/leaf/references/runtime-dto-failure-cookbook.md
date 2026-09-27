# Runtime DTO Failure Cookbook

Use this cookbook when preflight/fastlane fails. Apply exactly one targeted fix,
then rerun preflight.

Also read:

- [runtime-dto-payload-contracts.md](runtime-dto-payload-contracts.md)
- [runtime-dto-authoring-kit.md](runtime-dto-authoring-kit.md)
- [bounded-debug-protocol.md](bounded-debug-protocol.md)

## Canonical loop

```sh
node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph path/to/graph.json \
  --in1 11 \
  --out-key OUT1 \
  --out-kind any \
  --diagnose
```

On first pass with `completion.stopNow=true`, stop and submit.

## First-fix recipes by check/code

### `missing-output-key:OUT1`

Symptom:

- Preflight passes shape, but output check reports missing `OUT1`.

Fix:

1. Ensure node `OUT1` exists and uses `leafoutflowport`.
2. Ensure at least one compute/parse node has an outgoing edge targeting `OUT1`.
3. Ensure upstream parser emits final scalar/vector value (not empty elementio).
4. Rerun preflight once.

### `static-contract:http-node-missing-request-source`

Symptom:

- `leafelement(http)` has no incoming request builder.

Fix:

1. Add upstream `leaflisp` request builder node.
2. Emit bottle `"http-request"` with required fields.
3. Wire request builder edge into the HTTP node.

### `static-contract:http-request-source-missing-http-request-bottle`

Symptom:

- Request builder exists but does not emit bottle `"http-request"`.

Fix:

1. Return `(bottle "http-request" request)` from request builder.
2. Keep request map shape:
   `{ :uri, :mode, :header, :data{:profile,:operation,:operands} }`.

### `static-contract:http-request-source-missing-required-token`

Symptom:

- Request expression omits one or more required keys.

Fix:

1. Ensure request expression includes all required keys:
   `:uri`, `:mode`, `:data`, `:operation`, `:operands`.
2. Keep `:profile` present for deterministic profile selection.

### `static-contract:http-parse-target-missing-result-read`

Symptom:

- Parse node is wired from HTTP but does not read `:result`.

Fix:

1. Unwrap bottle/content nil-safely.
2. Read `:result`.
3. Return scalar (or named bottle for join flows).

### `leaflisp-unsupported-token-*`

Symptom:

- Expression uses non-LEAFlisp forms (`list`, `vector`, `array`, `inport2`).

Fix:

1. Rewrite with supported LEAFlisp core forms.
2. For joins, use bottle naming and `leafmixflow` keyed merge.

### `leaflisp-literal-shell-template` or `http-request-source-literal-shell-template`

Symptom:

- LEAFlisp includes literal `${...}` template syntax.

Fix:

1. Remove shell-template syntax from LEAFlisp.
2. Set values directly in payload maps.

### `operation_not_found`

Symptom:

- API rejects operation key.

Fix:

1. Restrict to `add|subtract|multiply|divide|power`.
2. Verify request uses `{ profile, operation, operands }`.

### `profile_not_found`

Symptom:

- API rejects selected profile.

Fix:

1. Use valid profile ID (`profile-001` unless overridden).
2. Verify runtime environment/profile config.

### `runner_empty_output`

Symptom:

- Runtime exits without parseable output.

Fix:

1. Validate graph shape first.
2. Re-run preflight with `--diagnose`.
3. Apply first issue in diagnostics, then rerun once.

## Bounded triage rules

- Do not run broad probe matrices.
- Do not create many temporary graph variants in one cycle.
- Prefer one fix per cycle, then rerun preflight.
