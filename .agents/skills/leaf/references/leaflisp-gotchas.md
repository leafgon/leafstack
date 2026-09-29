# LEAFlisp Gotchas

Use this quick reference to avoid dialect drift that causes long debug loops.

## Unsupported tokens commonly seen in failed sessions

These patterns are not valid LEAFlisp authoring shortcuts in this skill:

- `(list ...)`
- `(vector ...)`
- `(array ...)`
- `inport2` (or other implicit extra inport aliases)
- `import` (mis-spelled input binding; use `inport`)

`preflight-runtime-dto.mjs` now blocks these patterns as static contract
violations.

If runtime reports `Undefined identifier: 'import'`, replace every LEAFlisp
`import` reference with `inport`.

## Shell-template strings are not runtime env expansion

Avoid shell-style placeholders inside LEAFlisp source, for example:

```clojure
"${ARITHMETIC_PROFILE_ID:-profile-001}"
```

LEAFlisp treats this as a literal string, not an environment lookup. Set values
directly in request payload construction logic.

## IN1 source extraction contract

For source-stage arithmetic request builders, use explicit keyed extraction:

```clojure
(def x (get inport :IN1))
```

Do not assume positional secondary aliases (for example `inport2`) for source
values.

## Raw `(parse inport)` safety policy

`(parse inport)` (and alias forms such as `(def x inport) ... (parse x)`) are
allowed when upstream contract guarantees scalar input.

Use preflight parse-safety modes:

- `--parse-safety balanced` (default):
  - hard-fails only when upstream shape is clearly non-scalar-risk;
  - warns when scalar contract is unproven.
- `--parse-safety strict`:
  - also fails unproven-scalar raw parse patterns.

When upstream may emit bottle/map payloads, extract scalar explicitly before
parse:

```clojure
(do
  (def payload0 (if (isbottle inport) (get inport :_content) inport))
  (def x (get payload0 :value))
  (parse x))
```

## HTTP parser contract (nil-safe)

Prefer this parser shape for `leafelement(http)` output:

```clojure
(do
  (def payloadzero (if (isbottle inport) (get inport :_content) inport))
  (def payload (if (isbottle payloadzero) (get payloadzero :_content) payloadzero))
  (def result (get payload :result))
  (if (isnil result) nil result))
```

Avoid optimistic assumptions that `inport` is already the final response map.

Avoid fallback parse shapes that can coerce missing values:

- `(parse (get payload :result))` without `(isnil ...)` guard.
- `(parse result)` when `result` is bound from `:result` and never nil-checked.

## Safer replacements

- Use direct map/vector literals when needed in your target runtime grammar.
- For multi-input joins, encode provenance in bottled payload names instead of
  positional assumptions.
- Prefer `leafmixflow` as a deterministic merge barrier before downstream
  `leaflisp` lookups.

## Multi-input anti-pattern

Avoid this in `leaflisp` when multiple edges feed the node:

```clojure
(do (def a (get inport 0)) (def b (get inport 1)) ...)
```

Use provenance-safe screening/lookup instead.

## Avoid placeholder wait-bottle fallbacks

Avoid emitting synthetic wait bottles from compute/request stages:

```clojure
(bottle "wait" 0)
```

Prefer deterministic readiness wiring (explicit merge/provenance contracts) so
HTTP requests only run when required inputs are present.

## Avoid lossy list coercion

Do not collapse list payloads to scalar `0`:

```clojure
(if (islist raw) 0 raw)
```

Use explicit non-lossy shaping (preserve list/map structure or branch by type).

## Downstream `:IN1` re-read caution

For non-source stages, avoid generic fallback extraction of `:IN1` from merged
upstream payloads. Consume transformed upstream values explicitly and preserve
provenance with named bottles/`leafmixflow` when original source values are
required downstream.

## Avoid keyed-mix over-unwrapping

When a `leaflisp` node consumes keyed output from named-bottle `leafmixflow`,
avoid redundant generic unwrap scaffolds such as:

```clojure
(def merged0 (if (isbottle inport) (get inport :_content) inport))
(def merged (if (isbottle merged0) (get merged0 :_content) merged0))
(def a (get merged :arg1))
```

Prefer direct keyed reads unless the upstream contract explicitly sends a bottle
envelope at that stage:

```clojure
(def a (get inport :arg1))
(def b (get inport :arg2))
```

## Fast recovery path

When runtime fails, run:

```sh
node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs \
  --graph path/to/graph.json \
  --out-key OUT1 \
  --out-kind any \
  --diagnose
```

Then apply only the first concrete fix from `diagnostics.issues`.
