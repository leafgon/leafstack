# Direct leaf-server Graph API

## Contents

- Operating rules
- Read graph
- Encode node and edge data
- Node CRUD
- Edge CRUD
- Response validation
- Post-mutation verification
- Multi-graph batches
- Client-side caveats

## Operating rules

- Send graph operations to leaf-server `/qmgraphql`; do not call Dgraph directly.
- Use the environment's approved authenticated session or API token without printing it.
- Require `graphql:read` for reads and `graphql:write` plus graph write/admin/owner permission for mutations.
- Confirm environment, endpoint, domain, and app ID before any mutation.
- Use deployed leaf-server GraphQL behavior as authority. The examples below are a working baseline; validate with live acknowledgements and post-mutation re-queries.
- Treat HTTP success as transport success only. leaf-server can return application errors with HTTP 200.

## Read graph

The current `/qmgraphql` authorization parser derives domain/app ID from the query text for graph reads. Use validated identifiers and inline them in the operation:

```graphql
query {
  graph: getGraph(domain: "DOMAIN", appid: "APPID", filter: {}) {
    domain
    appid
    nodes {
      uuid
      leafnodetype
      data
      out_edges {
        uuid
        source { uuid }
        target { uuid }
        data
      }
    }
  }
}
```

Do not interpolate untrusted text. Current route matching expects simple identifiers; validate the target against the deployed contract before constructing the request.

## Encode node and edge data

Use the selected GhostOS npm release:

```js
const { encodeUnicode, decodeUnicode } = require("ghostos/core");

const encoded = encodeUnicode(JSON.stringify(payload));
const decoded = JSON.parse(decodeUnicode(encoded));
```

This uses the working CommonJS export in `ghostos@0.2.5`; consult the selected
release compatibility note in [architecture.md](architecture.md) before using
native ESM import.

A node payload contains `leaf.logic.type`, `leaf.logic.args`, `leaf.api`, and any required app data. An edge payload contains `leaf.logic.type` set to `leafdataedge`, `leaflambdaedge`, or `leafanchoredge`.

Current production leaf-server also requires a `leaflisp` node payload to
contain `leaf.object`; use `null` when adding or changing source and let
leaf-server materialize or clear it according to connectivity. A missing field
is rejected as `noncanonical-leaflisp-data` before persistence.
Treat `leaf.object` as server-managed materialization state when verifying a
write: compare every other decoded field exactly, then validate the materialized
object separately when the node intentionally remains without incoming data.

Before mutation, decode the generated string and validate the full JSON. `updateNode` replaces the encoded `data` field, so preserve fields not intentionally changed.

## Node CRUD

### Add node

```graphql
mutation AddNode(
  $uuid: String!
  $leafnodetype: String
  $data: String!
  $graphdomain: String!
  $graphappid: String!
  $provdomain: String!
  $provappid: String!
) {
  addNode(input: [{
    uuid: $uuid
    leafnodetype: $leafnodetype
    graph: {domain: $graphdomain, appid: $graphappid}
    provenance: {domain: $provdomain, appid: $provappid}
    data: $data
  }]) {
    node { uuid }
  }
}
```

Generate a UUID before submission, align `$leafnodetype` with decoded `leaf.logic.type`, and require the response UUID to match.

### Update node data or type

```graphql
mutation UpdateNode($uuid: String!, $data: String!, $leafnodetype: String) {
  updateNode(input: {
    filter: {uuid: {eq: $uuid}}
    set: {data: $data, leafnodetype: $leafnodetype}
  }) {
    node { uuid }
  }
}
```

Read and decode the current node first. Modify only intended fields, re-encode
the whole payload, and reject a response that does not include the target UUID.
When changing the encoded `leaf.logic.type`, update `leafnodetype` in the same
mutation so storage metadata and runtime dispatch remain aligned. Current
leaf-server materialization uses the requested target type when reconciling
`leaf.object`; re-query and verify both fields after the update.

### Delete node

```graphql
mutation DeleteNode($uuid: String!) {
  deleteNode(nfilter: {uuid: {eq: $uuid}}) {
    node { uuid }
  }
}
```

Current leaf-server behavior finds and deletes connected edges before deleting the node. Resolve and report that topology impact before submission, then verify all expected edges are absent.

## Edge CRUD

### Add edge

