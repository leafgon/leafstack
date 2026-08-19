# Tutorial: Build a LEAF web app (your namespace), with `breezyforest/guides` as reference

This tutorial shows how to use your own agentic coding tool + this repo to
create/update a browser-rendered LEAF web app in **your own** namespace
(`<domain>/<appid>`).

It also includes `breezyforest/guides` as a reference example pattern, not as a
required target.

Use these endpoints:

- API endpoint: `https://www.leafgon.com/qmgraphql`
- Editor endpoint pattern: `https://www.leafgon.com/editor/<domain>/<appid>`

Reference example namespace:

- `domain`: `breezyforest`
- `appid`: `guides`
- Editor URL: `https://www.leafgon.com/editor/breezyforest/guides`

## What you will build

A minimal guides web app flow:

- a page shell rendered in the LEAF editor/browser session,
- topic links/cards,
- a navigation event bottle from HTML click handlers,
- LEAF graph wiring that handles the bottle and routes to an href target.

This follows the SPA guidance in:

- `.agents/skills/leaf/references/spa-pattern.md`

## Prerequisites

- A Leafgon account.
- Write/admin/owner permission for your target namespace.
- A `leafelement(token)` token with at least `graphql:write` scope.
- Local clone of this repo.
- `LEAFGON_API_TOKEN` exported in your current shell.

## Step 1: Open your own namespace in browser

Open your target namespace editor URL:

`https://www.leafgon.com/editor/<your-domain>/<your-appid>`

Replace `<your-domain>/<your-appid>` with the namespace you actually own/use.

Keep this tab open during development so you can quickly refresh and validate
graph updates.

If you want to study a public reference, separately open:

`https://www.leafgon.com/editor/breezyforest/guides`

## Step 2: Ask your agent to inspect the current graph

Use a prompt like:

> Use the LEAF skill from this repo. Query `<your-domain>/<your-appid>` from
> `https://www.leafgon.com/qmgraphql`, decode nodes/edges, and summarize:
> main/runtime component, spell definitions, anchored vs unanchored subgraphs,
> and current navigation flow.

Expected output from your agent:

- node/edge inventory,
- identified main graph entry path,
- any missing SPA pieces (e.g., gate/transform/href path).

## Step 3: Ask for a safe change plan first

Use a prompt like:

> Propose the smallest LEAF patch to add topic-card navigation behavior:
> HTML emits a `guide-nav` bottle with `{topic, url}`, then graph gates by
> bottle name and routes only approved href requests. Show a local-only plan
> first (no remote apply).

This keeps the first iteration reviewable and avoids direct live mutation.

## Step 4: Implement navigation bottle pattern

Your agent should follow the SPA navigation pattern from
`.agents/skills/leaf/references/spa-pattern.md`:

```text
html click -> doelementio/doscreenio
-> elementio bottle
-> gate(elementio)
-> transform
-> gate(href-request)
-> leafelement(href)
```

For topic clicks in your own namespace, emitted URL patterns should target your
namespace, e.g.:

`/editor/<your-domain>/<your-appid>?topic=<topic>`

Reference example pattern used in docs:

`/editor/breezyforest/guides?topic=<topic>`

Use a prompt like:

> Apply the reviewed patch to `<your-domain>/<your-appid>`: add/update nodes
> and edges for `guide-nav` bottle handling and href routing. Keep naming stable
> and preserve existing runtime dataflow behavior.

## Step 5: Verify in browser and via re-query

After mutation acknowledgement:

1. Refresh `https://www.leafgon.com/editor/<your-domain>/<your-appid>`.
2. Click topic cards/links and verify navigation behavior.
3. Re-run an agent prompt:

> Re-query `<your-domain>/<your-appid>` and verify postconditions: expected new
> node UUIDs, edge topology, and no unintended changes outside navigation flow.

## Step 6: Iterate safely

For each iteration:

- request a plan first,
- apply minimal graph mutations,
- re-query and verify topology invariants,
- test in browser.

Good follow-up improvements:

- add active-topic highlight state,
- improve accessibility labels/keyboard handling,
- add fallback topic routing,
- split reusable logic into anchored subgraphs.

## Recommended prompts (copy/paste)

### Prompt 0: Bootstrap from reference patterns

> Use LEAF skills with `LEAFGON_API_TOKEN` for API auth and learn coding
> patterns from graphs in namespace `breezyforest/guides`.

### Prompt 0.1: Review source content

> Review contents in `<contents source>` and summarize the sections, hierarchy,
> and navigation model needed for an SPA presentation.

### Prompt 0.2: Implement target SPA graph

> Implement LEAF graphs for an SPA to present the contents in namespace
> `<domain>/<appid>`. Reuse proven patterns from `breezyforest/guides`, then
> show a minimal diff plan before applying mutations.

### Prompt A: Analyze current namespace

> Use the LEAF skill in this repo. Inspect `<your-domain>/<your-appid>` from
> `https://www.leafgon.com/qmgraphql` and return a concise graph architecture
> summary plus risks before editing.

### Prompt B: Plan minimal SPA patch

> Propose a minimal patch for topic-based navigation in
> `<your-domain>/<your-appid>` using a `guide-nav` bottle and gated href
> routing. Show operation order and why each node/edge is needed.

### Prompt C: Apply and verify

> Apply the approved patch to `<your-domain>/<your-appid>`, then re-query and
> verify the exact postconditions. Report acknowledgements, changed UUIDs, and
> any risk.

## Troubleshooting

- `401`/`403`: token missing scope or account lacks namespace permission.
- Graph updates but UI unchanged: browser tab still on stale session, refresh.
- Navigation click does nothing: verify bottle name/path and gate wiring.
- Unexpected side effects: revert with a reviewed inverse patch and re-query.

## Security reminders

- Never paste raw token values into prompts, docs, or commits.
- Keep `LEAFGON_API_TOKEN` in env/secret manager only.
- Treat edits against your namespace as live-state mutations.
