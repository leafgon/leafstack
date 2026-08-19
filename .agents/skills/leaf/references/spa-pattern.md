# Single-Page Applications in LEAF

## Contents

- Scope and evidence
- Architecture
- Delivery strategies
- Graph topology
- HTML document contract
- Navigation and homing
- Assets and hosted application shells
- Authoring workflow
- Validation and release
- Failure diagnosis
- Security and accessibility

## Scope and evidence

Use this pattern for a browser-rendered application whose user interface is
delivered through `leafelement(html)`. It covers self-contained HTML documents
and small LEAF loader shells that fetch a separately hosted frontend.

The pattern is generalized from the production `lealtd/www` graph, the
Piper-style iframe renderer, and recovery of `breezyforest/terms`. Those are
implementation evidence, not permanent protocol guarantees. Reinspect the
selected GhostOS release, current leaf-server schema, and deployed UI host when
their versions change. Read [leaf-server-api.md](leaf-server-api.md),
[graph-runtime.md](graph-runtime.md), [leaflisp.md](leaflisp.md), and
[leafelements.md](leafelements.md) before authoring the graph.

## Architecture

A LEAF SPA normally has three responsibilities:

1. A definition component stores the HTML source and exposes it as a named
   spell through `leafelement(html)` and `leafspelldef`.
2. A main component invokes that spell when the graph page opens and sends its
   visual descriptor to the host's display spell.
3. The HTML document owns application layout, client-side navigation, assets,
   and application-specific JavaScript inside the host iframe.

Keep the LEAF shell small. Put graph composition and host integration in LEAF;
put browser presentation behavior in the document. Do not rely on the outer
host DOM, CSS, globals, or event handlers as application APIs.

## Delivery strategies

Choose one of these strategies deliberately:

| Strategy | Best fit | Advantages | Costs |
| --- | --- | --- | --- |
| Inline document | Legal pages, documentation, small tools, or an application with few assets | Self-contained graph, one deployment unit, simple rollback | Larger node payload, graph mutation for every UI release, stricter payload limits |
| Hosted loader shell | Larger or independently released frontend | Small stable graph, conventional asset hosting and versioned releases | CORS, cache, integrity, availability, and two-layer rollback concerns |

A hybrid can inline the critical shell, logo, and error state while loading
versioned CSS or JavaScript. Avoid an unversioned mixture whose graph and assets
can become incompatible.

## Graph topology

Use one definition component and, when the namespace should render itself, one
main component. Names below are illustrative.

```text
definition component

leaflisp({:html "..."}) --lambda--> leafelement(html) --lambda--> leafspelldef(app)
           |                          ^
           +--data--> source outport  |
                                      |
leaflisp(template input) --data-------+
                                      |
                                      +--data--> spell outport

main component

leafinflowport --data--> leafspell(app) --data--> leafgateflow(screenio)
                                                 --data--> leafspell(show)
leafgraph(stdio) -----------------------lambda------------> leafspell(show)
```

The HTML source LEAFlisp commonly evaluates to:

```clojure
{:html "<!doctype html><html>...</html>"}
```

The template input commonly supplies the bottle expected by the HTML element:

```clojure
[{:_bname "html" :_content {} :_label {:tag "0"}}]
```

Treat those shapes as selected-runtime contracts and verify them against an
authoritative working graph. Generate and JSON-escape the HTML string; do not
hand-escape a large document directly into an encoded node payload.

Apply all normal graph invariants, especially these:

- The HTML-source `leaflisp` that lambda-attaches to `leafelement(html)` must
  also data-connect to a dedicated `leafoutflowport` in its own source
  component. Do not reuse the HTML element's spell outport for this purpose.
- A lambda edge connects separate dataflow components. Its source component
  and target component must not share a `leafoutflowport`; the dedicated
  source outport and the element's spell outport preserve that isolation.
- A namespace has at most one unanchored main component. Attach reusable
  definitions to `leafspelldef`; do not leave accidental disconnected runtime
  components.
- Preserve the host's screen/display spell contract instead of inventing a
  direct UI side channel.
- Allow leaf-server to materialize server-owned fields such as `leaf.object`;
  re-query and verify them after mutation.

The public route is deployment-specific. A common route shape is
`/nav/<domain-id>/<app-id>`, while the graph address remains
`<domain-id>/<app-id>`. Discover the actual route rather than assuming it.

## HTML document contract

The UI host renders the HTML descriptor in a sandboxed iframe and may inject a
message bridge plus a loaded callback into the document. The loaded callback is
not cosmetic: a Piper-style host keeps the iframe hidden behind a spinner until
it receives the iframe `loaded` message.