```graphql
mutation AddEdge(
  $uuid: String!
  $sourceuuid: String!
  $targetuuid: String!
  $data: String!
  $graphdomain: String!
  $graphappid: String!
  $provdomain: String!
  $provappid: String!
) {
  addEdge(input: [{
    uuid: $uuid
    source: {uuid: $sourceuuid}
    target: {uuid: $targetuuid}
    graph: {domain: $graphdomain, appid: $graphappid}
    provenance: {domain: $provdomain, appid: $provappid}
    data: $data
  }]) {
    edge { uuid }
  }
}
```

Validate that source and target exist and that the edge does not violate the intended lambda/anchor/data cardinality. Current leaf-server `mutation_addedge` replaces the supplied UUID with a server-generated UUID. Capture the response UUID and use it for future deletion and verification.

### Delete edge

```graphql
mutation DeleteEdge($uuid: String!) {
  deleteEdge(efilter: {uuid: {eq: $uuid}}) {
    edge { uuid }
  }
}
```

Use the persisted UUID returned by add/re-query, not an optimistic client UUID.

### Update edge

The active logical schema has no `updateEdge` mutation. If a task requires changing an edge, model it as an explicitly approved delete/add sequence, note that it is non-atomic, and capture the new server-generated UUID.

## Response validation

For every request:

1. Require a parseable JSON response.
2. Reject a top-level `error` field.
3. Reject a GraphQL `errors` field.
4. Require the expected `data.<mutation>` payload.
5. Require the expected node/edge UUID set.
6. Record non-sensitive mutation events from `extensions.leafEvents` when present.
7. Do not log the entire request when encoded node data may contain secrets.

The deployed `updateNode` payload can omit the `node` record list, and some
releases also omit `numUids`. For an update constrained by one exact UUID, the
batch helper first accepts `numUids: 1`; if that is absent, it immediately
re-queries the graph and accepts only an exact match of every updated field.
The full authoritative post-batch re-query remains mandatory.

GhostOS `0.2.5` mutation helpers return successful responses but catch/redact exceptions without rethrowing. If using them, explicitly reject `undefined` and still perform a re-query. A direct fetch wrapper that propagates GraphQL and transport failures is safer for automation.

## Post-mutation verification

After each coherent mutation group:

1. Re-run `getGraph` through `/qmgraphql`.
2. Locate nodes and edges by persisted UUID.
3. Decode and compare the intended node/edge data.
4. Run `inspect-leaf-graph.mjs` on the returned graph.
5. Check component membership, start/end nodes, edge type, and absence of dangling references.
6. Execute/reduce locally with the selected GhostOS version when the graph is runnable without unavailable host services.

Do not use subscription timing or client-local state as proof of persistence.

## Multi-graph batches

Use [multi-graph-batches.md](multi-graph-batches.md) and
`scripts/leaf-graph-batch.mjs` for operations spanning multiple
`<domain-id>/<app-id>` addresses.

Do not combine multiple graph scopes or mutation fields into one GraphQL
document. Current `/qmgraphql` request authorization recognizes one mutation
field and authorizes one graph scope per request. A batch must orchestrate
separate ordered requests, validate each acknowledgement, stop on failure, and
re-query every affected graph. This is not atomic: mutations acknowledged
before a failure remain persisted.

## Subscription payload ceiling

Measure the minified graph payload before relying on `/sgraphql` for a large
editor graph. A graph can remain fully readable through `/qmgraphql` and pass
runtime inspection while its subscription fails before the first graph value.

Production evidence on 2026-08-11 showed the leaf-server-to-Dgraph
`WebsocketsTransport` closing with code `1009 (message too big)` when a graph
subscription result exceeded the `websockets` client's default 1 MiB receive
limit. The affected constructor did not pass `connect_args.max_size`. The
browser then received no graph and rendered an empty editor even though the
persisted graph was valid.

Use the exact deployed subscription selection when estimating size; the
following is a useful lower-bound check after an authoritative query:

```js
const graphBytes = Buffer.byteLength(JSON.stringify(graph));
```

If the result approaches 1 MiB, inspect bounded leaf-server logs for a backend
close code `1009` before changing graph topology. The service-side remediation
is a reviewed, bounded, configurable backend websocket receive limit with tests
below and above the limit. Do not set an unbounded limit or delete useful graph
nodes merely to bypass the transport ceiling. Re-test the authenticated browser
path after deployment because browser, ingress, and frontend limits are separate
hops.

## Client-side caveats

Historical client behavior exposes pitfalls that direct agents should avoid:

- optimistic state can diverge from persistence;
- mutation helpers can swallow failures;
- subscription updates are eventual and may replay;
- changed edges arrive nested in changed source-node records;
- client and persisted edge UUIDs can differ.

Use these as reasons to validate direct acknowledgements and authoritative re-queries.
