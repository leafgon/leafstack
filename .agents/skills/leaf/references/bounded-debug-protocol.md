# Bounded Debug Protocol

Use this protocol to reduce token-heavy exploration and converge quickly.

## Goal

Keep the runtime DTO loop deterministic:

1. validate shape;
2. preflight static + smoke;
3. inspect one failing node only;
4. retry once.

## Command budget

Use this sequence in order:

```sh
node .agents/skills/leaf/scripts/validate-runtime-dto.mjs --graph path/to/graph.json

node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph path/to/graph.json \
  --out-key OUT1 \
  --out-kind any \
  --diagnose
```

Only if a `refnode` exists:

```sh
node .agents/skills/leaf/scripts/decode-runtime-dto-payloads.mjs \
  --graph path/to/graph.json \
  --node <REFNODE> \
  --redact \
  --json
```

Re-run preflight once after the focused fix.

## Stop conditions

Stop and submit when preflight returns:

- `pass=true`
- `completion.readyToSubmit=true`
- `completion.stopNow=true`

Do not continue exploratory scans once those conditions are met.

## Avoid

- broad repo scans during runtime failure triage;
- guessing API schema from past artifacts;
- positional multi-input assumptions (`inport[0]`, `inport[1]`) for provenance;
- repeated smoke loops without a concrete code change.
