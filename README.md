# LEAF End-User Quickstart

This repository provides a LEAF skill package and scripts you can run locally
with your own agentic coding tool/subscription to program LEAF graphs through
`/qmgraphql`.

Use this guide if you want to:

- create a LEAF API token for agentic coding,
- clone this repo locally,
- wire your token as an environment variable,
- start issuing LEAF coding prompts, and
- verify graph changes in the Leafgon browser UI.

Reference endpoints in this guide:

- GraphQL API: `https://www.leafgon.com/qmgraphql`
- LEAF editor page: `https://www.leafgon.com/editor/<domain>/<appid>`
- Example namespace page: `https://www.leafgon.com/editor/leafgon/guides`

## Getting Started

### Prerequisites

- A Leafgon account.
- Permission on your target graph namespace (`<domain>/<appid>`) with
  write/admin/owner authorization.
- Git installed.
- Node.js and npm installed (recommended current LTS).
- An agentic coding tool that can work from a local repo.

### 1) Create a `leafelement(token)` with minimum `graphql:write` scope

Create this topology in one target graph:

```text
leaflisp --leaflambdaedge--> leafelement(token)
```

Set the LEAFlisp source (`leaf.logic.args.lispexpression`) to the minimum scope
for agentic graph mutation:

```lisp
{:scopes ["graphql:write"]}
```

Notes:

- `graphql:write` is the minimum for graph mutations via API.
- In this deployment model, write implies matching read permission.
- Keep scope least-privileged; only add non-GraphQL scopes when required.

After adding the lambda edge, capture the one-time token value from the
`apiToken.created` event in the GraphQL mutation response. Store it immediately
in your secret manager.

### 2) Export token env var, clone repo, and start prompting

Use `LEAFGON_API_TOKEN` as your environment variable name.

### macOS/Linux (bash/zsh)

```bash
export LEAFGON_API_TOKEN='leaf_live_<token-node-uuid>_<secret>'
git clone https://github.com/leafgon/leafstack.git
cd leafstack
```

### Linux/macOS (fish)

```fish
set -x LEAFGON_API_TOKEN 'leaf_live_<token-node-uuid>_<secret>'
git clone https://github.com/leafgon/leafstack.git
cd leafstack
```

### Windows PowerShell

```powershell
$env:LEAFGON_API_TOKEN = "leaf_live_<token-node-uuid>_<secret>"
setx LEAFGON_API_TOKEN "leaf_live_<token-node-uuid>_<secret>"
git clone https://github.com/leafgon/leafstack.git
cd leafstack
```

### Windows Command Prompt (`cmd`)

```cmd
set LEAFGON_API_TOKEN=leaf_live_<token-node-uuid>_<secret>
setx LEAFGON_API_TOKEN "leaf_live_<token-node-uuid>_<secret>"
git clone https://github.com/leafgon/leafstack.git
cd leafstack
```

Then run a quick workspace check:

```bash
.agents/skills/leaf/scripts/inspect-leaf-workspace.sh
```

If you are on Windows, run that command in Git Bash or WSL.

Start your agentic coding tool from this repo and use prompts like:

- "Use the LEAF skill in this repo. Read graph `<domain>/<appid>` from
  `https://www.leafgon.com/qmgraphql` and summarize nodes/edges."
- "Create a local batch plan to add one `leaflisp` node and one
  `leafdataedge`, but do not apply remotely."
- "After showing the diff and confirmation digest, apply the reviewed batch to
  my target graph using `LEAFGON_API_TOKEN`."

### 3) See updates in Leafgon browser

In your browser:

1. Open the LEAF editor endpoint for your target namespace:
   `https://www.leafgon.com/editor/<domain>/<appid>`.
2. Keep the page open while running API mutations from your tool.
3. Refresh or reload after mutation acknowledgement to confirm node/edge and
   coordinate updates.

For the public example namespace used in the SPA docs, open:

`https://www.leafgon.com/editor/leafgon/guides`

For additional verification from terminal, re-query or inspect local snapshots
using:

```bash
node .agents/skills/leaf/scripts/inspect-leaf-graph.mjs path/to/graph.json
```

## Useful scripts in this repo

- `node .agents/skills/leaf/scripts/leaf-graph-batch.mjs <batch.json>`:
  simulate and validate local batch operations.
- `node .agents/skills/leaf/scripts/leaf-graph-batch.mjs <batch.json> --apply ...`:
  apply reviewed operations to leaf-server.
- `.agents/skills/leaf/scripts/validate-skill.sh`:
  validate the local skill package after edits.

## Tutorial: build a LEAF web app (`leafgon/guides`)

See `TUTORIAL_WEB_APP_LEAFGON_GUIDES.md` for a step-by-step tutorial on using
agentic LEAF programming to build/update a browser web app namespace similar to
`leafgon/guides`.

## Security checklist

- Never commit tokens, cookies, or authorization headers.
- Never paste raw token values into Markdown, JSON fixtures, or PR text.
- Keep token material in env vars or a secret manager only.
- Rotate/revoke tokens if exposure is suspected.
