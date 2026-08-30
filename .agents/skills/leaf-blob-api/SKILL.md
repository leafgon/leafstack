---
name: leaf-blob-api
description: Operate and troubleshoot public leaf-server Blob API flows for runtime-file refs, object CRUD, contract listing, and enrichment verification.
---

# LEAF Blob API Operator

Use this skill for direct Blob API operations against leaf-server: storing files
through runtime refs, listing blob objects, verifying `assetUrls` or
`objectMetadata` enrichment, and diagnosing Blob contract failures.

## Operating contract

- Follow repository `AGENTS.md` instructions before any call.
- Read [references/blob-api.md](references/blob-api.md) before choosing a route,
  method, or payload.
- Keep credentials in environment variables only; never print token values.
- Prefer read-only `GET` and `HEAD` probes. Mutate only when explicitly requested.
- Keep payloads minimal and schema-versioned.
- Require every blob-object `create` request to include a concise, non-empty
  `description`; verify it through `objectMetadata.description` after creation.
- Record the request path, body-file path, HTTP status, and request ID; never
  record secret-bearing payloads.

## Inputs

- `LEAF_BLOB_API_BASE_URL`, for example `https://www.leafgon.com`
- `LEAF_BLOB_API_TOKEN`, a Bearer token with suitable Blob API access
- `graphDomainId`, `graphAppId`, and `blobElementId`
- Object IDs or runtime refs required by the selected operation
- Optional `LEAF_BLOB_API_TIMEOUT_SECONDS` (default `30`)

## Workflow

1. Inspect the working tree and applicable repository instructions.
2. Start with the narrowest read-only request that can answer the question.
3. For upload, create a runtime ref and then `PUT` the object with an explicit
   `create` or revision-guarded `overwrite` operation. A `create` body must
   include a meaningful `description` suitable for `objectMetadata.description`.
4. Verify mutations independently with `GET` or `HEAD`.
5. For list diagnostics, compare the paginated `GET` inventory with the `:list`
   contract response and its enrichment fields. After creation, require the
   returned `objectMetadata.description` to exactly match the submitted value.
6. If GhostOS reports `missing_execution_context`, compare the direct API
   response before changing graph topology.

## Helpers

Generic authenticated request:

```bash
bash .agents/skills/leaf-blob-api/scripts/blob-api-request.sh GET \
  "/api/v1/blob-storage/objects/<domain>/<app>/<blobElement>?limit=20"
```

Contract list request:

```bash
bash .agents/skills/leaf-blob-api/scripts/blob-contract-list.sh \
  <domain> <app> <blobElement> [objectId...]
```

Validate after editing:

```bash
bash .agents/skills/leaf-blob-api/scripts/validate-skill.sh
```

Stop for direction if authentication or host validation repeatedly fails, a
production mutation was not explicitly requested, or the observed response
conflicts with the documented public contract.
