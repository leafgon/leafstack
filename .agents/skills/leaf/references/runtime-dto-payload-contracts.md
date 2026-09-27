# Runtime DTO Payload Contracts

Use this reference when authoring LEAF runtime DTO graphs that execute with
`executeLEAFGraph` and when validating base64 payloads for common node types.

Also read:

- [runtime-dto-submission-contract.md](runtime-dto-submission-contract.md)
- [runtime-dto-quickstart.md](runtime-dto-quickstart.md)
- [leaflisp-gotchas.md](leaflisp-gotchas.md)
- [bounded-debug-protocol.md](bounded-debug-protocol.md)
- [runtime-dto-failure-cookbook.md](runtime-dto-failure-cookbook.md)

This document is intentionally general-purpose (not benchmark-specific).

## Operational contracts by `leafnodetype` (prevent contract guessing)

Use this matrix as the authoritative runtime contract surface when wiring a
graph. If a run fails, fix against this section first before probing.

| `leafnodetype` | Required contract | Input shape expectation | Output shape expectation |
|---|---|---|---|
| `leafinflowport` | Source port only. Keep stable source UUID for required input keys. | Runtime input object, typically `{ IN1: <number> }`. | Pass-through source payload to outgoing edges (often bottle-like `elementio`). |
| `leafoutflowport` | Sink port only. Required sink UUID/key (for example `OUT1`) must exist and be reachable by at least one incoming path. | One computed upstream value path. | Final output object contains required sink key, for example `{ OUT1: <scalar or vector> }`. |
| `leaflisp` (request builder) | Emit bottle `"http-request"` containing `uri`, `mode`, and `data.{profile,operation,operands}`. | Source value or bottle content. | Bottle: `{ _bname:"http-request", _content:{...request...} }`. |
| `leafelement` with `elementname:"http"` | Consume a `"http-request"` bottle and execute HTTP call. | Bottle request payload from upstream `leaflisp`. | Bottle-like `elementio`; success `_content` contains response JSON; failures may carry error payload. |
| `leaflisp` (response parser) | Nil-safe unwrap of bottle/content; read `:result`; avoid unchecked pair/index assumptions. | `elementio` bottle or plain response payload. | Numeric result (or named bottle when composing joins). |
| `leafmixflow` | Deterministic provenance merge for multi-input joins; prefer keyed bottle merge over index access. | Array of bottled inputs from multiple edges. | Key-value map payload for deterministic downstream `get` access. |
| `leafgateflow` | Dependency/value gate only; does not replace parser/sink requirements. | Upstream payload(s) for gate condition routing. | Routed payload or gated branch output. |
| `leafchronosflow` | Ordering/barrier control only; preserve data-path contracts on adjacent nodes. | Upstream payload(s) plus ordering boundary. | Ordered pass-through/barrier output. |
| `leafspell` / `leafspelldef` | Use only when subgraph dispatch is intentional; do not use to bypass runtime DTO transport contract. | Spell invocation payload. | Spell/subgraph result payload. |

## Canonical IN1 -> HTTP -> OUT1 pattern

Use this as the default authored path before any optimization/refactor:

```text
IN1 -> REQ_HTTP(leaflisp) -> HTTP_ARITH(leafelement http) -> PARSE_HTTP(leaflisp) -> OUT1
```

Minimal request-builder (`REQ_HTTP`) expression:

```clojure
(do
  (def x (get inport :IN1))
  (def request {
    :uri "http://127.0.0.1:8080/v1/operations"
    :mode "post"
    :header {:content-type "application/json"}
    :data {
      :profile "profile-001"
      :operation "add"
      :operands [x 2]
    }
  })
  (bottle "http-request" request))
```

Minimal nil-safe parser (`PARSE_HTTP`) expression:

```clojure
(do
  (def payloadzero (if (isbottle inport) (get inport :_content) inport))
  (def payload (if (isbottle payloadzero) (get payloadzero :_content) payloadzero))
  (def result (get payload :result))
  (if (isnil result) nil result))
```

For fan-in joins, bottle named branch results and merge with `leafmixflow`
before downstream `leaflisp` key access.

