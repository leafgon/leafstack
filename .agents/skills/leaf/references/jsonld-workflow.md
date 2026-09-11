# JSON-LD Offline Authoring Workflow

## Purpose

Use JSON-LD as the semantic storage format while keeping executable LEAF graph
JSON in the GhostOS transport DTO shape.

Source of truth options:

- JSON-LD files for semantic authoring and review.
- Transport DTO graph JSON for direct execution (`executeLEAFGraph`) and server
  compatibility.

## JSON-LD shape

Use this envelope:

```json
{
  "@context": "https://leafgon.com/ns/leaf-graph-jsonld/v1",
  "@id": "leaf://example/app",
  "@type": "LeafGraph",
  "domain": "example",
  "appid": "app",
  "nodes": [
    {
      "@id": "leaf://example/app/node/node-a",
      "@type": "LeafNode",
      "uuid": "node-a",
      "leafnodetype": "leaflisp",
      "data": {"leaf": {"logic": {"type": "leaflisp", "args": {"lispexpression": "inport"}}, "appdata": {}}}
    }
  ],
  "edges": [
    {
      "@id": "leaf://example/app/edge/edge-a-b",
      "@type": "LeafEdge",
      "uuid": "edge-a-b",
      "source": "node-a",
      "target": "node-b",
      "edgeType": "leafdataedge",
      "data": {"leaf": {"logic": {"type": "leafdataedge"}}}
    }
  ]
}
```

Rules:

- Keep `nodes[].leafnodetype` equal to `nodes[].data.leaf.logic.type`.
- Keep edges explicit in `edges[]`; conversion re-nests them into source
  `out_edges` for transport DTO output.
- Keep `data` decoded JSON in JSON-LD; conversion handles base64 encoding.

## Tight helper workflow

1. Author JSON-LD source.
2. Build executable graph JSON.
3. Inspect graph structure.
4. Execute representative inputs with GhostOS.
5. Optional export back to JSON-LD to normalize and diff.

One-command wrapper (build -> inspect -> execute -> optional roundtrip export):

```sh
node .agents/skills/leaf/scripts/leaf-jsonld-workflow.mjs \
  --jsonld path/to/graph.jsonld \
  --graph-out path/to/graph.json \
  --refnode target-node-uuid \
  --input path/to/input.json \
  --jsonld-roundtrip-out path/to/graph.roundtrip.jsonld
```

Use `--skip-run` to compile and inspect only.

Make alias:

```sh
make leaf-jsonld-workflow ARGS="--jsonld path/to/graph.jsonld --skip-run"
```

### Build: JSON-LD -> executable graph JSON

```sh
node .agents/skills/leaf/scripts/leaf-jsonld-build.mjs \
  --jsonld path/to/graph.jsonld \
  --out path/to/graph.json
```

### Inspect transport DTO integrity

```sh
node .agents/skills/leaf/scripts/inspect-leaf-graph.mjs path/to/graph.json
```

### Execute graph with GhostOS runtime

```sh
node .agents/skills/leaf/scripts/run-leaf-graph.mjs \
  --graph path/to/graph.json \
  --refnode target-node-uuid \
  --input path/to/input.json
```

### Export transport DTO back to JSON-LD

```sh
node .agents/skills/leaf/scripts/leaf-jsonld-export.mjs \
  --graph path/to/graph.json \
  --out path/to/graph.roundtrip.jsonld
```

## Example files

- `references/examples/offline-graph.jsonld`
- `references/examples/offline-graph.json`
- `references/examples/offline-batch.json`