Use a complete, valid document and preserve a plain literal `<body>` wrapper:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Application title</title>
  </head>
  <body>
    <div id="page-top" aria-hidden="true"></div>
    <div id="app-root"></div>
  </body>
</html>
```

For the current Piper iframe host, minify the generated document to one
physical line before storing it. Its bridge injector matches the complete
`<body>...</body>` region with a JavaScript regular expression whose dot does
not span line breaks. Any newline between the opening and closing body tags
prevents injection of the `doiframeio('loaded')` callback, leaving the iframe
transparent behind the loading spinner even though the HTML itself is valid.
Compare against the deployed host when this implementation changes; do not
generalize the one-line constraint into an HTML protocol guarantee.

Do not put an ID, class, or other attribute directly on the source `<body>`
until the deployed host contract proves that it is safe. A known Piper
implementation locates an exact `<body> ... </body>` boundary before injecting
its bridge. Changing it to `<body id="page-top">` prevented injection and left
the application permanently loading. Put targets and application wrappers
inside the body instead. If a hosted document needs body attributes, copy them
onto `document.body` after the host has instrumented the shell.

Host implementations and revisions may use different parsing logic. Test the
exact generated document against the deployed host; an HTTP success and a
valid graph do not prove that the iframe became visible.

Application code should be idempotent because a host may rebuild or re-evaluate
the descriptor. Guard one-time startup, event registration, and dynamically
inserted scripts:

```js
if (!window.__leafAppStarted) {
  window.__leafAppStarted = true;
  // Initialize the application once.
}
```

## Navigation and homing

For a fixed logo or home control, use an inner target rather than annotating the
body:

```html
<a class="brand" href="#page-top" aria-label="Back to top">
  <img src="data:image/png;base64,..." alt="Company name">
