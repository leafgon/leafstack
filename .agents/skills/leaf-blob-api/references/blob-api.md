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

## Object inventory and CRUD

- Paginated inventory: `GET /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>`
  with `limit` (1–100) and optional opaque `cursor`; response schema
  `ghostos.blob_data_file_page.v1`.
- Object operation: `PUT|GET|HEAD|DELETE
  /api/v1/blob-storage/objects/<domain>/<app>/<blobElement>/<objectId>`.
- `PUT` accepts `operation` (`create` or `overwrite`), content type, length,
  hash, a runtime-file payload reference, and correlation ID.
- Require `expectedAssetRevision` for overwrite and safe deletion.

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
`objectMetadata` when reassessment context is available.

## Common diagnostics

- `invalid_blob_bottle`: request schema or shape mismatch.
- `invalid_payload_ref`: missing, malformed, expired, or consumed ref.
- `asset_revision_mismatch`: stale or absent revision guard.
- `missing_object`: object absent during read, overwrite, or deletion.
- `missing_execution_context`: GhostOS invocation lacks required context;
  compare direct API behavior before editing graph topology.
