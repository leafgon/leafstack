# Multi-Graph Local Workspaces and Batches

## Contents

- Graph addresses
- Local graph files
- Batch manifest
- Local planning and writes
- Force-directed local layout
- Remote apply and synchronization
- Ordering and failure semantics
- Security rules

## Graph addresses

Address every leaf-server graph by the pair `<domain-id>/<app-id>`. The pair is
the namespace; never infer one part from the other. Current `/qmgraphql` route
matching accepts letters, numbers, and hyphens in each part.

Use `https://www.leafgon.com/qmgraphql` for the public leaf-server endpoint.
Accept a different endpoint only when the user explicitly targets another
deployment.

## Local graph files

Store one graph per JSON file in the same shape returned by leaf-server and
accepted by GhostOS:

```json
{
  "domain": "domain-a",
  "appid": "app-one",
  "nodes": []
}
```

Keep edges nested in their source node's `out_edges`. Store node and edge
`data` as base64-encoded JSON. The batch tool also accepts decoded JSON objects
in operation payloads and encodes them before writing or submission.

Use files as working snapshots, not as persistence authority. Re-query
leaf-server after remote changes.

## Batch manifest

Use `leaf.graph-batch.v1`:

```json
{
  "format": "leaf.graph-batch.v1",
  "graphs": [
    {"domain": "domain-a", "appid": "app-one", "file": "graphs/domain-a/app-one.json"},
    {"domain": "domain-b", "appid": "app-two", "file": "graphs/domain-b/app-two.json", "create": true}
  ],
  "operations": [
    {
      "op": "addNode",
      "domain": "domain-b",
      "appid": "app-two",
      "node": {
        "uuid": "00000000-0000-4000-8000-000000000001",
        "leafnodetype": "leaflisp",
        "data": {"leaf": {"api": "breezyforest", "logic": {"type": "leaflisp", "args": {"lispexpression": "inport"}}, "appdata": {}}}
      }
    },
    {
      "op": "updateNode",
      "domain": "domain-a",
      "appid": "app-one",
      "uuid": "existing-node-uuid",
      "set": {"data": {"leaf": {"api": "breezyforest", "logic": {"type": "leaflisp", "args": {"lispexpression": "2"}}, "appdata": {}}}}
    },
    {
      "op": "addEdge",
      "domain": "domain-b",
      "appid": "app-two",
      "edge": {
        "uuid": "00000000-0000-4000-8000-000000000002",
        "source": "00000000-0000-4000-8000-000000000001",
        "target": "another-node-uuid",
        "data": {"leaf": {"api": "breezyforest", "logic": {"type": "leafdataedge"}}}
      }
    },
    {"op": "deleteEdge", "domain": "domain-a", "appid": "app-one", "uuid": "existing-edge-uuid"},
    {"op": "deleteNode", "domain": "domain-a", "appid": "app-one", "uuid": "obsolete-node-uuid"}
  ]
}
```

Resolve every `file` path relative to the batch manifest.

Supported operations are `addNode`, `updateNode`, `deleteNode`, `addEdge`, and
`deleteEdge`. For add operations, provenance defaults to the target graph; set
`node.provenance` or `edge.provenance` explicitly when it differs.

Set `create: true` only when a missing local file intentionally represents an
empty graph. It does not provision or authorize a server namespace. Remote
adds succeed only when leaf-server recognizes the target domain/app pair and
grants the caller write access.

## Force-directed local layout

Add an optional `layout` object to a graph declaration:

```json
{
  "domain": "domain-a",
  "appid": "app-one",
  "file": "graphs/domain-a/app-one.json",
  "layout": {
    "algorithm": "force-directed",
    "width": 1600,
    "height": 900,
    "padding": 80,
    "iterations": 300,
    "attraction": 1,
    "repulsion": 1,
    "edgeRepulsion": 0.5,
    "edgeNodeRepulsion": 1,
    "crossingPenalty": 2,
    "sharedSegmentPenalty": 1,
    "edgeClearance": 24,
    "sharedSegmentTolerance": 8,
    "gravity": 0.05,
    "collisionPadding": 16,
    "collisionIterations": 100,
    "failOnOverlap": true,
    "precision": 2
  }
}
```

The batch simulator runs the layout after every `addNode`, `deleteNode`,
`addEdge`, or `deleteEdge` targeting that graph. `updateNode` does not trigger
layout. Existing coordinates seed the simulation; missing or coincident
coordinates receive deterministic UUID-derived placement. All nested edge
types participate. Only encoded `leaf.appdata.position.x/y` changes; other
node data and any existing `position.z` remain intact.

Coordinates are React Flow top-left positions. Internally, layout uses node
centers and the bundled editor-box sizing profile:

| Editor category | Conservative outer box |
| --- | --- |
| circular, circular-named, boolean, element, error | 77 x 77 px |
| rectangular | 157 x 57 px |
| rectangular-named | 120 x 57 px; 145 x 57 px when the name exceeds 14 characters |
| tiny | 37 x 37 px |
| unknown/custom fallback | 75 x 75 px |

