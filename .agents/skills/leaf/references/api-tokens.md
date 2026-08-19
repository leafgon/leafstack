# Configure `leafelement(token)`

## Contents

- Authority and topology
- Author token settings
- Scope and permission rules
- Configurable route-family scopes for LEAF skills
- Create and capture the secret
- Update, revoke, and rotate
- Verify safely

## Authority and topology

Treat `token` as a leaf-server graph-pattern lifecycle marker, not as a normal
GhostOS `leafelement` adapter. Inspect the deployed leaf-server
`src/leaf/api_tokens.py`, `src/leaf/config/graph_patterns.json`, and tests before
relying on cached scopes or behavior.

Create this exact topology in one graph:

```text
leaflisp --leaflambdaedge--> leafelement(token)
```

Require all of the following:

- source node `leafnodetype` is `leaflisp`;
- target node `leafnodetype` is `leafelement`;
- decoded target data contains top-level `"elementname": "token"`;
- decoded edge data contains `leaf.logic.type = "leaflambdaedge"`;
- the authenticated mutation actor is the intended token owner;
- the mutation has `graphql:write` and graph write/admin/owner authorization.

Use a globally unique token-node UUID. The token ID is that UUID. Preserve
canonical node fields such as `leaf.logic` and app data when adding the required
top-level `elementname` marker.

## Author token settings

Store the settings expression in the LEAFlisp source node at decoded
`leaf.logic.args.lispexpression`. Leaf-server runs it through its trusted
Node.js sidecar using operation `executeLEAFlisp`, mode `apiTokenSettings`, and
schema `leaf.apiToken.v1`.

The LEAFlisp input contains bounded graph context:

```text
tokenId, ownerUserid, graphdomain, graphappid, provenance
```

Return a hash map. A minimal read token is:

```lisp
{:scopes ["graphql:read"]}
```

A normal GraphQL read/write token is:

```lisp
{:scopes ["graphql:read" "graphql:write"]
 :permissions {:graphql {:read true :write true}}}
```

Omit `permissions` to derive them from scopes. Omit `expiresAt` for the default
90-day lifetime. If supplied, `expiresAt` must be RFC 3339 and between one hour
and 365 days after creation. Set `revokedAt` to an RFC 3339 timestamp to revoke
the token; it must not predate creation.

If the expression is absent, leaf-server defaults to:

```lisp
{:scopes ["graphql:read"]}
```

## Scope and permission rules

Read the deployed `ALLOWED_SCOPES` before authoring. Current route-family scopes
may include:

```text
blob-storage:read   blob-storage:write
cortex:read        cortex:write
hermes:read        hermes:write
graphql:read       graphql:write
```

Scopes must be a non-empty, unique array with at most 16 entries. A write scope
implies its matching read permission. Optional `permissions` can only narrow
the declared scopes; it cannot grant a family or access level absent from
`scopes`. Explicit permissions default every unspecified family/access flag to
false.

Token scopes are an additional gate. They do not normally bypass account graph
authorization. Every GraphQL mutation independently requires effective
`graphql:write`, including high-risk mutations.

## Configurable route-family scopes for LEAF skills

The configurable token scopes for LEAF skill use are the deployed route-family
scopes from `ALLOWED_SCOPES`:

- `graphql:read`: allow graph reads (`getGraph` and equivalent read operations)
  through `/qmgraphql`.
- `graphql:write`: allow graph mutations through `/qmgraphql`. This is required
  to add, update, or delete LEAF nodes/edges. It does not replace graph
  write/admin/owner authorization checks.
- `blob-storage:read`: allow reading blob objects exposed by the platform blob
  APIs used by LEAF elements/workflows.
- `blob-storage:write`: allow writing blob objects through blob APIs.
- `cortex:read`: allow read operations against Cortex-family routes.
- `cortex:write`: allow write operations against Cortex-family routes.
- `hermes:read`: allow read operations against Hermes-family routes.
- `hermes:write`: allow write operations against Hermes-family routes.

Prefer least privilege:

- For read-only graph inspection, use `{:scopes ["graphql:read"]}`.
- For graph CRUD, use `{:scopes ["graphql:read" "graphql:write"]}`.
- Add non-GraphQL route-family scopes only when the target LEAF workflow
  requires those APIs.

## Create and capture the secret

Add both nodes first, then add the lambda edge so the lifecycle pattern becomes
constructed. Validate the edge-add GraphQL response immediately. The new raw
secret appears exactly once under `extensions.leafEvents[]` in an event shaped
like:

```json
{
  "type": "apiToken.created",
  "version": "leaf.apiToken.v1",
  "tokenId": "<token-node-uuid>",
  "token": "leaf_live_<token-node-uuid>_<secret>",
  "scopes": ["graphql:read"],
  "createdAt": "<rfc3339>",
  "expiresAt": "<rfc3339>"
}
```

Move the token directly into the approved secret store. Never print it, persist
it in graph data, include it in an ADR, or expect to retrieve it later. Reject
the mutation result if the expected `apiToken.created` event or one-time token
is absent.

## Update, revoke, and rotate

- Update the LEAFlisp settings to change scopes, narrowed permissions, expiry,
  or revocation. The existing raw secret is not emitted again.
- Remove the lambda edge or participating node to destruct the pattern and
  revoke its stored token metadata.
- Rotate by creating a new token node with a new UUID, capturing its one-time
  secret, switching the consumer, verifying it, and only then destructing the
  old pattern.
- Never model rotation as changing the token-node UUID or transferring token
  ownership.

Re-query the graph after every mutation, but treat leaf-server's private token
store as the authentication authority. Graph reads and token metadata endpoints
must never expose raw secrets or verifier hashes.

## Verify safely

1. Require a successful mutation acknowledgement and the expected lifecycle
   event.
2. Re-query the graph and verify node UUIDs, decoded settings source, and the
   lambda edge topology.
3. Read public metadata through `GET /api/tokens` or
   `GET /api/tokens/<token_id>` without logging authorization material.
4. Exercise the least-privileged intended route, checking reads separately from
   writes.
5. Confirm missing scope returns `403` with `insufficient_token_scope` and an
   invalid/revoked token returns `401` without cookie fallback.
6. Redact bearer tokens, cookies, verifier values, headers, and sensitive graph
   payloads from every report.
