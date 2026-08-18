# Program with `leafmemoryio`

## Contents

- Mental model
- Node contract
- Read, write, and forget behavior
- Virgin forget-node pattern
- Composition patterns
- Scope and persistence
- Safety rules
- Validation checklist

## Mental model

Treat `leafmemoryio` as a named state cell exposed as a dataflow node. Do not
model read and write as different node types. The node's memory name selects a
slot, while the presence and kind of incoming data determine the operation.

Multiple visual `leafmemoryio` nodes with the same memory name in the same
graph scope address the same logical slot. Use separate instances as readable
source and writable sink positions when that makes the dataflow easier to
understand:

```text
memory read --\
new input ----> derive next value -> memory write -> output
```

Keep the derivation outside the memory node. Make it a pure transform that can
be tested without state.

## Node contract

Store the memory name in decoded node data at:

```text
leaf.logic.args.elementconfig.leafnodename
```

The default configuration also contains `persistencyref.updateref` and
`persistencyref.dbref`. Do not treat those fields as active durability for
local memory. Preserve them during unrelated node updates, but leave them
empty unless a reviewed runtime contract explicitly uses them.

In default bottle mode, expect memory output to carry:

```json
{
  "_bname": "<memory-name>",
  "_content": "<stored-value-or-empty>",
  "_label": {
    "_type": "memoryio",
    "_command": "<operation>",
    "_memoryname": "<memory-name>"
  }
}
```

Treat `_label._type` and `_label._command` as protocol fields. Preserve any
additional provenance and node-location labels emitted by the runtime.

## Read, write, and forget behavior

Use these established behaviors:

- Read an existing value when the node executes without a meaningful incoming
  value. The default output is a bottle named after the memory slot and labeled
  with the output command `o`.
- Write or replace the current value when non-empty data enters the node. The
  node stores the value and emits the resulting memory output downstream with
  the I/O command `io`.
- Read a virgin slot as empty. The emitted empty bottle carries
  `_type: "memoryio"` and `_command: "forget"` in its labels.
- Reset a target memory when it receives a bottle whose labels identify the
  memory-IO `forget` command. Treat the target as having forgotten its prior
  value after processing that bottle.

The reset decision is label-driven. A normal application bottle merely named
`forget` is not a memory reset command unless it carries the memory-IO forget
labels.

Keep reads and writes deliberate. A node with no incoming data edges acts as a
source-style read during component execution. A node with an incoming data
edge acts as a write/update point when fresh data arrives. Do not let a generic
control tick replay a previously latched write.

## Virgin forget-node pattern

Create a dedicated `leafmemoryio` node conventionally named `forget`. Keep it
virgin: never write a value into it and normally give it no incoming data
edges. Reading that absent slot emits an empty memory bottle whose labels carry
the `forget` command. The name is a human-readable convention, not a reserved
identifier or the reset trigger; virgin state produces the empty bottle, and
the memory-IO labels make receivers interpret it as a reset command.

Connect the virgin node to each memory that should be reset with a data edge:

```text
leafmemoryio("forget") --leafdataedge--> leafmemoryio("target-memory")
```

When the component reads the virgin source, the forget bottle flows into the
target and resets its prior state. Fan out the source to multiple targets only
when they must be forgotten together.

Preserve these invariants:

- Do not write into the virgin `forget` node; once populated, it no longer
  represents an absent slot reliably.
- Use a data edge, not a lambda or anchor edge, because the forget bottle is a
  runtime value.
- Keep the reset path separate or gated from ordinary writes so a reset and a
  replacement value cannot race at the same target.
- Scope the forget source to the intended reset action. If its component runs
  on every normal event, it can repeatedly erase state.
- Inspect every outgoing edge before changing the forget node because one
  source may reset several named memories.

Prefer the virgin-node pattern over manually forging a forget bottle. If a
test constructs one directly, include the memory-IO type and command labels and
exercise it against the selected GhostOS release.

## Composition patterns

### Read, derive, and write

Use two visual memory nodes with the same name when representing both sides of
a state transition:

```text
read("state") ----\
event ------------> pure reducer -> write("state") -> outflow
```

Correlate the read snapshot with the event that caused it. A graph-shaped
read/modify/write sequence is not automatically atomic; serialize updates or
apply an explicit conflict policy when events can overlap.

### Reset and then accept new state

Route reset and update inputs as mutually exclusive operations:

```text
forget source -> reset gate --\
new value ----> write gate ----> target memory
```

Do not use a mix mode that can pair a stale forget bottle with a new write.
Test reset followed by a fresh write and confirm the fresh value becomes the
new readable state.

### Use memory output downstream

Treat a write as state update plus output, not as a terminal sink. Connect its
output to an outflow port or another transform when the workflow must return
the stored value or its memory bottle.

## Scope and persistence

Assume the default memory key is scoped by graph domain, app ID, and memory
name. Same-name nodes share a slot only when their effective runtime scope also
matches.

Check lambda modifiers and the selected release before relying on variants:

- `on-tap` can expose raw memory content rather than the usual named bottle.
- `proxy` can add session-specific identity to the effective memory key.
- Global or persistent memory requires an explicit supported storage,
  idempotency, replay, and credential contract.

Treat in-process memory as ephemeral. Do not claim restart durability,
cross-worker consistency, or transactional updates without runtime and storage
evidence. Current policy may block persistent modes that lack those contracts.

## Safety rules

- Trigger writes and resets from new data events.
- Assign stable event identity when memory updates can be retried or replayed.
- Require explicit checkpoint and replay rules for restored processing.
- Keep secrets and credentials out of memory names, encoded payloads, bottles,
  labels, and logs.
- Do not use local memory as a substitute for a durable database or queue.
- Do not assume two concurrent read/derive/write paths are isolated.
- Preserve falsy values deliberately; distinguish `false`, `0`, empty strings,
  and empty collections from an absent or forgotten slot.

## Validation checklist

- Decode the node and confirm `leafnodetype` and `leaf.logic.type` are both
  `leafmemoryio`.
- Confirm every same-name memory node is intended to share one effective slot.
- Confirm source-style reads and write/update nodes have the intended incoming
  data-edge topology.
- Seed a target, read it, update it, and read the replacement.
- Read the virgin `forget` node and assert an empty bottle with memory-IO
  `forget` labels.
- Send that bottle through the data edge, then read the target and assert its
  past value is forgotten.
- Repeat the reset and confirm it is safe and deterministic.
- Write a fresh value after reset and confirm subsequent reads return it.
- Test reset versus write ordering and concurrent updates.
- Test missing, null-like, falsy, and empty collection values separately.
- Verify restart and cross-worker behavior before claiming persistence.
- Re-query and decode persisted node and edge data after any live graph change.
