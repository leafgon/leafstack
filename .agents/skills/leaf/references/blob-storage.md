# Use leaf-server blob storage

Use this workflow for files stored through a namespace's wired
`leafelement(blob)` spelldef. A blob write is an external side effect and needs
explicit scope, a stable identity, suitable token permissions, and authoritative
verification.

## Blob element bottle contract

The browser spelldef **Test** trigger sends its input to `leafelement(blob)` as
a versioned Blob bottle. Send the bottle itself; an HTTP descriptor such as
`{:method "GET" :path "/api/v1/..."}` is not a Blob bottle and returns
`invalid_blob_bottle`.

File-backed writes use `ghostos.blob_store_bottle.v1` with `contentType`,
`contentLength`, `contentHash`, and `payloadRef`. Inline JSON is an alternate
payload mode on that same bottle: supply `inlineJson` instead of
`payloadRef`/`contentLength`/`contentHash`. The service derives JSON content
type, byte length, and hash. If `contentType` is supplied for inline JSON, it
must be `application/json`. A concise description is required when creating an
object. Inline JSON is limited to 64 KiB or the adapter's lower object limit;
the JSON value `null` is valid.

Create an inline JSON object by sending this bottle to the `storage` spelldef
Test trigger:

```clojure
{:schemaVersion "ghostos.blob_store_bottle.v1"
 :blobElementId "<blob-element-id>"
 :operation "create"
 :requestedObjectId "records"
 :description "Workflow records"
 :idempotencyKey "records-inline-create-001"
 :inlineJson {:summary {:pending 2 :obsolete true}
              :records []}}
```

The successful output is a `ghostos.blob_data_file.v1` metadata bottle. It
includes the object identity and derived metadata; it does not echo the JSON
document on store:

```clojure
{:schemaVersion "ghostos.blob_data_file.v1"
 :blobElementId "<blob-element-id>"
 :objectId "records"
 :contentType "application/json"
 :contentLength <derived-byte-length>
 :contentHash "sha256:<derived-hash>"
 :assetRevision 1}
```

Use `merge-json` for a revision-guarded partial update. Object fields merge
recursively, arrays replace whole arrays, and `null` removes an object key:

```clojure
{:schemaVersion "ghostos.blob_store_bottle.v1"
 :blobElementId "<blob-element-id>"
 :operation "merge-json"
 :requestedObjectId "records"
 :expectedAssetRevision 1
 :idempotencyKey "records-inline-update-001"
 :jsonMergePatch {:summary {:pending 1 :obsolete nil}}}
```

The update returns `ghostos.blob_data_file.v1` metadata at the next revision:

```clojure
{:schemaVersion "ghostos.blob_data_file.v1"
 :blobElementId "<blob-element-id>"
 :objectId "records"
 :contentType "application/json"
 :assetRevision 2}
```

For full replacement, use `operation "overwrite"` with `inlineJson` and the
current `expectedAssetRevision`.

Fetch metadata and the parsed document with
`ghostos.blob_fetch_bottle.v1` and `inlineJson true`:

```clojure
{:schemaVersion "ghostos.blob_fetch_bottle.v1"
 :blobElementId "<blob-element-id>"
 :objectId "records"
 :expectedAssetRevision 2
 :inlineJson true}
```

The success output is `ghostos.blob_data_file.v1` metadata plus the parsed
`inlineJson` value:

```clojure
{:schemaVersion "ghostos.blob_data_file.v1"
 :blobElementId "<blob-element-id>"
 :objectId "records"
 :contentType "application/json"
 :assetRevision 2
 :inlineJson {:summary {:pending 1}
              :records []}}
```

Omit `inlineJson` (or set it to `false`) for metadata only. The fetch bottle
also accepts optional `expectedAssetRevision` and `expectedContentHash` guards.

These are element bottles. Direct HTTP requests to leaf-server use HTTP
methods, paths, headers, and request bodies instead. See the
[Blob HTTP API reference](../../leaf-blob-api/references/blob-api.md) for those
examples. Do not pass an HTTP request descriptor into the spelldef Test input.

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
  length. For byte-for-byte retrieval evidence, first probe `HEAD`
  `/api/v1/blob-storage/objects/<domain>/<app>/<blobElement>/<objectId>:download`,
  then run `GET` on that same route and compare the downloaded file hash.
