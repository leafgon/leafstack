# GhostOS `leafelement` Catalogue

## Contents

- Catalogue authority
- Selection rules
- Wired elements
- Leaf-server lifecycle elements
- Blocked elements
- Non-registry source artifacts
- Side-effect rules

## Catalogue authority

This catalogue was derived from the `ghostos@0.2.5` npm package, which was npm `latest` on 2026-08-03. Re-run `npm view ghostos@latest version` and inspect the selected release before relying on it.

The release's metamodel allows 21 names. Runtime classification marks 18 as wired and three as blocked. “Allowed” means recognized by authoring metadata; it does not by itself mean executable.

## Selection rules

1. Require the element name to be allowed and wired in the selected GhostOS release.
2. Match the runtime class and host requirements to the task.
3. Prefer pure transforms for headless agentic execution.
4. Use UI/browser elements only when an appropriate host consumes their element descriptors or device APIs.
5. Provide durable/provider-authoritative idempotency for production side effects.
6. Do not infer support from a bundled `.js` or `.d.ts` file alone.

## Wired elements

| Element | Runtime class | Function and important requirements |
| --- | --- | --- |
| `gnav` | UI bridge | Produces a navigation/graph visual descriptor from node/edge/backdrop inputs; expects a UI host and supports refresh-style control. |
| `popup` | UI bridge | Wraps child element descriptors in a popup and routes close/UI events through element IO; expects a UI host. |
| `editor` | UI bridge | Produces an editor visual descriptor for graph/editor presentation; expects Piper-like UI rendering but is not needed for direct agentic CRUD. |
| `text` | Sink | Produces a text/editor descriptor from data or lambda source content; useful only with a UI renderer. |
| `prompt` | UI bridge | Produces prompt controls from UI definitions and emits user responses through element IO; expects a UI host. |
| `http` | Side-effecting action | Performs HTTP reads and writes from URI/header/mode configuration. Writes require explicit command identity, idempotency, bounded retry, and injected/available fetch. |
| `href` | Side-effecting action | Performs browser navigation/replace/assign commands. Requires a location-like browser target and command identity; unsuitable for ordinary headless execution. |
| `mediaplayer` | Sink | Produces a media-player descriptor for a resolved URI and media play/pause/stop controls; expects a UI/media host. |
| `image` | Sink | Produces an image visual descriptor from incoming image data/config; expects a UI renderer. |
| `mediainput` | Source | Opens browser media capture and emits media records. Lifecycle is control-driven and permissions are host-provided. |
| `midi` | Source | Opens MIDI input, emits device records, and supports outbound MIDI commands with browser-session duplicate suppression. Requires a MIDI-capable host. |
| `sound` | Stateful transform | Builds/connects Tone-style sources, instruments, effects, and targets; consumes sound config/init/data bottles and performs playback commands. Requires an audio host. |
| `html` | Pure transform | Templates data into an HTML/iframe visual descriptor and can route iframe messages through element IO. Rendering and message security belong to the host. Read [spa-pattern.md](spa-pattern.md) before using it as an application shell. |
| `form` | UI bridge | Builds an HTML/JSON-schema form descriptor and emits submitted form data through element IO. Requires a UI/iframe host. |
| `directus` | Side-effecting action | Performs Directus reads and create/update/upsert/delete operations. Mutations require endpoint, collection, credential handling, command identity, durable idempotency, and fetch transport. |
| `hermes` | Side-effecting action | Sends Hermes egress commands and supports event reads through SSE/polling with cursor/dedupe behavior. Requires configured leaf-server/Hermes APIs, credentials, and durable idempotency for writes. |
| `cortex` | Side-effecting action | Submits Cortex jobs and polls/normalizes results, including inline/URI payload references. Requires API configuration, command identity, dedupe/idempotency, and fetch transport. |
| `blob` | Side-effecting action | Executes versioned store/fetch bottles against an injected blob storage adapter; supports deterministic object IDs, metadata/failure envelopes, an in-memory test adapter, and a leaf-server storage adapter. Production writes require authoritative storage/idempotency context. |

Runtime triggers in `0.2.5` are data for all wired elements except `mediainput` and `midi`, whose source lifecycle is control-triggered. UI bridges and sinks still need a host that materializes their descriptor output.

## Leaf-server lifecycle elements

| Element | Status | Function and important requirements |
| --- | --- | --- |
| `token` | Leaf-server lifecycle marker; not a general GhostOS runtime adapter | Configure only as `leaflisp --leaflambdaedge--> leafelement(token)`. Leaf-server evaluates the LEAFlisp in trusted `apiTokenSettings` mode, validates the result, stores private verifier metadata, and emits the secret once. Read [api-tokens.md](api-tokens.md) before authoring or mutating this pattern. |

GhostOS may still mark `token` blocked in its general `leafelement` adapter
registry. That prevents ordinary graph execution; it does not disable the
separate leaf-server graph-pattern lifecycle. Never wire `token` as a normal
data-plane action or assume GhostOS itself issues credentials.

## Blocked elements

| Element | Status | Reason recorded by GhostOS runtime metadata |
| --- | --- | --- |
| `rancher` | Blocked; not wired; reject for new graphs | Remains unreachable until side-effect policy migration. A source file exists, but it is not registered. |
| `hippocampus` | Blocked; not wired; reject for new graphs | Requires persistence and security contracts. |

Do not create new graphs with these names. Treat existing graphs as legacy/blocked and stop for an approved migration decision.

## Non-registry source artifacts

The package includes declarations/source artifacts such as `openai.js`, but `openai` is not in the `0.2.5` allowed-name list or wired adapter registry. It is therefore not a supported `leafelement` for new graphs.

## Side-effect rules

For `http`, `href`, `directus`, `hermes`, `cortex`, and `blob`:

- Trigger work from new data, not generic control/config ticks.
- Assign stable command/event identity.
- Supply durable or provider-authoritative idempotency for production-visible writes.
- Bound retries and make replay explicit.
- Redact credentials, headers, signed URLs, payloads, and provider errors.
- Inject host transports/adapters instead of embedding environment credentials or URLs in reusable LEAF code.
- Test duplicate commands, retry/replay, missing configuration, malformed bottles, and redaction.