The outer boxes include the captured host padding and maximum selected border.
LEAF type to editor-category mappings live in
`scripts/lib/piper-node-dimensions.mjs`; `leafspelldef` width follows its
`spellname`. Override a custom or changed type without editing the mapping:

```json
"nodeDimensions": {
  "leafcustom": { "width": 180, "height": 90 }
}
```

Repulsion and edge attraction measure boundary-to-boundary clearance, so
connected nodes can group closely without their boxes overlapping.
`collisionPadding` is the minimum requested gap. Final deterministic collision
sweeps run up to `collisionIterations`; the result reports `overlapCount` and,
by default, fails if any overlap remains. Set `failOnOverlap: false` only when
an intentionally undersized canvas should produce a reviewable best effort.
Every node box, not merely its coordinate, must fit inside the padded canvas.

The edge geometry pass adds three topology-aware force families:

- `edgeRepulsion` separates nearby nonincident straight edges within
  `edgeClearance`.
- `edgeNodeRepulsion` pushes a nonincident node box and edge apart within the
  node radius plus `edgeClearance`.
- `crossingPenalty` separates strict interior crossings, while
  `sharedSegmentPenalty` separates collinear paths whose line distance is at
  most `sharedSegmentTolerance`.

Set any strength to `0` to disable that force; setting all four strengths to
`0` preserves the prior force simulation. Incident edges are excluded from
general edge repulsion and crossing checks because touching at their common
node is expected. The shared-segment force still handles incident edges that
actually overlap. Two straight edges with the same endpoint pair cannot be
separated by node-coordinate changes alone; use routed edge geometry when that
case must be shown distinctly.

Use the dependency-free helper directly when no batch manifest is involved:

```js
import { layoutLeafGraph } from "./.agents/skills/leaf/scripts/lib/leaf-force-layout.mjs";

const result = layoutLeafGraph(graph, { width: 1600, height: 900 });
const laidOutGraph = result.graph;
```

The input is not mutated. The result also reports sorted changed node UUIDs,
node/edge counts, `overlapCount`, `edgeCrossingCount`, `sharedSegmentCount`,
`edgeEdgeProximityCount`, `edgeNodeIntersectionCount`,
`edgeNodeProximityCount`, and `minimumEdgeDistance` without exposing decoded
node payloads. Local batch layout events include the same geometry diagnostics.

Layout is intentionally local-only. `--apply` rejects manifests containing
`graphs[].layout` because persisting the resulting coordinates requires
explicit reviewed `updateNode` mutations for every changed node. First use
`--write-local`, inspect the result, then author those updates as a separate
batch if server persistence is desired.

## Local planning and writes

Plan against all referenced local files without writing:

```sh
node .agents/skills/leaf/scripts/leaf-graph-batch.mjs path/to/batch.json
```

The plan validates addresses, payload encoding, type alignment, UUIDs,
endpoints, edge nesting, and every intermediate graph. It prints a confirmation
digest without printing decoded program data.

After reviewing the plan, apply the operations atomically per local file:

```sh
node .agents/skills/leaf/scripts/leaf-graph-batch.mjs path/to/batch.json \
  --write-local \
  --confirm sha256:REVIEWED_DIGEST
```

Then inspect and execute each affected graph with the graph inspector and the
selected GhostOS npm release.

## Remote apply and synchronization

Use a bearer API token with `graphql:read` and `graphql:write` scopes plus
write/admin/owner permission on every target graph. Keep it in an environment
variable and pass only the variable name:

```sh
node .agents/skills/leaf/scripts/leaf-graph-batch.mjs path/to/batch.json \
  --apply \
  --confirm sha256:REVIEWED_DIGEST \
  --confirm-endpoint https://www.leafgon.com/qmgraphql \
  --token-env LEAFGON_API_TOKEN
```

Add `--sync-local` to overwrite the declared graph files with authoritative
post-batch re-queries. Use `--endpoint` only for an explicitly selected
deployment.

The tool pre-queries every namespace, simulates the complete batch, executes
ordered mutations, validates each acknowledgement, re-queries every namespace,
and verifies changed objects. It captures server-generated edge UUIDs and
never prints the bearer token or mutation payload data.

## Ordering and failure semantics

Order operations so prerequisites exist:

1. Add or update nodes.
2. Add edges.
3. Delete edges.
4. Delete nodes.

Node deletion cascades connected-edge deletion. The manifest order is
preserved, so other intentional sequences are possible when they validate.

A multi-domain batch is not a transaction. Current `/qmgraphql` authorization
recognizes one mutation field and one graph scope per request. The tool uses
one reviewed batch invocation but sends separate, sequential, scope-authorized
requests. It stops at the first failure; earlier mutations may already be
persisted. Re-query before constructing a repair batch. Never claim rollback
or all-or-nothing behavior.

## Security rules

- Require the user to name every target domain/app pair.
- Review the digest immediately before local writes or remote apply.
- Confirm the exact normalized endpoint separately when applying remotely.
- Use HTTPS except for local mock servers.
- Do not put tokens, cookies, credentials, or secret-bearing graph data in the manifest.
- Do not print request bodies or raw server extensions; leaf events can contain one-time secrets.
- Treat `--apply` against leafgon.com as a live-state mutation.
