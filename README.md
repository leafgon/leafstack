# LEAF Agentic Programming Toolkit

This repository contains public skills, references, and command-line helpers for
building and maintaining LEAF graphs with an agentic coding tool. It uses
Leafgon's public browser routes and leaf-server APIs; ordinary graph work does
not require private platform source repositories.

Use it to:

- inspect and explain an existing LEAF namespace;
- plan and validate node/edge changes locally;
- apply reviewed graph CRUD through `/qmgraphql`;
- execute focused LEAFlisp with the public `ghostos` npm package;
- capture the deployed editor's rendering of a main graph or spelldef; and
- create and verify objects through a namespace's Blob API storage spell.

Reference endpoints used throughout the documentation:

- Graph API: `https://www.leafgon.com/qmgraphql`
- Editor: `https://www.leafgon.com/editor/<domain>/<appid>`
- Example namespace: `https://www.leafgon.com/editor/breezyforest/guides`

## Requirements

- A Leafgon account.
- Read or write permission on the target `<domain>/<appid>` namespace.
- Git.
- Node.js 24 or newer and npm. The current GhostOS release requires Node 24+.
- An agentic coding tool capable of reading repository-local skills.

## Quick start

```bash
git clone https://github.com/leafgon/leafstack.git
cd leafstack
.agents/skills/leaf/scripts/inspect-leaf-workspace.sh
```

The workspace check reports the runtime toolchain, current GhostOS npm release,
and expected skill files. On Windows, run it in Git Bash or WSL.

Read `.agents/skills/leaf/SKILL.md` before asking an agent to change a graph.
For direct Blob API work, also read `.agents/skills/leaf-blob-api/SKILL.md`.

## Create a least-privileged API token

Leafgon API tokens are created by constructing this graph pattern in a
namespace you control:

```text
leaflisp --leaflambdaedge--> leafelement(token)
```

The LEAFlisp node returns token settings. Leaf-server recognizes the completed
pattern, creates the token, and emits its raw value exactly once in the edge
mutation response's `extensions.leafEvents[]` as an `apiToken.created` event.
Move that value directly into a secret manager. It cannot be retrieved later.

Creating the pattern itself requires an authenticated actor with effective
`graphql:write` and write/admin/owner authorization on the graph. A token's
scopes are an additional gate; they do not bypass graph permissions.

### Available scope families

| Scope | Allows | Typical use |
| --- | --- | --- |
| `graphql:read` | Graph reads through `/qmgraphql` | Inspecting and validating graphs |
| `graphql:write` | Node and edge mutations through `/qmgraphql` | Authoring LEAF graphs |
| `blob-storage:read` | Blob object reads and list operations | Inspecting stored objects |
| `blob-storage:write` | Blob object creation, overwrite, and deletion | Publishing HTML, images, or runtime files |
| `cortex:read` | Cortex-family read routes | Inspecting Cortex jobs or results |
| `cortex:write` | Cortex-family write routes | Submitting Cortex work |
| `hermes:read` | Hermes-family read routes | Reading Hermes events or state |
| `hermes:write` | Hermes-family write routes | Sending Hermes commands |

A family write scope implies that family's read permission. It does not imply
access to a different family: for example, `blob-storage:write` does not grant
`graphql:read`.

The deployed allowlist is authoritative and may evolve. Before authoring a
token, confirm the current scope list documented in
`.agents/skills/leaf/references/api-tokens.md`.

### Scope recipes

Read-only graph inspection:

```lisp
{:scopes ["graphql:read"]}
```

Graph authoring:

```lisp
{:scopes ["graphql:read" "graphql:write"]}
```

Blob inspection from a helper that must first resolve the storage spelldef:

```lisp
{:scopes ["graphql:read" "blob-storage:read"]}
```

Blob publishing from the bundled storage helper:

```lisp
{:scopes ["graphql:read" "blob-storage:write"]}
```

Graph authoring plus blob publishing:

```lisp
{:scopes ["graphql:read" "graphql:write" "blob-storage:write"]}
```

Cortex or Hermes work should add only the route family and access level that
the intended workflow actually uses. For example:

```lisp
{:scopes ["graphql:read" "cortex:write"]}
```

```lisp
{:scopes ["graphql:read" "hermes:read"]}
```

Scopes must be unique and non-empty, with no more than 16 entries. Optional
`permissions` can narrow declared scopes but cannot grant an undeclared scope.
Omit `permissions` unless the workflow needs that extra restriction.

Tokens expire after 90 days by default. The settings may supply an RFC 3339
`expiresAt` between one hour and 365 days after creation. See the complete
[token lifecycle reference](.agents/skills/leaf/references/api-tokens.md) for
canonical topology, narrowed permissions, revocation, rotation, and safe
verification.

## Keep the token out of the repository

Use an environment variable for the current shell. The examples below contain
placeholders, not valid credentials.

macOS/Linux (bash or zsh):

```bash
export LEAFGON_API_TOKEN='leaf_live_<token-node-uuid>_<secret>'
```

fish:

```fish
set -x LEAFGON_API_TOKEN 'leaf_live_<token-node-uuid>_<secret>'
```

PowerShell:

```powershell
$env:LEAFGON_API_TOKEN = "leaf_live_<token-node-uuid>_<secret>"
```

Command Prompt:

```cmd
set LEAFGON_API_TOKEN=leaf_live_<token-node-uuid>_<secret>
```

Prefer a secret manager or your agentic tool's secure environment injection for
longer-lived use. Do not put tokens in `.env` files unless your local workflow
protects them; `.env*` is ignored by this repository except `.env.example`.

## Common workflows

### Inspect a graph without changing it

Ask your agent:

> Use `.agents/skills/leaf` to read `<domain>/<appid>` from
> `https://www.leafgon.com/qmgraphql`. Decode and inspect the graph with
> `ghostos@latest`. Explain its main graph, spelldefs, dataflow components, and
> data/lambda/anchor edges. Do not mutate anything.

Inspect a saved graph fixture directly:

```bash
node .agents/skills/leaf/scripts/inspect-leaf-graph.mjs path/to/graph.json
```

### Plan and apply graph changes

Plan a batch without writing:

```bash
node .agents/skills/leaf/scripts/leaf-graph-batch.mjs path/to/batch.json
```

Review the operation list, graph addresses, and printed digest. Apply only the
reviewed batch:

```bash
node .agents/skills/leaf/scripts/leaf-graph-batch.mjs path/to/batch.json \
  --apply \
  --confirm sha256:<reviewed-digest> \
  --confirm-endpoint https://www.leafgon.com/qmgraphql \
  --token-env LEAFGON_API_TOKEN
```

The helper validates mutation acknowledgements and re-queries affected graphs.
Remote multi-operation batches are ordered orchestration, not transactions.

### Publish a blob object

The target namespace must expose exactly one wired `leafelement(blob)` in the
named spelldef. The token needs `graphql:read` to resolve that topology and
`blob-storage:write` to store the object.

```bash
node .agents/skills/leaf/scripts/leaf-blob-storage.mjs store \
  --domain <domain> \
  --appid <appid> \
  --spelldef storage \
  --file path/to/guide.html \
  --description "End-user guide for the example workflow" \
  --token-env LEAFGON_API_TOKEN
```

Every create requires a concise, meaningful description. The helper resolves
the runtime file reference, stores the deterministic object, verifies its
metadata, and confirms `objectMetadata.description` through the list contract.
See the [blob storage reference](.agents/skills/leaf/references/blob-storage.md)
and [Blob API skill](.agents/skills/leaf-blob-api/SKILL.md).

### Capture the deployed graph

```bash
node .agents/skills/leaf/scripts/capture-leaf-editor.mjs \
  --domain <domain> \
  --appid <appid> \
  --main \
  --output artifacts/main-graph.jpg
```

Use `--spelldef <name>` instead of `--main` to isolate one reusable definition.
The capture is rendering evidence; `/qmgraphql` remains persistence authority.

## Repository layout

| Path | Purpose |
| --- | --- |
| `.agents/skills/leaf/` | Primary LEAF authoring skill, references, helpers, and tests |
| `.agents/skills/leaf-blob-api/` | Direct Blob API operations and troubleshooting |
| `.claude/skills/leaf` | Compatibility symlink to the primary LEAF skill |
| `docs/` | End-user tutorials and release documentation |

Generated captures, local graph snapshots, runtime installs, and other working
artifacts belong in ignored `artifacts/` or `.tmp/`, not in commits.

## Documentation

- [Build a LEAF web app](docs/TUTORIAL_WEB_APP_BREEZYFOREST_GUIDES.md)
- [Token lifecycle and scopes](.agents/skills/leaf/references/api-tokens.md)
- [Graph API CRUD](.agents/skills/leaf/references/leaf-server-api.md)
- [Graph runtime model](.agents/skills/leaf/references/graph-runtime.md)
- [LEAFlisp](.agents/skills/leaf/references/leaflisp.md)
- [Elements catalogue](.agents/skills/leaf/references/leafelements.md)
- [SPA host pattern](.agents/skills/leaf/references/spa-pattern.md)
- [Blob storage](.agents/skills/leaf/references/blob-storage.md)
- [Browser capture](.agents/skills/leaf/references/browser-capture.md)

## Validate this repository

```bash
.agents/skills/leaf/scripts/validate-skill.sh
bash .agents/skills/leaf-blob-api/scripts/validate-skill.sh
```

These commands run syntax checks and focused helper/layout tests. They do not
mutate a remote graph.

## Security

- Never commit tokens, cookies, authorization headers, runtime file references,
  payload base64, or provider credentials.
- Keep API tokens least-privileged, short-lived, and scoped to the intended
  route families.
- Revoke and rotate a token immediately if exposure is suspected.
- Treat production graph and blob operations as external side effects.
- Report vulnerabilities using the process in [SECURITY.md](SECURITY.md).

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Usage
questions and support boundaries are described in [SUPPORT.md](SUPPORT.md).
Participation in this project is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

This project is available under the [MIT License](LICENSE).
