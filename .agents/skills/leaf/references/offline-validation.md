# Offline DAG Contracts and Acceptance Validation

## Purpose

When an offline task pack defines an authoritative dependency DAG, separate two
concerns explicitly:

1. **Contract data DAG** (`leafdataedge`) that must match the spec exactly.
2. **Runtime support wiring** (for example `leafspelldef` + `leaflambdaedge`)
   required to make spells executable.

Use contract checks against the data DAG only. Support wiring is allowed when it
does not alter the contract DAG.

## Contract edge check

Create a required-edge file containing only authoritative data edges:

```json
[
  "IN1->M1",
  "IN1->M2",
  "IN2->N1",
  "M1->SP1",
  "M2->SP2",
  "N1->SP2",
  "SP1->F1",
  "SP2->F1",
  "M1->F1",
  "F1->OUT1"
]
```

Run the contract validator:

```sh
node .agents/skills/leaf/scripts/validate-dag-contract.mjs \
  --graph path/to/graph.json \
  --required path/to/required-data-edges.json
```

The validator checks:

- missing required direct data edges,
- unexpected contract-scope direct data edges,
- missing expected contract reachability,
- unexpected contract reachability.

Support/lambda wiring is ignored unless it leaks into contract data edges.

## Acceptance vectors

Create an acceptance vector file:

```json
{
  "refnode": "OUT1",
  "cases": [
    {"case": 1, "input": {"IN1": 4, "IN2": 9}, "expected": {"OUT1": 22}},
    {"case": 2, "input": {"IN1": 10, "IN2": 1}, "expected": {"OUT1": 60}}
  ]
}
```

Run acceptance checks with GhostOS:

```sh
node .agents/skills/leaf/scripts/run-acceptance-vectors.mjs \
  --graph path/to/graph.json \
  --vectors path/to/acceptance-vectors.json
```

Validate runtime DTO shape before DAG/acceptance checks:

```sh
node .agents/skills/leaf/scripts/validate-runtime-dto.mjs \
  --graph path/to/graph.json
```

Run a fast smoke execution gate before full vectors:

```sh
node .agents/skills/leaf/scripts/run-runtime-dto-smoke.mjs \
  --graph path/to/graph.json \
  --in1 11
```

Use `--version` and/or `--ghostos-dir` when the task pins a runtime release.

## Inspection caveat

`inspect-leaf-graph.mjs` may report additional components/start/end nodes when
spell-definition support nodes are present. That is expected. Treat the data
contract result from `validate-dag-contract.mjs` as the authoritative check for
spec-defined DAG fidelity.

## Fixture location

For reusable and reviewable skill fixtures, store graph files and contract/
acceptance files under `references/examples/`. Avoid `artifacts/` for committed
skill fixtures because that path is typically gitignored.
