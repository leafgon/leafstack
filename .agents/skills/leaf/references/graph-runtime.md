# LEAF Graph Model and Runtime

## Contents

- Transport DTO
- Encoded payloads
- Edge planes
- Reconstruction and analysis
- Eta reduction and execution
- Data/control semantics
- Graph authoring invariants
- Inspection workflow

## Transport DTO

The graph shape returned by leaf-server and consumed by GhostOS is centered on
nodes with nested outgoing edges:

```json
{
  "domain": "example",
  "appid": "app",
  "nodes": [
    {
      "uuid": "node-uuid",
      "leafnodetype": "leaflisp",
      "data": "base64-json",
      "out_edges": [
        {
          "uuid": "edge-uuid",
          "source": { "uuid": "node-uuid" },
          "target": { "uuid": "other-node-uuid" },
          "data": "base64-json"
        }
      ]
    }
  ]
}
```

The selected GhostOS npm release accepts a raw node array and common wrappers
such as `{nodes}`, `{graph:{nodes}}`, and `{data:{graph:{nodes}}}`. Subscription
callbacks may deliver a full `nodes` array or a delta under `update`, but direct
agentic verification should use a fresh `/qmgraphql` query.

Do not depend on a separate top-level `edges` list. Current leaf-server graph
queries nest edges under the source node, and GhostOS reconstruction derives
edges from `nodes[].out_edges`.

## Encoded payloads

Node `data` decodes to JSON resembling:

```json
{
  "leaf": {
    "api": "...",
    "logic": {
      "type": "leaflisp",
      "args": {
        "lispexpression": "inport"
      }
    },
    "appdata": {
      "position": { "x": 100, "y": 200 }
    }
  }
}
```

Runtime dispatch uses decoded `leaf.logic.type`. `leafnodetype` is useful
storage metadata but does not replace the encoded logic type. Preserve
`leaf.appdata` fields, including UI position metadata, unless the task
explicitly changes them.

For automatic local canvas placement, use
`scripts/lib/leaf-force-layout.mjs`. It treats existing coordinates as the
initial state, derives topology from nested `out_edges`, and rewrites only
`leaf.appdata.position.x/y` in a cloned graph. The algorithm is synchronous and
deterministic so a reviewed local batch digest produces repeatable output. It
interprets saved coordinates as React Flow top-left positions, simulates using
node centers, and derives conservative rendered dimensions from bundled
editor-node categories. Boundary forces use directional rectangle
clearance, and deterministic AABB collision sweeps enforce the configured gap
between differently sized nodes. A second geometry pass repels nearby
nonincident edges, separates edges from nonincident node boxes, penalizes
strict crossings, and separates collinear shared segments. Its result includes
edge crossing, shared-segment, edge proximity, edge-node intersection, and
minimum edge-distance diagnostics. These are best-effort forces over straight
segments; coincident edges with the same endpoints require routed bend points
to render separately.

For directed graphs where human topology comprehension matters more than
continuous force motion, use `scripts/lib/leaf-topology-layout.mjs`. Its async
`layoutLeafTopology(graph, options, runtime)` function uses ELK Layered,
bundled node dimensions, crossing-minimizing layer sweeps, and
orthogonal or polyline routing. Install `elkjs@0.12.0` in the consuming Node
project or inject an initialized runtime as `{elk}`. The result contains a
cloned graph with only `leaf.appdata.position.x/y` changed, routed edge
sections, bounds, collision counts, straight/routed crossing counts,
collinear-overlap counts, and edge-node intersection counts.

For graphs mixing data and lambda planes, prefer
`scripts/lib/leaf-semantic-layout.mjs`. Its async
`layoutLeafSemanticGraph(graph, options, runtime)` function sends only
`leafdataedge` relations to an ELK RIGHT seed layout, then applies deterministic
constraints with bundled node dimensions:

- A data source box must be left of its target box by `dataSpacing`.
- A lambda source box must be above its target box by `lambdaSpacing`.
- An anchor source box must be above its target box by `anchorSpacing`.
- Data edges minimize vertical deviation; lambda and anchor edges minimize
  horizontal deviation.
