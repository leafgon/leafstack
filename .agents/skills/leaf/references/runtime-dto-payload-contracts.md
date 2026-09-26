# Runtime DTO Payload Contracts

Use this reference when authoring LEAF runtime DTO graphs that execute with
`executeLEAFGraph` and when validating base64 payloads for common node types.

This document is intentionally general-purpose (not benchmark-specific).

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
      "operationId": "op-01",
      "operation": "add",
      "operands": [11, 2]
    }
  },
  "_label": {}
}
```

Expected downstream envelope from `leafelement(http)`:

- Success: `_bname: "elementio"` and JSON response in `_content`.
- Failure: `_bname: "elementio"` and `_content: null`.

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
        "lispexpression": "(do (def payload (if (isbottle inport) (get inport :_content) inport)) (get payload :result))"
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
