# Use leaf-server blob storage

Use this workflow for files stored through a namespace's wired
`leafelement(blob)` spelldef. A blob write is an external side effect and needs
explicit scope, a stable identity, suitable token permissions, and authoritative
verification.

## Store and verify

Use the bundled helper:

```sh
node .agents/skills/leaf/scripts/leaf-blob-storage.mjs store \
  --domain breezyforest \
  --appid guides \
  --spelldef storage \
  --file artifacts/breezyforest-guides-main.jpg \
  --description "Breezyforest Guides main canvas capture" \
  --token-env LEAFGON_BREEZYFOREST_TOKEN
```

The token needs `blob-storage:write`; write scope implies read permission. The
helper never prints the token. It:

1. Queries `/qmgraphql` and resolves the unique named `leafspelldef`.
2. Follows data edges and recursive incoming lambda attachments to find exactly
   one wired `leafelement(blob)` in that definition scope.
3. Hashes the file, validates its supported media type and size, and derives the
   GhostOS-compatible deterministic object ID.
4. Requires a concise, non-empty description for
   `objectMetadata.description` and rejects an existing deterministic object
   when its description does not match.
5. Returns success without writing when authoritative metadata already matches.
6. Otherwise creates a short-lived `leafgon.runtime_file_ref.v1`, then stores it
   with the versioned leaf-server blob API and a stable idempotency key.
7. Fetches the object metadata independently and requires the object ID, content
   type, length, hash, description, and revision to match.

Use `--dry-run` to resolve topology and compute identity without creating a
runtime file reference or blob. Pass `--content-type` only when extension-based
inference is insufficient. Supported types are constrained by the deployed blob
contract; the helper rejects unknown types rather than sending them.

## Safety and reporting

- Treat the returned object ID as the durable reference; a runtime-file-ref is
  short-lived and must not be persisted.
- Never create a blob object without a meaningful `description`; do not use a
  filename-only placeholder when a clearer human-readable description exists.
- Do not retry a different body under the same object ID or idempotency key.
- Do not log tokens, runtime refs, payload base64, signed locations, or raw
  provider failures.
- Report graph address, spelldef, blob element UUID, object ID, content metadata,
  asset revision, whether a write occurred, and verification status.
- Metadata verification proves the storage service accepted the exact hash and
  length. Download and compare bytes separately when a task explicitly requires
  byte-for-byte retrieval evidence.