</a>
```

Keep the brand fixed with ordinary document CSS:

```css
.brand {
  position: fixed;
  inset: 1rem auto auto 1rem;
  z-index: 1000;
}
```

An outer LEAF host can also observe anchor clicks. Isolate same-document hash
navigation inside the iframe with a capture-phase listener:

```js
document.addEventListener('click', function (event) {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;

  const hash = link.getAttribute('href');
  if (!hash || hash === '#') return;

  const id = decodeURIComponent(hash.slice(1));
  const target = document.getElementById(id) || document.getElementsByName(id)[0];
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  target.scrollIntoView({behavior: 'smooth', block: 'start'});
}, true);
```

Register the listener once. Prefer scrolling without rewriting history unless
the application explicitly requires hash state. Account for a fixed header
with `scroll-margin-top` on targets or a measured scroll offset.

### Sandboxed inter-page navigation

In the current hosted iframe model, ordinary document link clicks may not
navigate the outer application URL directly. For inter-page navigation, emit
an explicit LEAF event from the document and let graph flow perform navigation.

Typical shape:

```text
html document click -> doelementio and/or doscreenio
-> html element output (elementio bottle)
-> gate(elementio) -> transform -> gate(href-request) -> leafelement(href)
```

Inside HTML, intercept click and emit a bottled intent:

```js
document.addEventListener('click', function (event) {
  const target = event.target.closest('[data-guide-topic]');
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const topic = target.getAttribute('data-guide-topic') || 'intro';
  const navBottle = {
    _bname: 'guide-nav',
    _content: {
      topic,
      url: '/editor/breezyforest/guides?topic=' + encodeURIComponent(topic)
    },
    _label: {source: 'breezyforest/guides'}
  };

  if (typeof doelementio === 'function') doelementio(navBottle);
  if (typeof doscreenio === 'function') doscreenio(navBottle);
}, true);
```

Treat this as host-integration behavior, not browser default navigation. Keep
event bottle names stable and gate by name before any side-effecting
navigation element.

## Assets and hosted application shells

Small immutable images can be data URIs. They remove a network dependency but
increase graph size by roughly the base64 overhead and make asset changes graph
changes. Compress and size them before encoding, keep meaningful `alt` text,
and measure the final encoded graph payload.

For hosted assets, use HTTPS and a versioned release path. A general loader
shell should:

1. Fetch the versioned HTML with the intended credentials policy. Public
   assets normally use `credentials: 'omit'`.
2. Fail into a visible, accessible local error state.
3. Parse the response with `DOMParser` rather than concatenating untrusted
   markup.
4. Resolve relative `src` and `href` values against the release base URL.
5. Import approved head and body content without replacing the instrumented
   shell document.
6. Load scripts in a deterministic order and only once.
7. Copy approved body attributes after shell instrumentation if required.
8. Expose or record the loaded release version for diagnosis.

The asset origin must permit the iframe origin through CORS. Pin immutable
release URLs or integrity metadata where practical; define how the graph shell
and hosted release roll back together. Never fetch executable code from a
mutable URL merely for convenience.

## Authoring workflow

1. Query the authoritative graph and decode it with the selected latest or
   pinned GhostOS npm release.
2. Inspect a known-good SPA in the same deployed host when establishing a new
   integration. Compare topology and decoded fields, not UUIDs or coordinates.
3. Choose inline or hosted delivery and write down the version and rollback
   boundary.
4. Build the complete HTML as a source artifact or generator input. Escape it
   programmatically into the LEAFlisp expression.
5. Validate HTML IDs, internal links, scripts, asset URLs, and absence of
   secrets before touching the graph.
6. Author the smallest graph change and inspect all data, lambda, and anchor
   components.
7. Plan mutations, review the exact domain/app and operation set, then apply
   them through `/qmgraphql` only with authority for that environment.
8. Re-query and compare node IDs, decoded source payloads, materialized fields,
   edges, outports, and component shape.
9. Open the deployed route in the actual host and test loading, navigation,
   scrolling, responsive layout, keyboard use, and failure states.

Prefer replacing the existing source node over adding parallel definitions or
main components. Keep a recoverable copy of the previous decoded source and
edge topology for rollback, without storing credentials or sensitive content.

## Validation and release

Use layered validation:

- Source: lint or parse generated HTML, ensure IDs are unique, resolve every
  internal anchor, and syntax-check extracted JavaScript.
- Host boundary: verify the exact body wrapper and simulate the current host's
  bridge injection or loaded-message lifecycle when its implementation is
  available. For the current Piper host, also reject any line break in the
  generated document and require the injector regex to match.
- Graph: run `inspect-leaf-graph.mjs`; confirm one intended main component,
  spell attachment, valid edge planes, and lambda/outport isolation.
- Runtime: evaluate focused LEAFlisp with the selected GhostOS npm release and
  confirm the HTML descriptor contract.
- Server: reject GraphQL errors or unexpected IDs, then authoritatively re-query
  every mutation.
- Browser: confirm the spinner clears, content appears, the console has no
  startup error, assets load, and interactions remain inside the iframe.
- Release: test the previous version's rollback path and document any cache
  invalidation needed for hosted assets.

Record the GhostOS version, graph address, server environment, mutation
acknowledgements, and browser-host version when known. Redact tokens and raw
authorization data.

## Failure diagnosis

| Symptom | Likely boundary | Checks |
| --- | --- | --- |
| Spinner never clears | Host could not instrument the document or receive `loaded` | Restore literal `<body>`, inspect generated source, verify bridge insertion and iframe messages |
| Graph exists but nothing renders | Main/display topology or host descriptor mismatch | Inspect components, screen gate, display spell lambda, and decoded HTML output |
| Lambda validation fails or execution is ambiguous | Source and target dataflow components were joined | Find shared outports and remove the cross-component data connection |
| Logo click navigates the outer app or does nothing | Hash event escaped the iframe or target is absent | Use an inner target and one capture-phase handler; inspect duplicate IDs/listeners |
| Hosted shell is blank | Fetch, CORS, URL rewriting, or script order failed | Show the local error state; inspect network response, resolved asset URLs, and startup guard |
| Update produces duplicate behavior | Initialization or listeners ran more than once | Add an idempotent global guard and remove duplicate dynamic assets |
| Works locally but not in production | Host, sandbox, CSP, cache, or release version differs | Compare deployed versions and policies; test the exact public route |

Diagnose the earliest failed boundary in order: source generation, graph
topology, LEAFlisp evaluation, descriptor production, host instrumentation,
iframe startup, assets, then application behavior.

## Security and accessibility

- Never embed API tokens, cookies, authorization headers, private signed URLs,
  or environment dumps in graph HTML.
- Treat HTML, Markdown, URL, and hosted release inputs as untrusted unless they
  are controlled build artifacts. Sanitize dynamic content and avoid arbitrary
  remote scripts.
- Do not weaken the iframe sandbox or request navigation, popup, media, or form
  permissions without a reviewed requirement.
- Validate message origin and message shape when adding application-specific
  `postMessage` handling. Do not copy a wildcard legacy bridge into new code as
  an application security model.
- Use `rel="noopener noreferrer"` for external links opened in a new tab.
- Provide a document title, language, landmarks, visible keyboard focus,
  semantic headings, useful image alternatives, and reduced-motion behavior.
- Ensure a fixed logo does not cover content at narrow widths and that the home
  action is available by keyboard as well as pointer.
