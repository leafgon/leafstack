# Program Data Workflows in LEAF

## Contents

- Working model
- Design procedure
- Node and edge roles
- Composition patterns
- Data contracts
- State and side effects
- Validation checklist

## Working model

Treat a LEAF graph as a typed, declarative program assembled from small
dataflow components:

- The data plane transports values between processing nodes.
- The lambda plane attaches implementations, imported graph contexts, and
  reusable definitions without pretending they are runtime data.
- The anchor plane excludes an anchored target and its data- and
  lambda-connected graph from runtime execution. Treat it like commenting out
  a graph section, not like creating an ordinary data dependency.
- Every unanchored construct that is not lambda-attached to a `leafspelldef`
  belongs to the namespace's main graph. Each
  `<domain-id>/<app-id>` page permits at most one such main graph; a
  definition-only library page may have none. Main is active only while that
  namespace page is open in a browser session. Loading the namespace through
  `leafgraph` as a spellbook import does not run the imported main graph.

Use the dataflow component as the primary unit of reasoning. Give each
component one clear contract, such as normalize, route, enrich, persist, or
invoke. Compose a larger workflow from those components instead of placing all
logic in one LEAFlisp node.

Keep application vocabulary, provider addresses, prompts, persistence keys,
and credentials outside the reusable topology. Inject them through explicit
inputs or reviewed configuration.

## Design procedure

1. Define the workflow input, output, event tags, error values, and externally
   visible effects before choosing nodes.
2. Choose one canonical data shape at the boundary. Use a named bottle when
   downstream routing depends on event kind.
3. Draw the pure data path first with `leafdataedge` relations.
4. Add gates only where data must be conditionally admitted to a branch.
5. Add an explicit mix node wherever independent branches rejoin, and select
   its join mode from the current GhostOS runtime rather than assuming timing.
6. Factor a coherent, reusable component into a named spell with inflow and
   outflow ports.
7. Attach a `leafgraph` to a `leafspell` through the lambda plane when the
   spell definition lives in another graph namespace; do not send graph
   references through data edges.
8. Define a repeated contract and its implementation once as a
   `leafspelldef`; keep each use visible as a `leafspell` call instead of
   copying contract payloads or implementation expressions into every caller.
9. Add anchor edges only to exclude a target's connected graph from runtime or
   to retain a deliberately non-executable human-readable note.
10. Add state or external effects last, after pure transformations and routing
    can be tested independently.
11. Check component classification and runtime trigger policy before encoding
    or persisting the graph. Require zero or one active main graph, and attach
    every reusable implementation component to its `leafspelldef` with a
    lambda edge.

## Node and edge roles

| Construct | Use | Avoid |
| --- | --- | --- |
| `leafinflowport` | Declare a reusable component's input boundary. | Hiding additional undeclared inputs in host globals. |
| `leafoutflowport` | Declare its observable result boundary. | Treating an internal node as the public result by convention. |
| `leaflisp` | Perform a small deterministic shape or value transform. | Embedding an entire workflow, credentials, or implicit side effects. |
| `leafgateflow` | Admit or reject a tagged event or matching value. | Using a gate as a general transform or allowing overlapping branches accidentally. |
| `leafmixflow` | Rejoin independent streams or materialize named bottle content as an explicit keyed dictionary. | Assuming arrival order, freshness, replay behavior, or preserved bottle metadata. |
| `leafmemoryio` | Read or update workflow state under an explicit runtime policy. | Assuming local memory is durable or replay-safe. |
| `leafspelldef` | Export a named reusable component into a spellbook. | Giving a definition dataflow behavior of its own. |
| `leafspell` | Invoke a named spell inside a data path. | Assuming a matching definition is available in every context. |
| `leafgraph` | Provide spell definitions from another `<domain-id>/<app-id>` namespace to a spell invocation. | Passing graph references as ordinary runtime data or embedding secrets in an address. |
| `leafanchor` | Provide an explicit source marker for an anchor edge that excludes its target graph from runtime. | Treating an anchor as a value-producing or lifecycle-triggering source. |

Use edge planes consistently:

| Edge | Meaning | Required check |
| --- | --- | --- |
| `leafdataedge` | A runtime value dependency. | Source and target belong to the intended executable component. |
| `leaflambdaedge` | A definition, implementation, or context attachment. | The source component has the scope expected by the target node. |
| `leafanchoredge` | Runtime exclusion for the target and its data- and lambda-connected graph. | The excluded graph should be classified as anchored and absent from runtime execution. |

## Composition patterns

### Export a reusable spell

Build the implementation as an ordinary dataflow component with an explicit
interface:

```text
inflow -> normalize -> work -> outflow
```

Connect one implementation node from that component to the matching
`leafspelldef` with a lambda edge. Keep the spell name stable and verify that
GhostOS exposes one usable default dataflow for the definition. Treat the
definition node as a catalogue entry; keep executable behavior in its attached
component. Without that lambda attachment, the implementation is part of the
session-active main graph. Do not leave reusable helpers orphaned on the page.

### Resolve and invoke spells across graph namespaces

Place `leafspell` in the data path:

```text
upstream -> spell -> downstream
```

Use `leafgraph` when the definition comes from outside the current
`<domain-id>/<app-id>`. Keep it outside the data component and attach it to the
spell with a lambda edge:

```text
leafgraph => spell
```

Set the graph reference according to its namespace:

- Use `<domain-id>/<app-id>` to source spell definitions from another domain
  and app combination.
- Use `/<app-id>` to source spell definitions from another app in the current
  domain.

Resolve the relative form against the current graph's domain. Confirm that the
selected source graph exports the requested spell and that its port contract
matches the caller. A spellbook import resolves definitions only; it must not
activate the imported namespace's main graph. Do not attach a `leafgraph`
merely to call a spell already defined in the current graph namespace.

Scope each `leafgraph` import node to one owning executable component. It may
lambda-attach to multiple `leafspell` calls only when every call belongs to the
same owning `leafspelldef`, or when every call belongs to the one main graph.
When separate spell definitions import the same provider, give each definition
its own `leafgraph`; never share one import node across definition boundaries.

### Route and rejoin events

Normalize an event once, then branch on its bottle name or another explicit
discriminator:

```text
                 -> gate A -> branch A --\
normalized event -> gate B -> branch B ----> mix -> next stage
```

Make gate predicates mutually exclusive when exactly one branch should run.
Use an explicit fan-out when multiple branches should run. Select a mix mode
that states whether the join consumes any input, combines latest values,
concatenates, substitutes, or merges. Test out-of-order events and a rejected
gate; a suppressed branch must not cause stale data to be replayed.

For bottle routing, use the bottle name as the visible route contract. A
`leafgateflow` with `keyname: "reviewed"` and `notgatetoggle: false` passes a
bottle whose `_bname` is `reviewed` and suppresses bottles with other names.
Keep the bottle name and gate label identical so a reader can understand the
route from the canvas. The gate filters; it does not assign the bottle name.

When a selected branch must feed one later linear stage, use this shape:

```text
classify to named bottle -> matching gates -> one outflow per branch
                                          -> spell call -> later stage
```

The branch component has multiple `leafoutflowport` end nodes, but exactly one
matching gate emits for a mutually exclusive route. The enclosing `leafspell`
call presents the selected result as one downstream stream. This shape passes
representative two-branch execution under `ghostos@0.2.15`; qualify the exact
graph and selected GhostOS release before persistence.

Do not place a merge/default `leafmixflow` after sibling gates when one sibling
can suppress its output unless the selected GhostOS release has a passing
graph-level regression for that shape. In `ghostos@0.2.15`, the suppressed
input can stall the join. Prefer separate branch outflows as above, or keep the
branches independent.

Use `leafmixflow` dictionary output for a genuine multisource boundary whose
lanes all deliberately emit. Give each lane a meaningful `leafbottle` name;
the mix turns those names into object keys and their contents into values, so
a downstream focused `leaflisp` can read one organized input object. Avoid a
bottle immediately followed by an unbottle on a single linear path: without
routing, aggregation, provenance, or another named-lane purpose, that pair is
neutral graph noise.

A dictionary mix is also useful with one named bottle when the next node is
LEAFlisp and retaining the input's identity makes the transform clearer:

```text
bottle(data-bottle1) -> mix(dictionary) -> leaflisp
```