- Unknown edge types are preserved but do not impose a direction.
- Projected force iterations apply node repulsion, all-edge attraction,
  edge/edge and edge/node repulsion, crossing/shared-segment penalties, and
  gravity without relaxing the semantic direction constraints.
- Collision sweeps preserve `collisionPadding` between rendered boxes.
- Weak connectivity across every edge type defines a graph boundary. A safe
  AABB-separated seed is followed by deterministic member-level compaction
  that translates whole boundaries without rotation. Distinct boundary AABBs
  may overlap, but node rectangles and routed-edge segments retain
  `boundaryPadding` from every member of another graph. Component and primitive
  AABB broad phases reject distant pairs before exact rectangle/polyline
  distance checks, keeping the exact-clearance pass practical on larger graphs.

The default semantic profile favors compact geometry: 40-pixel directional
spacing, 24-pixel graph-boundary spacing, stronger attraction/gravity, and
lower node/boundary repulsion. Override these values when a graph needs more
visual whitespace rather than changing its persisted non-coordinate data.
Set `componentCompaction: false` to retain conservative AABB-separated
boundaries, or tune `componentCompactionIterations` when packing many
disconnected graphs.

Install `elkjs@0.12.0` in the consuming project or inject `{elk}`. The helper
returns a cloned graph, semantic orthogonal routes, data/lambda direction and
alignment metrics, crossing metrics by plane, edge-node intersections, cycle
counts, and geometry-aware graph boundaries with node and edge membership.
`graphBoundaryOverlapCount` reports actual cross-boundary member-clearance
violations; `graphBoundaryAabbOverlapCount` separately reports harmless
overlapping component envelopes:

```js
import { layoutLeafSemanticGraph } from "./.agents/skills/leaf/scripts/lib/leaf-semantic-layout.mjs";

const result = await layoutLeafSemanticGraph(graph, {
  dataSpacing: 80,
  lambdaSpacing: 80,
  anchorSpacing: 80,
});
```

Strict left-to-right or top-to-bottom placement is impossible for a directed
cycle in that plane. The semantic helper rejects such graphs by default before
calling ELK. Set `failOnDirectionViolation: false` only for an explicitly
reviewed best effort; cyclic edges are then excluded from hard directional
constraints and reported in the result.

Persist only the reviewed node coordinates through the current leaf-server
API. Routed sections are local visualization data until Piper and leaf-server
define a compatible bend-point metadata contract.

Edge `data` decodes to:

```json
{
  "leaf": {
    "api": "...",
    "logic": { "type": "leafdataedge" }
  }
}
```

Use the selected npm release's Unicode-safe base64 helpers when producing
payloads:

```js
const { decodeUnicode, encodeUnicode } = require("ghostos/core");

const encoded = encodeUnicode(JSON.stringify(payload));
const decoded = JSON.parse(decodeUnicode(encoded));
```

Decode fixtures before changing them; never infer an encoded payload from its
appearance.

## Edge planes

Three edge types have distinct semantics:

| Type | Meaning | Runtime use |
| --- | --- | --- |
| `leafdataedge` | Data dependency | Builds the executable dataflow graph and connected components |
| `leaflambdaedge` | Logic/configuration attachment | Connects a lambda-source component to the target node and builds the lambda source LUT |
| `leafanchoredge` | Anchor relation | Marks anchored component targets; it is not ordinary dataflow |

Captured UI reference: React Flow handle conventions map auxiliary handles
to lambda edges, anchor handles to anchor edges, and ordinary compatible
handles to data edges. Use this only to interpret existing editor-authored
graphs. For direct authoring, set and validate the encoded edge logic type
explicitly against GhostOS and leaf-server.

## Reconstruction and analysis

`reconstructLEAFGraph(nodes)` performs these steps:

1. Base64-decode and parse every node `data` payload.
2. Insert every node into graphology dataflow, lambda, and combined graphs.
3. Decode every nested outgoing edge.
4. Add `leafdataedge` to the dataflow and combined graphs.
5. Add `leaflambdaedge` to the lambda and combined graphs and populate source/target sets plus `sourcelut[target]`.
6. Record `leafanchoredge` targets.

