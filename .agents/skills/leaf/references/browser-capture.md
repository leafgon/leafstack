# Capture the public Leafgon editor

Use this workflow when the requested artifact must show the graph as the deployed
Leafgon editor renders it, rather than a locally reconstructed visualization.

## Public route

The canonical public editor URL is:

```text
https://www.leafgon.com/editor/<domain-id>/<app-id>
```

Validate both identifiers before constructing the URL. Public browsing does not
authorize graph mutations, and a capture must not add API tokens, cookies, or
authorization headers unless the user separately requests and authorizes an
authenticated browser session.

## Capture

Use the bundled helper:

```sh
node .agents/skills/leaf/scripts/capture-leaf-editor.mjs \
  --domain breezyforest \
  --appid guides \
  --main \
  --output artifacts/breezyforest-guides.jpg
```

The helper opens the public route in a fresh temporary Chrome profile, waits on
wall-clock time for subscriptions and canvas rendering, captures JPEG directly
through the Chrome DevTools Protocol, and removes the profile. Override
`--wait-ms`, `--width`, or `--height` only when the graph demonstrably needs a
different render budget or viewport. Use `--chrome` when Chrome is installed in
a nonstandard location.

Pass `--spelldef <name>` to capture only one spell definition and its attached
graph. The helper reads the public namespace through `/qmgraphql`, finds the
unique `leafspelldef` whose decoded `spellname` matches exactly, follows incoming
lambda edges recursively through their source scopes, and includes each complete
undirected `leafdataedge` component encountered. It then fits those node UUIDs
inside the live React Flow viewport and crops the screenshot around their
rendered bounds while hiding every non-component node and edge. It fails instead
of falling back to a namespace screenshot
when the spelldef is missing, ambiguous, disconnected from rendered nodes, or
cannot be fitted.

Pass `--main` to capture the namespace's one runtime/main graph. The helper
excludes all `leafspelldef` catalogue nodes, every dataflow/configuration scope
transitively attached to a spelldef through incoming lambda edges, and every anchor source plus the
data/lambda-connected graph rooted at its anchor target. It then requires the
remaining nodes to form exactly one weak component across data and lambda
edges. It fails when the namespace is definition-only or contains multiple
candidate main graphs. `--main` and `--spelldef` are mutually exclusive.

Do not use Chrome's one-shot `--screenshot` mode for this page: it can capture
the loading spinner before the live graph subscription has rendered. Virtual
time is also insufficient for a websocket-backed canvas; wait in real time.

## Verify

1. Open the resulting image with an image viewer.
2. Confirm the loading spinner is absent and expected nodes or labels are visible.
3. For a spelldef capture, confirm only the named definition and its attached
   component are present. Report the exact URL, spelldef, component node count,
   viewport, wait time, output dimensions, and crop bounds.
   For a main capture, report the main node and edge counts instead of a
   spelldef name.
4. Treat the image as rendering evidence, not authoritative persistence proof.
   Use a fresh `/qmgraphql` read when graph state itself must be verified.
