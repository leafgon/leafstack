# LEAFlisp Programming Model

## Contents

- Implementation layers
- Standalone execution
- Language and values
- Host globals
- Graph-node integration
- Authoring rules
- Change and test matrix

## Implementation layers

LEAFlisp is an embedded Lisp implemented inside GhostOS. For agentic execution,
the selected npm release is authoritative; use local source paths only to
understand internals or develop GhostOS itself:

- `pocket-lisp/scanner.ts`: tokenization.
- `pocket-lisp/parser.ts`: syntax parsing.
- `pocket-lisp/interpreter.ts`: evaluation.
- `pocket-lisp/core/`: special forms such as `def`, `defn`, `fn`, `do`, `if`, and side-effect sequencing.
- `leaflisp/stdlib/`: boxed value types, operators, iteration, vector/random modules, conversions, and assertions.
- `nodelogic/wizardry/leaflisp.js`: JS/LEAFlisp conversion, host globals, standalone execution, bottles, errors, and graph-node wiring.

Do not add syntax in the host wrapper or add host behavior in the parser. Put a change at the layer that owns it.

## Standalone execution

The selected GhostOS npm release exports `createLEAFlispRuntime`,
`parseJsonToLEAFlisp`, and `executeLEAFlisp` through its core/browser
entrypoints. Resolve `ghostos@latest` at task time unless the task pins a
version.

`executeLEAFlisp(inputData, code, options)`:

1. Converts input JSON to LEAFlisp source.
2. Prepends `(def inport ...)` by default.
3. Adds explicitly supplied bindings after validating their names.
4. Executes the combined source in PocketLisp.
5. Converts boxed hash maps, vectors, strings, numbers, booleans, and `Nothing` back to JS values.

Example:

```js
const { executeLEAFlisp } = require("ghostos/core");

const result = executeLEAFlisp(
  { count: 2 },
  "(+ (get inport :count) 1)"
);
```

This CommonJS form is required for `ghostos@0.2.5` because its ESM core entry
is packaged with unresolved CommonJS `require` calls. Re-check the selected
release rather than carrying the workaround forward blindly.

Use the bundled smoke runner from the Leafgon root:

```sh
node .agents/skills/leaf/scripts/run-leaflisp.mjs \
  --code program.leaflisp \
  --input input.json
```

## Language and values

Common supported forms and literals include:

```lisp
; comment
(def value 3)
(defn increment [x] (+ x 1))
(fn [x] (+ x 1))
(do expression-1 expression-2)
(if condition then-expression else-expression)
[1 2 3]
{:name "leaf" :enabled true}
(get inport :name)
```

Values are boxed by the LEAFlisp runtime. Host `undefined` and `null` become the runtime `Nothing` value and standalone output converts it to JS `null`. Do not assume raw JavaScript operator behavior.

The host wrapper supplies useful globals including:

- `return`, `outport`
- `undefined`, `nil`, `null`
- `trace`, `probe`
- `isnil`, `isbottle`, `islist`
- `bottle`, `getbottle`, `unbottle`
- `flatten`, `join`, `concat`
- `regexp`, `min`, `max`, `parse`, `parse-json`
- `merge-dict`, `make-dict`
- `uuid4`, `uuid5`
- arithmetic helpers

The PocketLisp runtime and stdlib contribute additional globals. Inspect the actual runtime object and tests before using a less common function.

## Host globals

Do not invent globals. Confirm whether the current execution surface supplies:

- `inport` or a custom input binding
- explicit extra bindings
- `return`/`outport`
- trace/probe callbacks
- graph IO helpers

Bottle-shaped inputs use:

```json
{
  "_bname": "name",
  "_content": "payload",
  "_label": {}
}
```

Inspect the actual wrapper before reading nested provider data. A response may be several levels below `_content`, `result`, and `value`.

## Graph-node integration

A `leaflisp` node stores its source in decoded node data at:

```text
leaf.logic.args.lispexpression
```

Author this field in the decoded payload, encode the complete node data with
the selected GhostOS release, and persist it directly through leaf-server's
`addNode` or `updateNode` mutation. Re-query and decode the stored node before
treating the change as successful.

At execution time, GhostOS initializes one shared LEAFlisp runtime on the eta
tree, wires data/control accio bottles, and invokes the node implementation
through the same eta-reduced dataflow machinery as other nodes. Piper's node
palette is historical evidence for the field location only; it is not part of
the agentic authoring or persistence path.

Treat a normal LEAFlisp node as a pure data transform. If host globals introduce side effects, classify and protect those effects explicitly rather than hiding them inside code.

## Authoring rules

- Prefer the final expression directly when it is the node result. Under
  `ghostos@0.2.15`, `(return {:hello "world"})` and `{:hello "world"}` are
  operationally equivalent at the top level, and the last expression in
  `do` or a selected `if` branch is likewise returned. Use `return` only when
  its explicit early-exit behavior is needed, and re-qualify this shorthand
  on a later selected runtime.
- Keep `if` conditions strictly boolean. Under `ghostos@0.2.16`, non-boolean
  conditions such as strings raise a runtime error instead of using JS-like
  truthiness.
- Re-qualify equality/operator names on the selected runtime before relying on
  them. Under `ghostos@0.2.16`, `=` is undefined in `executeLEAFlisp` unless
  your environment provides an explicit equality binding.
- For standalone/runtime-portable equality checks on `ghostos@0.2.16`, use
  `==` (for example `(== (get inport :topic) "intro")`) and re-verify when
  upgrading GhostOS.
- Read object fields with `get` and keyword keys after confirming the object shape.
- Define small helpers locally unless the runtime demonstrably injects them.
- Preserve `false`, `0`, `""`, empty vectors, and missing values through conversion tests.
- Avoid `(+ [] [])` in current GhostOS behavior; it can take a numeric path and fail. Use `concat` for vectors or reduce by appending a known item.
- Avoid embedding environment-specific URLs and credentials.
- Keep transformations deterministic.
- Surface parser/interpreter errors with node and adjusted source-line context.

Example:

```lisp
(do
  (def count (get inport :count))
  {:count (+ count 1)
   :name (get inport :name)})
```

## Change and test matrix

| Change | Required tests |
| --- | --- |
| Token or syntax | scanner, parser, interpreter |
| Special form | core form tests and interpreter tests |
| Boxed value/operator | stdlib type-class and conversion tests |
| New stdlib function | direct stdlib tests plus standalone `executeLEAFlisp` coverage |
| JS conversion/preamble | wizardry LEAFlisp unit tests and falsy/null/empty cases |
| Graph-node execution | node integration test with data/control input |
| Encoded node/API persistence | Decode round trip, direct leaf-server mutation acknowledgement, authoritative re-query, and stored `lispexpression` comparison |

For LEAF program work, execute focused examples against the selected npm
release and verify persisted node data through leaf-server. If a task includes
runtime/library source changes outside this skill, run that target project's
documented CI/test command set.
