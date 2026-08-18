---
name: leaf
description: Develop, inspect, execute, lay out, and directly persist agent-authored LEAF graph programs using leaf-server node/edge GraphQL APIs and the GhostOS npm runtime. Use for LEAF graph JSON, force-directed canvas coordinates, multi-domain or multi-app local graph workspaces, reviewed CRUD batches, graph-based coding, GhostOS graph reduction/execution, LEAFlisp authoring, leafelement selection, leafelement(token) account-token configuration, or validation of LEAF programs. Keep this skill self-contained and rely on public interfaces only.
---

# Program in LEAF

## Establish the working contract

Treat this skill and its references as the practical LEAF programming manual.
Ordinary graph authoring should not require private repository access.
Record generalized node contracts, safe topology patterns, version caveats,
and validation procedures here when runtime investigation reveals them.

1. Confirm the exact graph domain/app ID, leaf-server endpoint, environment, authorization mechanism, and requested mutations.
2. Use this skill's bundled references as primary guidance for payload shape and safety checks.
3. Use the latest `ghostos` npm release unless the user or target project specifies an exact version.
4. Validate any uncertain API behavior through direct GraphQL query/mutation acknowledgement plus authoritative re-query.
5. Do not rely on private `leaf-server`, `ghostos`, or `piper` repositories for ordinary LEAF programming.

Run the environment survey before mutations when needed:

```sh
.agents/skills/leaf/scripts/inspect-leaf-workspace.sh
```

## Load only the needed model

- Read [references/architecture.md](references/architecture.md) for the direct agentic path, authority boundaries, npm version policy, and evidence sources.
- Read [references/leaf-server-api.md](references/leaf-server-api.md) before any graph read or node/edge mutation.
- Read [references/graph-runtime.md](references/graph-runtime.md) for graph JSON, edge planes, component analysis, eta reduction, and execution.
- Read [references/data-workflows.md](references/data-workflows.md) before designing multi-stage data workflows, reusable spells, routing, joins, stateful subflows, or anchor-based runtime exclusion and notes.
- Read [references/leafmemoryio.md](references/leafmemoryio.md) before authoring named memory slots, read/derive/write flows, reset paths, or virgin `forget` nodes.
- Read [references/leaflisp.md](references/leaflisp.md) before authoring or changing LEAFlisp.
- Read [references/leafelements.md](references/leafelements.md) before choosing or configuring a `leafelement`.
- Read [references/spa-pattern.md](references/spa-pattern.md) before authoring or changing a browser-rendered single-page application, including its HTML host contract, assets, navigation, or release strategy.
- Read [references/api-tokens.md](references/api-tokens.md) before creating, changing, rotating, revoking, or using a `leafelement(token)` pattern.
- Read [references/multi-graph-batches.md](references/multi-graph-batches.md) before constructing local multi-domain/app graph files or applying a CRUD batch.

## Use the direct agentic path

Work in this order:

1. Query the authoritative graph from leaf-server `/qmgraphql`.
2. Decode node and edge payloads with the selected GhostOS npm release.
3. Inspect graph invariants and the affected component.
4. Author the smallest node/edge change locally.
5. Validate encoded payloads and, when possible, reduce or execute the graph locally with GhostOS.
6. Submit node/edge CRUD directly to leaf-server `/qmgraphql`.
7. Treat the GraphQL response as the mutation acknowledgement; reject top-level `error`, GraphQL `errors`, missing data, or unexpected IDs.
8. Re-query the graph and verify the authoritative postcondition. Do not rely on subscription convergence or client-local state for confirmation.

Inspect a graph fixture without executing it:

```sh
node .agents/skills/leaf/scripts/inspect-leaf-graph.mjs path/to/graph.json
```

Do not hand-edit encoded payloads without decoding them. Treat `nodes[].out_edges` as the runtime edge source unless current leaf-server and GhostOS evidence proves otherwise.

## Work across domains and apps

Treat `<domain-id>/<app-id>` as the complete graph address. Store one graph per
JSON file and declare every file and operation in a versioned batch manifest.
Plan without writes first:

```sh
node .agents/skills/leaf/scripts/leaf-graph-batch.mjs path/to/batch.json
```

Use the printed digest for an explicit local write or live apply. A live batch
is ordered orchestration across separate authorized `/qmgraphql` requests, not
an atomic cross-graph transaction. Re-query every affected address and stop on
the first failure.

