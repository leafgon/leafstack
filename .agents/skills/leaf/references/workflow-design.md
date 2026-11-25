# Design LEAF workflows from spell contracts

## Start top-down

Use top-down design by default. Work with the domain expert in their own
terms. Ask what starts the workflow, what outcome they want, how they decide
which path to take, and what should happen in exceptional cases. Capture a
representative example for each path. Let these decisions drive port and node
selection later.

1. Sketch the workflow as named spell calls and decision points. Name each call
   for its outcome, such as `check-eligibility` or `request-review`.
2. For each call, record the intended namespace, spell name, expected input
   and output, and any side effects. For routed bottles, agree on the names
   and payload fields that callers and callees share.
3. Compose the calls and routes in a design sketch or local graph draft.
   Calls may reference spells that are still planned. Keep a list of
   unresolved calls with their intended namespace and contract. Mark the
   draft as incomplete until those calls resolve.
4. Reuse matching definitions and implement missing spells behind the agreed
   contracts. Where a local simulation needs a stand-in, give it the planned
   interface and label its canned behavior. Verify the real definition and
   replace any stand-in before marking the workflow ready to run or publishing
   it as an executable graph.
5. Run each spell case, then test the composed workflow through its entry
   point. Verify selected paths, unselected side effects, and final outputs
   with the intended GhostOS version and target spellbooks.

Use **middle-out** when an existing spell or service contract is the best
starting point. Build the input and output paths around it and check both
against the workflow outcome. Use **bottom-up** when a low-level capability is
uncertain. Validate the smallest runnable component first, give it a spell
contract, and then connect it to its callers. Return to the whole workflow
after either approach to confirm that the composition meets the domain rules.

## Compose calls and route bottles

Put each `leafspell` on its caller's data path. A local call resolves the name
in the current namespace. For a remote call, lambda-link a `leafgraph` to the
`leafspell`, set `graphaddrstr` to the provider namespace, and use the exported
`spellname` on the call. The live examples in `breezyforest/tests` include
`test-spell-casting` calling local `test-branching` and a separate
`leafgraph` with `graphaddrstr: "breezyforest/tests2"` linked to a call to
`test-remote-spell`. Verify the provider export and the caller's access.
See [namespace resolution and import ownership](data-workflows.md#resolve-and-invoke-spells-across-graph-namespaces).

For an exclusive decision, classify the input once into a named bottle. Give
each branch a `leafgateflow` whose `keyname` matches that bottle name and whose
`notgatetoggle` is false. Put the branch spell after its gate. Decide explicitly
whether an unmatched input should be dropped, reported, or classified into a
fallback route. Test each route, the unmatched case, and consecutive inputs
that select different branches.

In `test-branching`, the input is already tagged. Gates match `branch1` and
`branch2`, each feeds a `leaflisp`, and both paths feed a `leafchronosflow`
before a single outflow. The anchored comment describes forwarding selected
bottles asynchronously as they arrive. If you adopt that shape, verify
delivery and ordering under the selected runtime. For a selected branch that
feeds a later linear stage, also see the
[separate branch outflow pattern](data-workflows.md#route-and-rejoin-events).

## Record the spell contract and examples

Anchor a dedicated `leaflisp` from each `leafspelldef` using a
`leafanchoredge` directed from the definition to the note. Keep the note
disconnected from executable data and lambda components. Store a
JSON-shaped map in `leaf.logic.args.lispexpression` using LEAFlisp map syntax.
The `test-spell-casting` and `test-branching` notes in `breezyforest/tests`
use `schemaVersion`, `spell.name`, `spell.description`, and `spell.cases`.
Each case has an `id`, an `input`, and an expected `output`. For bottled
values, preserve the full shape in the examples.

```clojure
{
  :schemaVersion 1
  :spell {
    :name "test-branching"
    :description "Forward a bottle along the route named by its _bname."
    :cases [
      {
        :id "branch1-test"
        :input  {:_bname "branch1" :_content {:hello "branch1"} :_label {}}
        :output {:_bname "branch1" :_content {:hello "branch1"} :_label {}}
      }
      {
        :id "branch2-test"
        :input  {:_bname "branch2" :_content {:hello "branch2"} :_label {}}
        :output {:_bname "branch2" :_content {:hello "branch2"} :_label {}}
      }
    ]
  }
}
```

Keep examples free of credentials and sensitive payloads. The anchor keeps
the note out of runtime execution. Use its inputs and expected outputs to
drive [spell tests](spelldef-test-harness.md) and update the note when the
contract changes.
