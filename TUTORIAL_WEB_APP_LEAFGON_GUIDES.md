# Tutorial: Build a LEAF web app like `leafgon/guides`

This tutorial shows how to use your own agentic coding tool + this repo to
create/update a browser-rendered LEAF namespace similar to
`leafgon/guides`.

It assumes you are programming LEAF graphs through:

- API endpoint: `https://www.leafgon.com/qmgraphql`
- Editor endpoint: `https://www.leafgon.com/editor/<domain>/<appid>`

Example target for this tutorial:

- `domain`: `leafgon`
- `appid`: `guides`
- Editor URL: `https://www.leafgon.com/editor/leafgon/guides`

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

## Step 1: Open the namespace in browser

Open:

`https://www.leafgon.com/editor/leafgon/guides`

Keep this tab open during development so you can quickly refresh and validate
graph updates.

## Step 2: Ask your agent to inspect current graph

Use a prompt like:

> Use the LEAF skill from this repo. Query `leafgon/guides` from
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

For topic clicks, the emitted URL pattern can target:

`/editor/leafgon/guides?topic=<topic>`

Use a prompt like:

> Apply the reviewed patch to `leafgon/guides`: add/update nodes and edges for
> `guide-nav` bottle handling and href routing. Keep naming stable and preserve
> existing runtime dataflow behavior.

## Step 5: Verify in browser and via re-query

After mutation acknowledgement:

1. Refresh `https://www.leafgon.com/editor/leafgon/guides`.
2. Click topic cards/links and verify navigation behavior.
3. Re-run an agent prompt:

> Re-query `leafgon/guides` and verify postconditions: expected new node UUIDs,
> edge topology, and no unintended changes outside navigation flow.

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

### Prompt A: Analyze current namespace

> Use the LEAF skill in this repo. Inspect `leafgon/guides` from
> `https://www.leafgon.com/qmgraphql` and return a concise graph architecture
> summary plus risks before editing.

### Prompt B: Plan minimal SPA patch

> Propose a minimal patch for topic-based navigation in `leafgon/guides` using
> a `guide-nav` bottle and gated href routing. Show operation order and why each
> node/edge is needed.

### Prompt C: Apply and verify

> Apply the approved patch to `leafgon/guides`, then re-query and verify the
> exact postconditions. Report acknowledgements, changed UUIDs, and any risk.

## Troubleshooting

- `401`/`403`: token missing scope or account lacks namespace permission.
- Graph updates but UI unchanged: browser tab still on stale session, refresh.
- Navigation click does nothing: verify bottle name/path and gate wiring.
- Unexpected side effects: revert with a reviewed inverse patch and re-query.

## Security reminders

- Never paste raw token values into prompts, docs, or commits.
- Keep `LEAFGON_API_TOKEN` in env/secret manager only.
- Treat edits against `leafgon/guides` as live-state mutations.

