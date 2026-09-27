# Runtime DTO Submission Contract

Use this contract when a task requires a runnable LEAF artifact for
`executeLEAFGraph`.

## Accepted artifact shape

Submit a transport runtime DTO graph object with:

- top-level `domain`, `appid`, `nodes`;
- node identity and payload: `nodes[].uuid`, `nodes[].leafnodetype`,
  base64 JSON in `nodes[].data`;
- nested edges only in `nodes[].out_edges[]`, each with
  `uuid`, `source.uuid`, `target.uuid`, base64 JSON `data`.

## Rejected artifact shapes

Do not submit these as runtime artifacts:

- declarative schema shape (`kind: "leaf-graph"`, top-level `inputs/outputs`);
- mixed declarative/runtime fields in one artifact;
- custom top-level `edges` arrays (`nodes + edges`) instead of nested
  `nodes[].out_edges`.

## Minimal acceptance gate

Run these commands before declaring completion:

```sh
node .agents/skills/leaf/scripts/validate-runtime-dto.mjs --graph path/to/graph.json

node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph path/to/graph.json \
  --in1 11 \
  --out-key OUT1 \
  --out-kind any \
  --diagnose
```

If `preflight-runtime-dto.mjs` returns `completion.readyToSubmit=true`, stop and
submit the artifact. Do not continue exploratory retries after this signal.

## Optional artifact provenance metadata

You may include optional non-executed metadata fields for traceability, for
example:

```json
{
  "meta": {
    "authoredBy": "agent-name",
    "generatedAt": "2026-09-27T12:00:00Z",
    "taskId": "opaque-task-id",
    "toolVersion": "leafstack-vX.Y.Z"
  }
}
```

Keep runtime-critical fields unchanged. Metadata must not replace or reshape
`domain/appid/nodes/out_edges` contracts.

## HTTP arithmetic contract (when used)

For arithmetic over `leafelement(http)`, request payload must include:

- `:uri`
- `:mode`
- `:data` with `:operation` and `:operands`

Recommended:

- include `:profile` in `:data` (or rely on runtime default profile policy).

Do not use shell-template syntax inside LEAFlisp strings (for example
`${ENV_VAR:-fallback}`); those templates are not expanded by LEAFlisp runtime.

Parser nodes should unwrap bottle/content, then read `:result` with nil safety.

## Deterministic multi-input joins

When multiple edges flow into a `leaflisp` node, do not rely on positional
indexing (`(get inport 0)`, `(get inport 1)`) to infer provenance.

Use bottled provenance names and/or a `leafmixflow` merge barrier, then resolve
keys deterministically in downstream `leaflisp`.