## Transport DTO contract (top-level)

Required graph envelope:

```json
{
  "domain": "<domain-id>",
  "appid": "<app-id>",
  "nodes": [
    {
      "uuid": "<node-uuid>",
      "leafnodetype": "<leaf node type>",
      "data": "<base64-json>",
      "out_edges": [
        {
          "uuid": "<edge-uuid>",
          "source": { "uuid": "<source-node-uuid>" },
          "target": { "uuid": "<target-node-uuid>" },
          "data": "<base64-json>"
        }
      ]
    }
  ]
}
```

Rules:

- Use runtime transport DTO fields (`uuid`, `leafnodetype`, base64 `data`,
  nested `out_edges`).
- Do not use declarative graph fields (`kind`, `inputs`, `outputs`,
  `nodes[].id`, `nodes[].element`) in runtime fixtures.
- Keep `nodes[].leafnodetype` aligned with decoded
  `nodes[].data.leaf.logic.type`.

## `leafelement(http)` payload contract

Use a bottle request into `leafelement(http)`:

```json
{
  "_bname": "http-request",
  "_content": {
    "uri": "http://127.0.0.1:8080/v1/operations",
    "mode": "post",
    "header": { "content-type": "application/json" },
    "data": {
      "profile": "profile-001",
      "operation": "add",
      "operands": [11, 2]
    }
  },
  "_label": {}
}
```

Required request keys for arithmetic API contract:

- `uri`
- `mode`
- `data.operation`
- `data.operands`

Recommended:

- `data.profile`

Do not embed shell templates such as `${ARITHMETIC_PROFILE_ID:-profile-001}` in
LEAFlisp expression strings; LEAFlisp does not perform shell expansion.

Expected API response envelope from the delayed arithmetic service:

```json
{
  "result": 13
}
```

Expected downstream envelope from `leafelement(http)`:

- Success: `_bname: "elementio"` and JSON response in `_content`.
- Failure: `_bname: "elementio"` and `_content: null`.

Recommended parse flow for HTTP result extraction (`leaflisp`):

```clojure
(do
  (def payloadzero (if (isbottle inport) (get inport :_content) inport))
  (def payload (if (isbottle payloadzero) (get payloadzero :_content) payloadzero))
  (def result (get payload :result))
  (if (isnil result) nil result))
```

Do not parse or index optimistic pair shapes before nil checks. In particular,
avoid `(parse (get payload :result))` and unguarded `(get pair 0|1)` forms.

## Canonical template JSON

Use this as the baseline authoring template:

- `.agents/skills/leaf/references/examples/runtime-dto-contract-template.json`

It contains one coherent HTTP data path plus contract examples for
`leafgateflow`, `leafmixflow`, `leafchronosflow`, `leafspell`, and
`leafspelldef` payloads.

## Base64-decoded node payload shapes by `leafnodetype`

### `leafinflowport`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": { "type": "leafinflowport", "args": {} },
    "appdata": { "position": { "x": 80, "y": 120 } }
  }
}
```

### `leafoutflowport`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": { "type": "leafoutflowport", "args": {} },
    "appdata": { "position": { "x": 1600, "y": 120 } }
  }
}
```

### `leaflisp`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": {
      "type": "leaflisp",
      "args": {
        "lispexpression": "(do (def payloadzero (if (isbottle inport) (get inport :_content) inport)) (def payload (if (isbottle payloadzero) (get payloadzero :_content) payloadzero)) (def result (get payload :result)) (if (isnil result) nil result))"
      }
    },
    "appdata": { "position": { "x": 940, "y": 120 } }
  }
}
```

### `leafelement` (HTTP)

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": {
      "type": "leafelement",
      "args": {
        "elementname": "http",
        "svgicon": { "unicode": null, "url": "", "jsx": null },
        "elementconfig": ""
      }
    },
    "appdata": { "position": { "x": 500, "y": 120 } }
  }
}
```

