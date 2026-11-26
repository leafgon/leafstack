# Leaf-server Blob API contract

Use these public HTTP contracts. Treat an observed schema conflict as a reason
to stop and verify the deployed contract, not to guess a new payload.

## Host, auth, and failures

- Blob routes require first-party-host access and authentication.
- Route authorization combines token scope and graph/page permission.
- A failure uses `ghostos.blob_failure.v1` with `code`, `retryable`,
  `safeMessage`, and `correlationId` fields.

## Runtime file refs

Create one with `POST /api/v1/runtime-file-refs` and schema
`leafgon.runtime_file_ref_create.v1`:

```json
{
  "schemaVersion": "leafgon.runtime_file_ref_create.v1",
  "graphDomainId": "<domain>",
  "graphAppId": "<app>",
  "blobElementId": "<blob-element>",
  "fileName": "asset.png",
  "contentType": "image/png",
  "contentLength": 123,
  "contentHash": "sha256:<64-hex>",
  "payloadBase64": "<base64>",
  "correlationId": "<id>"
}
```

The response includes a short-lived `ref` and `expiresAt`. Do not persist or
log the ref. Resolve when necessary with
`POST /api/v1/blob-storage/runtime-file-refs/<ref>:resolve`, providing graph
identity, blob element identity, content hash, and correlation ID.

`<ref>:resolve` is a `POST` contract route; it does not support `HEAD`.

## Object inventory and CRUD

- Paginated inventory: `GET /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>`
  with `limit` (1–100) and optional opaque `cursor`; response schema
  `ghostos.blob_data_file_page.v1`.
- Object operation: `PUT|GET|HEAD|DELETE
  /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>/<objectId>`.
- Raw object bytes: `GET|HEAD
  /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>/<objectId>:download`.
  Use `HEAD` for header-only verification and `GET` when bytes are required.
- `PUT` accepts `operation` (`create` or `overwrite`), content type, length,
  hash, a runtime-file payload reference, description, and correlation ID.
- Every `create` request must include a concise, non-empty `description`. Do
  not create an object with placeholder text or omit this field; it supplies
  the enriched `objectMetadata.description` used to identify the object.
- Require `expectedAssetRevision` for overwrite and safe deletion.

Minimal creation fields include:

```json
{
  "operation": "create",
  "contentType": "text/html",
  "contentLength": 123,
  "contentHash": "sha256:<64-hex>",
  "payloadRef": {"kind": "temp-file", "ref": "<opaque>"},
  "description": "Breezyforest Guides introduction page",
  "correlationId": "<id>"
}
```

The `payloadRef` above comes from the `<ref>:resolve` response.

## Inline JSON through the HTTP API

These examples are direct HTTP requests to leaf-server. They are distinct from
the versioned input bottles sent to a `leafelement(blob)` through a spelldef
Test trigger. For element bottle inputs and outputs, see the
[Blob element bottle contract](../../leaf/references/blob-storage.md#blob-element-bottle-contract).

Create inline JSON with `PUT`. The server derives `contentType`,
`contentLength`, and `contentHash`; do not include those fields or `payloadRef`
with `inlineJson`:

```http
PUT /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>/records
Authorization: Bearer <token>
Idempotency-Key: records-inline-create-001
Content-Type: application/json

{
  "operation": "create",
  "description": "Workflow records",
  "correlationId": "records-inline-create-001",
  "inlineJson": {"summary": {"pending": 2, "obsolete": true}, "records": []}
}
```

For a partial update, send `operation: "merge-json"`, the current
`expectedAssetRevision`, and an object-valued `jsonMergePatch`. Omitted fields
remain unchanged, nested objects merge recursively, arrays replace, and `null`
removes a field:

```http
PUT /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>/records
Authorization: Bearer <token>
Idempotency-Key: records-inline-update-001
Content-Type: application/json

{
  "operation": "merge-json",
  "expectedAssetRevision": 1,
  "correlationId": "records-inline-update-001",
  "jsonMergePatch": {"summary": {"pending": 1, "obsolete": null}}
}
```

Fetch parsed JSON by adding `?inlineJson=true` to the object GET. The response
contains the normal `ghostos.blob_data_file.v1` metadata and an `inlineJson`
member:

```http
GET /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>/records?inlineJson=true
Authorization: Bearer <token>
```

Inline JSON is limited to 64 KiB or the adapter's lower object limit. For
revision-guarded replacement use `operation: "overwrite"` and
`expectedAssetRevision`. These HTTP requests are not valid `leafelement(blob)`
bottle inputs; send the versioned `ghostos.blob_store_bottle.v1` or
`ghostos.blob_fetch_bottle.v1` shape when exercising the element.

## Contract list and enrichment

Call `POST /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>:list` with
schema `ghostos.blob_list_bottle.v1`:

```json
{
  "schemaVersion": "ghostos.blob_list_bottle.v1",
  "objectIds": ["object-a", "object-b"],
  "correlationId": "<id>"
}
```

`objectIds` is optional and, when present, must contain unique safe IDs. The
`ghostos.blob_list_file.v1` response can enrich items with `assetUrls` and
`objectMetadata` when reassessment context is available. After `create`, query
this contract and require `objectMetadata.description` to equal the submitted
description before reporting the object as fully verified.

`<blobElement>:list` is a `POST` contract route; it does not support `HEAD`.

## Common diagnostics

- `invalid_blob_bottle`: request schema or shape mismatch.
- `invalid_payload_ref`: missing, malformed, expired, or consumed ref.
- `asset_revision_mismatch`: stale or absent revision guard.
- `missing_object`: object absent during read, overwrite, or deletion.
- `missing_execution_context`: GhostOS invocation lacks required context;
  compare direct API behavior before editing graph topology.
