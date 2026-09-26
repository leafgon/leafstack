# Runtime DTO Authoring Kit

Use this guide when you need a LEAF graph artifact that runs directly with
`executeLEAFGraph` and avoids GhostOS internals spelunking.

For generalized node/edge payload contracts and decoded base64 shapes, read
[runtime-dto-payload-contracts.md](runtime-dto-payload-contracts.md).

## What this kit guarantees

- Authoring starts from a transport DTO scaffold (`domain`, `appid`,
  `nodes[].uuid`, `leafnodetype`, base64 `data`, nested `out_edges`).
- Validation rejects declarative `kind: "leaf-graph"` and JSON-LD-like node
  shapes (`id`, `element`, `inputs`, `outputs`) for runtime fixtures.
- Smoke run executes the authored runtime DTO with GhostOS.

## One-command path

Use this for fast authoring when you want scaffold + shape validation in one
step (and optional smoke execution):

```sh
node .agents/skills/leaf/scripts/runtime-dto-kit.mjs \
  --out .agents/skills/leaf/references/examples/runtime-dto-http-arith.json \
  --domain example \
  --appid runtime-dto-http-arith \
  --operation add \
  --constant 2 \
  --operation-id op-01 \
  --skip-smoke
```

Remove `--skip-smoke` to execute `run-runtime-dto-smoke.mjs` as part of the
same command.

## 1) Scaffold a runtime DTO graph

Create a minimal HTTP arithmetic graph:

```sh
node .agents/skills/leaf/scripts/scaffold-runtime-dto.mjs \
  --out .agents/skills/leaf/references/examples/runtime-dto-http-arith.json \
  --domain example \
  --appid runtime-dto-http-arith \
  --operation add \
  --constant 2 \
  --operation-id op-01
```

The scaffold wires:

```text
IN1 -> REQ_HTTP(leaflisp) -> HTTP_ARITH(leafelement http) -> PARSE_HTTP(leaflisp) -> OUT1
```

## 2) Validate runtime DTO shape

```sh
node .agents/skills/leaf/scripts/validate-runtime-dto.mjs \
  --graph .agents/skills/leaf/references/examples/runtime-dto-http-arith.json
```

Validation checks include:

- top-level `domain`, `appid`, `nodes`;
- node identity (`uuid`, `leafnodetype`), base64 JSON `data`, nested
  `leaf.logic.type`;
- nested `out_edges` shape and base64 edge `data`;
- declarative-shape rejection.

## 3) Smoke run with executeLEAFGraph

```sh
node .agents/skills/leaf/scripts/run-runtime-dto-smoke.mjs \
  --graph .agents/skills/leaf/references/examples/runtime-dto-http-arith.json \
  --in1 11 \
  --quiet
```

Use `--version` and `--ghostos-dir` exactly as in `run-leaf-graph.mjs` when a
specific runtime release is required.

## 4) Preflight output-shape gate (recommended)

Use the preflight helper to run shape validation + smoke execution + output
contract checks in one command:

```sh
node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph .agents/skills/leaf/references/examples/runtime-dto-http-arith.json \
  --in1 11 \
  --out-key OUT1 \
  --out-kind scalar \
  --quiet \
  --log-file .tmp/leaf-preflight.log
```

For vector outputs, require length explicitly:

```sh
node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph path/to/graph.json \
  --out-key OUT1 \
  --out-kind vector \
  --out-length 6 \
  --quiet
```

## Common failure patterns

- `The first argument must be of type string ... Received undefined` usually
  indicates a malformed `data` field on node or edge (non-base64 JSON).
- `_default`-related weave errors usually indicate node logic payload mismatch
  (decoded `leaf.logic.type` does not match executable expectation).
- `OPERATION_ID_NOT_FOUND` indicates runtime request payload mismatch to the
  selected latency profile.

Use the runtime explainer to classify common stderr signatures and (optionally)
attach runtime DTO diagnostics:

```sh
node .agents/skills/leaf/scripts/explain-runtime-error.mjs \
  --stderr path/to/stderr.log \
  --graph path/to/graph.json
```

For targeted payload inspection without manual base64 decoding:

```sh
node .agents/skills/leaf/scripts/decode-runtime-dto-payloads.mjs \
  --graph path/to/graph.json \
  --node REQ_HTTP \
  --redact \
  --json
```

## Recommended benchmark workflow

For generated artifacts, require this order before submission:

1. `scaffold-runtime-dto.mjs` (or equivalent DTO construction).
2. `validate-runtime-dto.mjs` (shape gate).
3. `run-runtime-dto-smoke.mjs` (execution gate).
4. `preflight-runtime-dto.mjs` (combined readiness + output-shape gate).

This keeps runtime fixture quality high without reverse-engineering bundled
GhostOS internals.
