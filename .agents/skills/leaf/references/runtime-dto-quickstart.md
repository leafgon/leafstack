# Runtime DTO Quickstart

Use this when you need a fast, general-purpose path to a runnable LEAF artifact.

## 1) Build or scaffold

Start from a runtime DTO graph (`domain`, `appid`, `nodes[].uuid`, base64
`data`, nested `out_edges`).

## 2) Validate shape

```sh
node .agents/skills/leaf/scripts/validate-runtime-dto.mjs --graph path/to/graph.json
```

If validation fails, fix artifact shape before any smoke run.

## 3) Run preflight with diagnostics

```sh
node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph path/to/graph.json \
  --in1 11 \
  --out-key OUT1 \
  --out-kind any \
  --diagnose
```

Apply the first concrete fix from `diagnostics.issues`, then rerun preflight.

## 4) Stop when done

Stop immediately when output contains:

- `pass=true`
- `completion.readyToSubmit=true`
- `completion.stopNow=true`

## Retry budget

Keep retries bounded:

1. one preflight run
2. one focused fix
3. one preflight rerun

Only if a `refnode` is present, run one targeted payload decode:

```sh
node .agents/skills/leaf/scripts/decode-runtime-dto-payloads.mjs \
  --graph path/to/graph.json \
  --node <REFNODE> \
  --redact \
  --json
```