### `leafgateflow`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": {
      "type": "leafgateflow",
      "args": { "keyname": "elementio", "notgatetoggle": false }
    },
    "appdata": { "position": { "x": 720, "y": 120 } }
  }
}
```

### `leafmixflow`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": {
      "type": "leafmixflow",
      "args": { "mixOperator": "dictionary" }
    },
    "appdata": { "position": { "x": 1160, "y": 160 } }
  }
}
```

For deterministic provenance-aware joins, feed an array of bottled values into
`leafmixflow` and consume the merged map in downstream `leaflisp`.

Conceptual pattern:

```clojure
; upstream leaflisp nodes
(bottle "sum-branch" sumValue)
(bottle "pow-branch" powValue)

; after leafmixflow(dictionary), downstream leaflisp receives map-like payload
(do
  (def merged (if (isbottle inport) (get inport :_content) inport))
  (def lhs (get merged :sum-branch))
  (def rhs (get merged :pow-branch))
  (+ lhs rhs))
```

Do not rely on positional multi-input reads (`(get inport 0/1)`) to identify
which upstream edge produced which value.

## Node behavior quick matrix

| Node type | Use for | Input expectation | Output expectation | Common mistake |
|---|---|---|---|---|
| `leafgateflow` | Admit only named bottle channels | bottle or map-like flow with key labels | gated stream for matching key | treating it as value transformer |
| `leafmixflow` | Deterministic join/merge of upstream values | multiple bottled or keyed upstream values | merged dictionary-like payload | assuming positional edge order |
| `leafchronosflow` | time/scheduling boundary in flow graph | upstream event/value | deferred/timed emission | using it as arithmetic node |
| `leafspell` | invoke named reusable spell | invocation payload and connected lambda/data edges | spell invocation output | spelling mismatch with spelldef |
| `leafspelldef` | define reusable spell boundary | internal spell graph wiring | exportable spell endpoint | missing callable spell name wiring |

## Minimal spell call/definition wiring

When combining `leafspell` and `leafspelldef`, keep names consistent and
provide at least one deterministic in->out path inside the spell definition.

Conceptual checklist:

1. `leafspelldef.args.spellname` exactly matches `leafspell.args.spellname`.
2. Spell graph has a clear entry node and one output path.
3. Runtime DTO payload for both nodes has canonical `leaf.logic.type` and args.

### `leafchronosflow`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": { "type": "leafchronosflow", "args": {} },
    "appdata": { "position": { "x": 940, "y": 260 } }
  }
}
```

### `leafspell`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": {
      "type": "leafspell",
      "args": { "spellname": "passthrough-spell" }
    },
    "appdata": { "position": { "x": 1380, "y": 120 } }
  }
}
```

### `leafspelldef`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": {
      "type": "leafspelldef",
      "args": {
        "spellname": "passthrough-spell",
        "svgicon": { "url": "" }
      }
    },
    "appdata": { "position": { "x": 1160, "y": 340 } }
  }
}
```

## Base64-decoded edge payload shapes

### `leafdataedge`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": { "type": "leafdataedge" },
    "appdata": { "sourceHandle": "out_a", "targetHandle": "in_a" }
  }
}
```

### `leaflambdaedge`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": { "type": "leaflambdaedge" }
  }
}
```

### `leafanchoredge`

```json
{
  "leaf": {
    "api": "breezyforest",
    "logic": { "type": "leafanchoredge" }
  }
}
```

## Encode/decode helpers

Decode a node payload:

```sh
echo '<base64>' | base64 --decode
```

Decode runtime DTO nodes/edges without manual base64 handling:

```sh
node .agents/skills/leaf/scripts/decode-runtime-dto-payloads.mjs \
  --graph .agents/skills/leaf/references/examples/runtime-dto-contract-template.json \
  --node REQ_HTTP \
  --edge E02_REQ_TO_HTTP \
  --redact \
  --json
```

Use `--all` to decode all node/edge payloads and `--full` to include complete
decoded JSON objects instead of shape summaries only. Use `--redact` whenever
you plan to share decoded payload output.

Encode JSON to base64 with Node.js:

```sh
node -e 'console.log(Buffer.from(JSON.stringify({leaf:{logic:{type:"leafinflowport",args:{}}}}),"utf8").toString("base64"))'
```
