# Agentic LEAF Programming Architecture

## Contents

- Agentic execution path
- Offline JSON authoring path
- Private-repo independence policy
- Authority boundaries
- GhostOS npm policy
- Deployed API validation policy
- Self-contained reference index
- Validation map

## Agentic execution path

```text
agent
  -> query graph from leaf-server /qmgraphql
  -> decode and inspect graph with ghostos npm package
  -> author node/edge changes locally
  -> reduce or execute locally with ghostos when applicable
  -> submit direct /qmgraphql CRUD
  -> validate GraphQL acknowledgement
  -> re-query authoritative graph
  -> verify topology and behavior
```

Use `/sgraphql` only when a task truly requires ongoing observation. CRUD
acknowledgement plus a fresh `/qmgraphql` query is the default verification path.

## Offline JSON authoring path

```text
agent
  -> author graph JSON and leaf.graph-batch.v1 manifest locally
  -> run local batch simulation and digest review
  -> write reviewed graph files with --write-local
  -> inspect and (when needed) execute locally with ghostos
  -> hand off JSON artifacts for review or later apply
```

Offline authoring requires no API token and no live `/qmgraphql` writes. Use
remote apply only when the user explicitly asks for persistence.

## Private-repo independence policy

This skill is intentionally self-contained for public LEAF programming.

- Do not require access to private GitHub repositories to author or mutate LEAF graphs.
- Do not require local `leaf-server`, `ghostos`, or `piper` checkouts for ordinary work.
- Treat this skill package and live leaf-server behavior as the operational contract.
- Use `ghostos` from npm for encode/decode/runtime APIs.

## Authority boundaries

| Surface | Agentic responsibility | Authority |
| --- | --- | --- |
| leaf-server `/qmgraphql` | Direct graph query and node/edge CRUD | Authenticated and graph-authorized persistence boundary |
| leaf-server `/sgraphql` | Optional graph observation | Authenticated subscription boundary |
| `ghostos` npm package | Encode/decode, inspect, reduce, execute, and test LEAF programs | Public parser/runtime release selected for the task |
| local graph JSON + batch manifest | Offline authoring artifact, multi-domain/app simulation, and reviewed change plan | Authoritative offline deliverable; remote persistence still requires `/qmgraphql` apply plus re-query |
| Dgraph behind leaf-server | Persistent graph store | Never bypass leaf-server for ordinary agentic programming |

Do not call Dgraph directly or treat client-local cache/subscription timing as
persistence proof.

## GhostOS npm policy

Resolve the latest release immediately before work:

```sh
npm view ghostos@latest version engines exports --json
```

Rules:

- Use `ghostos@latest` when the task does not pin a version.
- Use the exact requested or target-project version when one is specified.
- Record the resolved version in handoff notes and reproducible commands.
- Load supported runtime APIs from `ghostos` or `ghostos/core` using the selected release's working export condition.
- Respect package engine requirements for the selected version.

Known `0.2.5` packaging caveat: the `ghostos/core` ESM export points to
`lib/index.core.js`, whose bundle calls CommonJS `require` while the package
declares `type: module`. Native ESM import therefore fails. Use the working
CommonJS export for that release:

```js
const { executeLEAFlisp } = require("ghostos/core");
```

From an ESM-only caller, create a scoped require with `createRequire`. Re-test
exports on later releases and remove the workaround once their ESM entry loads.
The bundled `run-leaflisp.mjs` handles this selection.

## Deployed API validation policy

Use this policy only when mutating leaf-server state.

Use deployed behavior as authority. Before or during mutation work:

1. Query the authoritative graph through `/qmgraphql`.
2. Validate response envelope (`error`, `errors`, missing `data`).
3. Apply one scoped mutation request at a time.
4. Validate acknowledgement IDs and mutation payload shape.
5. Re-query and compare intended node/edge postconditions.

When behavior is uncertain, use GraphQL introspection against `/qmgraphql` where
allowed by the environment policy. If introspection is disabled, rely on
acknowledged mutations plus postcondition re-queries.

## Self-contained reference index

Use this skill package as the reference set:

- `SKILL.md`: workflow contract, safety rules, and handoff requirements.
- `references/leaf-server-api.md`: concrete `/qmgraphql` query + mutation patterns.
- `references/graph-runtime.md`: graph shape, runtime invariants, and inspection workflow.
- `references/jsonld-workflow.md`: JSON-LD source authoring and deterministic conversion into executable transport DTO JSON.
- `references/multi-graph-batches.md`: batch manifest, digest review, and ordered applies.
- `references/examples/offline-batch.json`: starter offline manifest for local JSON authoring.
- `references/examples/offline-graph.json`: starter local graph snapshot paired with the offline manifest.
- `references/examples/offline-graph.jsonld`: starter JSON-LD source that compiles to executable transport DTO graph JSON.
- `references/leaflisp.md`: LEAFlisp authoring and execution guidance.
- `references/leafelements.md`: supported element catalog and cautions.
- `scripts/inspect-leaf-graph.mjs`: static graph invariant inspection.
- `scripts/leaf-jsonld-build.mjs`: convert JSON-LD source into executable transport DTO graph JSON.
- `scripts/leaf-jsonld-export.mjs`: decode transport DTO graph JSON back into JSON-LD form.
- `scripts/leaf-jsonld-workflow.mjs`: one-command wrapper for build, inspect, execute, and optional JSON-LD roundtrip export.
- `scripts/leaf-graph-batch.mjs`: local planning and optional ordered apply tooling.
- `scripts/run-leaf-graph.mjs`: npm-version-aware `executeLEAFGraph` harness for local graph JSON fixtures.
- `scripts/run-leaflisp.mjs`: npm-version-aware LEAFlisp execution.

## Validation map

| Change | Minimum evidence |
| --- | --- |
| LEAFlisp code | Execute with selected npm GhostOS version and representative falsy/null/empty inputs |
| Node add/update | Validate decoded payload, GraphQL acknowledgement, then authoritative re-query |
| Edge add/delete | Validate endpoints/type, capture persisted edge UUID, then authoritative re-query |
| Topology change | Run graph inspector and check affected dataflow/lambda/anchor component |
| Offline local batch | Review digest, run `--write-local`, inspect every changed graph file with the graph inspector, then execute representative cases through `run-leaf-graph.mjs` |
| Multi-graph CRUD batch | Validate every local graph, review digest and endpoint, apply ordered scoped requests, then re-query every address |
| `leafelement` use | Confirm allowed + wired status, config, execution context, and idempotency requirements |