Set `graphs[].layout` in a local batch to run the bundled deterministic
force-directed helper after every node/edge add or delete. The helper updates
only encoded `leaf.appdata.position.x/y`, using bundled editor-dimension
heuristics to keep rendered boxes in bounds and separated. It also applies configurable
edge/edge, edge/node, crossing, and shared-segment forces and returns geometry
diagnostics for review. Read
[references/multi-graph-batches.md](references/multi-graph-batches.md) for the
manifest shape and local-only boundary.

For mixed-plane human-readable topology, use the async
`scripts/lib/leaf-semantic-layout.mjs` helper with `elkjs@0.12.0`. It seeds only
the data plane with ELK, then constrains data edges left-to-right and lambda
and anchor edges top-to-bottom while running force dynamics between constraint
projections. It treats weak components across every edge type as separate graph
bodies. Its final compaction translates whole bodies without rotating them,
allows harmless component-envelope overlap, and preserves `boundaryPadding`
between every cross-body node rectangle and routed-edge segment. Use
`scripts/lib/leaf-topology-layout.mjs` when one global ELK Layered direction is
appropriate. Both helpers preserve non-coordinate node data and return local
route/geometry diagnostics. Treat routes as visualization output; leaf-server
currently persists node coordinates but has no routed-edge metadata contract.

## Use GhostOS from npm

Resolve the release at task time:

```sh
npm view ghostos@latest version
```

Install `ghostos@latest` with the target project's package manager when no version is pinned. If a version is specified, install and record that exact version. Load public APIs from `ghostos` or `ghostos/core`. Check [references/architecture.md](references/architecture.md) for selected-release module compatibility before choosing ESM import versus CommonJS require.

Run LEAFlisp against an installed npm version:

```sh
node .agents/skills/leaf/scripts/run-leaflisp.mjs \
  --code path/to/program.leaflisp \
  --input path/to/input.json
```

Pass `--version X.Y.Z` when the task pins GhostOS. The runner fails if the installed package does not match the resolved requested release.

## Preserve graph and runtime safety

- Preserve node UUID, graph identity, provenance, encoded `leaf.logic`, and source/target identity across CRUD operations.
- Keep `leafnodetype` aligned with decoded `leaf.logic.type`.
- Use `leafdataedge`, `leaflambdaedge`, and `leafanchoredge` only for their distinct planes.
- For every `leaflambdaedge`, keep the source dataflow component isolated from
  the target dataflow component: nodes in those two groups must not share a
  `leafoutflowport`.
- When a named bottle feeds LEAFlisp and its name should remain explicit, put
  `leafmixflow` in `dictionary` mode before the LEAFlisp node and read the
  payload by that key. Use `leafunbottle` only when the downstream contract is
  intentionally the anonymous raw content.
- Treat every unanchored construct that is not lambda-attached to a
  `leafspelldef` as part of the namespace's main graph. A
  `<domain-id>/<app-id>` namespace may have zero or one main graph, never
  multiple disconnected main graphs. Main runs while that graph page is open
  in a browser session; importing the namespace through `leafgraph` exposes
  its spellbook without activating main.
- Keep data work data-triggered; do not let generic control/config ticks replay latched side effects.
- Require explicit identity, bounded retry, and suitable idempotency for side-effecting elements.
- Do not use blocked `leafelement` names or assume a source file means an adapter is wired.
- Never print credentials, tokens, cookies, authorization headers, secret-bearing node data, or unredacted graph payloads.
- Never mutate an unspecified environment or graph. Treat production graph CRUD as a live-state mutation requiring explicit task scope.
- Keep node and edge UUIDs globally unique across a multi-graph batch because update/delete authorization resolves targets by UUID.

Stop for tech-lead direction before introducing a breaking DTO, edge type, GraphQL schema, auth, or deployment change.

## Validate proportionally

- Run the graph inspector before and after local graph edits.
- Run focused LEAFlisp or GhostOS execution tests using the resolved npm version.
- Re-query leaf-server after each mutation group and assert IDs, payloads, topology, and component shape.
- If a task includes runtime/library code changes outside this skill, run that target project's documented checks.
- For ordinary LEAF programming, treat mutation acknowledgement plus authoritative re-query as the required persistence verification.

Validate this skill package after editing it:

```sh
.agents/skills/leaf/scripts/validate-skill.sh
```

At handoff, report summary, files changed, commands run, GhostOS version, graph/environment targeted, mutation acknowledgements, verification results, and remaining risks.