The LEAFlisp input is `{:data-bottle1 content}`, so read it explicitly with
`(get inport :data-bottle1)`. Prefer this over
`unbottle(data-bottle1) -> leaflisp` when the name is meaningful to the
operation. Keep `leafunbottle` when the downstream contract deliberately
expects only raw content. A dictionary mix materializes bottle contents, not
the complete envelope; do not assume `_label` or other bottle metadata
survives unless it was explicitly encoded into the content. With multiple
inputs, every required lane must emit under the selected GhostOS join
semantics; do not reintroduce a suppressed-gate join stall.

### Isolate stateful processing

Separate state access from the pure function that derives the next state:

```text
current state --\
new input ------> build next state -> state update -> output
```

This shape makes the state transition testable without storage. Declare the
memory name, scope, persistence mode, replay/checkpoint behavior, and conflict
policy supported by the selected GhostOS release. Correlate each state read
with the event that triggered it so concurrent inputs cannot consume unrelated
latest state. Do not describe in-process memory as durable storage. Read
[leafmemoryio.md](leafmemoryio.md) before authoring memory nodes or reset paths.

### Exclude graph sections and retain notes

Anchor a target to exclude that node and the graph connected to it through
data and lambda edges from runtime execution:

```text
anchor source ~> excluded target -> excluded connected graph
```

Use this as the graph equivalent of commenting out a coherent section. Inspect
the full connected impact before adding or removing the anchor edge; a target
can exclude more than one visible node.

To keep a human-readable note about a spell definition, use a `leaflisp` node
as the anchor-edge target:

```text
leafspelldef ~> note leaflisp
```

Keep note text non-sensitive and do not depend on the anchored `leaflisp` for
runtime behavior. It is documentation carried by the graph, not executable
spell logic.

## Data contracts

- Treat a bottle's `_bname` as a routing tag and `_content` as its payload.
- Preserve `_label` metadata when tracing, provenance, or host behavior relies
  on it.
- Under `ghostos@0.2.15`, the LEAFlisp `(bottle name value)` helper converts
  nested numeric values in `value` to strings. When a dynamic routing bottle
  must preserve numeric types, return the canonical object shape directly,
  for example `{:_bname route :_content inport :_label {}}`, and test
  nested numbers explicitly. Re-qualify this caveat when selecting a later
  GhostOS release.
- Normalize external/provider results at the boundary before routing them.
- Preserve `false`, `0`, empty strings, empty collections, and null-like values
  deliberately; do not confuse them with a rejected gate or missing output.
- Give spell inputs and outputs stable shapes independent of their provider.
- Return explicit error bottles or documented error values instead of mixing
  failures with normal data.
- Keep provider DTOs inside adapter components so the workflow remains
  portable.

### Budget large namespace payloads

Measure the minified full graph, including encoded node data and
server-materialized `leaf.object`, when a namespace approaches a subscription
transport ceiling. Treat the budget as a topology design constraint, not a
reason to hide visible workflow stages inside larger LEAFlisp expressions.

Prefer graph-native deduplication:

- Export each repeated contract and implementation once through a short,
  stable `leafspelldef` with explicit inflow and outflow ports.
- Keep every use readable on the canvas as a `leafspell` node.
- When callers live in another namespace, attach one appropriately scoped
  `leafgraph` import to their spell calls with `leaflambdaedge` relations.
- Put the authoritative contract note beside the exported definition instead
  of copying its JSON Schema or DBML into each call site.
- Keep ownership boundaries intact: place system-owned libraries in system
  namespaces and user/application-owned libraries in their own domain.
- Measure both the provider and consumer namespaces after factoring; split a
  library by coherent ownership or capability if the provider approaches the
  same payload ceiling.

Use LEAFlisp for focused predicates and shape transforms inside those visible
components. Do not merge several named workflow stages into one LEAFlisp node
merely to save bytes. Prefer gates for visible named-bottle routing, dictionary
mixes for genuine always-emitting multisource joins or explicit named input to
LEAFlisp, native bottle operations where the bottle boundary has a routing or
aggregation purpose, and dedicated element or memory nodes for supported
effects and state.

A reusable spell may encapsulate one LEAFlisp implementation for a coherent
family of closely related operations and use the input bottle name as its
function selector. Keep that dispatch visible at every call site:

```text
input -> bottle(operation-name) -> shared spell -> next stage

shared spell: inflow -> mix(dictionary) -> leaflisp -> outflow
```

The dictionary mix turns the operation bottle into an explicit keyed input;
the shared LEAFlisp implementation should test for that key, read its value,
apply only the matching focused function, and return the operation result.
Use short, stable operation names; reject unknown names explicitly; and test
every operation plus falsy and malformed content. This removes the need for a
post-spell unbottle when the spell returns raw result content. If downstream
routing requires a bottle, return a deliberate named bottle instead. Do not
turn this pattern into one broad dispatcher that hides unrelated workflow
stages—the spell family must still have one clear contract and responsibility.

Avoid duplicating complete JSON Schemas in both legacy and successor
contract-note nodes. During an unavoidable compatibility window, keep one
authoritative contract note and let a compact successor note retain its schema
IDs, schema digests, port UUIDs, contract digest, and source-note UUID. Treat
this compact reference as a migration fallback after spell factoring, not as
the primary deduplication design.

During a compatibility window, a legacy implementation that is exactly
behavior-compatible may become a small `leafspell` alias to the visible
canonical spell. Preserve its UUID, position, edges, definition, and original
contract note, and update both `leafnodetype` and encoded `leaf.logic.type`.
Do not alias when the legacy output intentionally differs, such as a validator
that emits its own legacy `validatorRef`; retain that implementation until the
compatibility contract permits a behavior change. Execute the same fixtures
through both names and compare exact outputs before planning a write.

## State and side effects

- Trigger state changes and external actions from new data events, not generic
  control ticks carrying previously latched data.
- Assign stable command or event identity before a side-effecting node.
- Require bounded retry and durable or provider-authoritative idempotency for
  production-visible writes.
- Make replay and checkpoint behavior explicit at the workflow boundary.
- Keep credentials, authorization headers, signed URLs, and secret-bearing
  configuration out of encoded graph payloads and logs.
- Test the pure transition separately from the adapter that persists or sends
  it.

## Validation checklist

Before persistence or execution:

- Decode every node and edge with the selected GhostOS npm release.
- Require unique node and edge UUIDs and valid nested edge ownership.
- Require `leafnodetype` to match decoded `leaf.logic.type`.
- Confirm intended executable and definition components are classified as
  runtime or lambda, intentionally excluded sections are classified as
  anchored, and every isolated or unclassified node is justified.
- Require at most one runtime/main component in each namespace. A page may
  have no main graph when it only exports definitions.
- Confirm every reusable implementation component is lambda-attached to its
  owning `leafspelldef`; otherwise it is session-active as part of main while
  the namespace page is open.
- Confirm each spell call resolves to the intended definition and exposes a
  default dataflow with compatible ports.
- Confirm repeated contracts and implementations have one owning
  `leafspelldef` per intended library scope and that callers use visible
  `leafspell` nodes rather than copied LEAFlisp bodies.
- Confirm every `leafgraph` address resolves to the intended namespace,
  including current-domain resolution for `/<app-id>` references.
- Confirm each `leafgraph` lambda-attaches only to spell calls owned by one
  `leafspelldef`, or only to calls in the single main graph. Split imports by
  owner even when their provider address is identical.
- Confirm a `leafgraph` spellbook import exposes definitions without executing
  the imported namespace's browser-session main graph.
- Confirm lambda and anchor edges do not accidentally carry runtime data.
- Confirm each anchor target and its data- and lambda-connected graph are
  intentionally absent from runtime execution.
- Confirm anchored `leaflisp` notes contain no required behavior or sensitive
  data.
- Confirm every branch has deliberate admission and rejoin semantics.
- When a named bottle feeds LEAFlisp, confirm a dictionary mix preserves the
  meaningful name as a key, or document why raw `leafunbottle` content is the
  intended contract. Test the exact key and metadata behavior.
- Confirm concurrent events cannot cross-pair inputs and state snapshots.
- Exercise representative normal, rejected, empty, falsy, error, replay, and
  out-of-order inputs.
- Execute pure components locally before testing host-dependent state or
  effects.
- Follow the direct API acknowledgement and authoritative re-query workflow in
  `SKILL.md` for any persisted change.
