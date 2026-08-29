#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: blob-contract-list.sh <GRAPH_DOMAIN> <GRAPH_APP> <BLOB_ELEMENT> [OBJECT_ID...]"; exit 0
fi
if [[ $# -lt 3 ]]; then echo "error: domain, app, and blob element are required" >&2; exit 2; fi

graph_domain="$1"; graph_app="$2"; blob_element="$3"; shift 3
object_ids=("$@")
safe_segment_re='^[A-Za-z0-9._~-]+$'
for segment in "${graph_domain}" "${graph_app}" "${blob_element}" "${object_ids[@]:-}"; do
  [[ -z "${segment}" || "${segment}" =~ ${safe_segment_re} ]] || { echo "error: unsafe path segment" >&2; exit 2; }
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
payload_file="$(mktemp)"
cleanup() { rm -f "${payload_file}"; }
trap cleanup EXIT
correlation_id="codex-blob-list-$(date +%s)-$$"

{
  printf '{\n  "schemaVersion": "ghostos.blob_list_bottle.v1",\n  "correlationId": "%s"' "${correlation_id}"
  if (( ${#object_ids[@]} > 0 )); then
    printf ',\n  "objectIds": ['
    for idx in "${!object_ids[@]}"; do (( idx > 0 )) && printf ', '; printf '"%s"' "${object_ids[$idx]}"; done
    printf ']'
  fi
  printf '\n}\n'
} >"${payload_file}"

bash "${script_dir}/blob-api-request.sh" POST \
  "/api/v1/blob-storage/objects/${graph_domain}/${graph_app}/${blob_element}:list" "${payload_file}"