`analyzeLEAFGraph(leafgraph)` computes connected components using only the dataflow graph, then classifies each component as runtime, lambda, or anchored. Lambda components also carry a dataflow- or lambda-plane scope. It builds lookup metadata for component membership, spell definitions, and `leafconfig`.

Important consequences:

- A lambda or anchor edge can change component classification without carrying normal runtime data.
- Every unanchored dataflow component that is not lambda-attached to a
  `leafspelldef` is runtime/main. A namespace page may contain at most one
  such component; a definition-only namespace may contain none.
- Main is active only during a browser session with that namespace page open.
  Resolving the namespace through a `leafgraph` spellbook import makes its
  definitions available but does not activate its main component.
- A disconnected loose node becomes a second main component rather than an
  inert helper. Reject it instead of allowing callers to select the first
  runtime component accidentally.
- Multiple edges between the same source and target are constrained by current GhostOS graphology reconstruction; inspect the selected release before authoring parallel edges.
- Node deletion must account for connected edges; leaf-server currently probes and deletes connected edges before deleting targeted nodes.

## Eta reduction and execution

The core compilation path is:

```text
nodes
  -> reconstructLEAFGraph
  -> analyzeLEAFGraph
  -> runtimeEtaTree
  -> etaReduceLEAFNode for each component member
  -> etaReduceDataflowComponent
  -> parseDataflowFunc / stream weaving
  -> executable LEAF logic
```

`runtimeEtaTree` holds graph identity, graph/component metadata, IO services, memory, a host eta tree, reduced node methods, and LEAFlisp runtime state. Nested graphs can resolve other eta trees through the eta-tree forest.

`etaReduceDataflowComponent` identifies start nodes as nodes with no incoming data edge and end nodes as nodes with no outgoing data edge. It reduces each node through the registry in `breezyforest.js`, then returns an executable function that accepts data input streams and a control stream object.

For direct fixture execution, use public wrappers from the selected GhostOS npm
release:

```js
const { executeLEAFGraph, reducedLEAFGraph } = require("ghostos/core");

const output = await executeLEAFGraph(graph, input, {
  domain: "example",
  appid: "app"
});
```

Pass real `leafio`, `leaflakeio`, memory, and context when a graph performs nested graph queries, subscriptions, UI operations, or host-specific work. Wrapper defaults are intentionally minimal.

## Data/control semantics

GhostOS exposes two logical planes:

- The data plane carries program values, bottles, node outputs, adapter results, and graph boundary values.
- The control plane carries lifecycle, scheduling, orchestration, retry/replay, timers, and compatibility ticks.

The safe invariant is edge-triggered data work:

```text
new data event + latest configuration/control state -> execute data work
```

Do not introduce the unsafe default:

```text
generic control tick + latched prior data -> repeat data work
```

This distinction is essential for HTTP writes, queue sends, navigation, database/object mutations, job submission, and other externally visible effects. Require explicit replay/retry intent and idempotency metadata for those cases.

## Graph authoring invariants

- Keep every node UUID unique.
- Keep every edge UUID unique across nested outgoing edge lists.
- Require edge source and target nodes to exist in the same intended graph scope.
- Require a nested edge's source UUID to match its owning node unless current storage evidence explicitly supports another form.
- Encode valid JSON for every node and edge payload.
- Keep `leafnodetype` and decoded `leaf.logic.type` aligned for authorable nodes.
- Use the correct edge type and handle family; do not use data edges as configuration links.
- For every `leaflambdaedge`, compute the dataflow component containing its
  source and the dataflow component containing its target. Those groups must
  not share any `leafoutflowport`; a lambda source must not feed an outport
  owned by the target group.
- Check for unintended disconnected components.
- Preserve graph domain/app identity and provenance on persistence calls.

## Inspection workflow

Run:

```sh
node .agents/skills/leaf/scripts/inspect-leaf-graph.mjs graph.json
```

The script reports node types, edge types, dataflow components, start/end nodes, malformed payloads, duplicate IDs, and missing references without printing decoded program contents.

Then inspect the fixture's actual decoded payloads only where needed, using the selected `ghostos` npm codecs or a narrowly scoped local command that does not expose secrets.
