#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  blob-download.sh HEAD <GRAPH_DOMAIN> <GRAPH_APP> <BLOB_ELEMENT> <OBJECT_ID>
  blob-download.sh GET  <GRAPH_DOMAIN> <GRAPH_APP> <BLOB_ELEMENT> <OBJECT_ID> <OUTPUT_FILE> [EXPECTED_HASH]

Required env: LEAF_BLOB_API_BASE_URL, LEAF_BLOB_API_TOKEN
Optional env: LEAF_BLOB_API_TIMEOUT_SECONDS (default 30)

EXPECTED_HASH format: sha256:<64-hex>
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then usage; exit 0; fi
if [[ $# -lt 5 || $# -gt 7 ]]; then usage >&2; exit 2; fi
if [[ -z "${LEAF_BLOB_API_BASE_URL:-}" || -z "${LEAF_BLOB_API_TOKEN:-}" ]]; then
  echo "error: LEAF_BLOB_API_BASE_URL and LEAF_BLOB_API_TOKEN are required" >&2
  exit 2
fi

method="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
graph_domain="$2"
graph_app="$3"
blob_element="$4"
object_id="$5"
output_file="${6:-}"
expected_hash="${7:-}"

case "${method}" in HEAD|GET) ;; *) echo "error: method must be HEAD or GET" >&2; exit 2 ;; esac
[[ "${method}" == "HEAD" || -n "${output_file}" ]] || {
  echo "error: GET requires OUTPUT_FILE" >&2
  exit 2
}
[[ -z "${expected_hash}" || "${method}" == "GET" ]] || {
  echo "error: EXPECTED_HASH is only valid for GET" >&2
  exit 2
}
[[ -z "${expected_hash}" || "${expected_hash}" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "error: EXPECTED_HASH must match sha256:<64-hex>" >&2
  exit 2
}

safe_segment_re='^[A-Za-z0-9._~-]+$'
for segment in "${graph_domain}" "${graph_app}" "${blob_element}" "${object_id}"; do
  [[ "${segment}" =~ ${safe_segment_re} ]] || { echo "error: unsafe path segment" >&2; exit 2; }
done

timeout_seconds="${LEAF_BLOB_API_TIMEOUT_SECONDS:-30}"
[[ "${timeout_seconds}" =~ ^[1-9][0-9]{0,2}$ ]] || { echo "error: invalid timeout" >&2; exit 2; }

base_url="${LEAF_BLOB_API_BASE_URL%/}"
if [[ ! "${base_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ && ! "${base_url}" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then
  echo "error: base URL must be an HTTPS origin (HTTP is loopback-only)" >&2
  exit 2
fi

request_path="/api/v1/blob-storage/objects/${graph_domain}/${graph_app}/${blob_element}/${object_id}:download"
tmp_headers="$(mktemp)"
cleanup() { rm -f "${tmp_headers}"; }
trap cleanup EXIT
request_id="codex-blob-download-$(date +%s)-$$"

curl_args=(--silent --show-error --request "${method}" --max-time "${timeout_seconds}"
  --header "Authorization: Bearer ${LEAF_BLOB_API_TOKEN}" --header "X-Request-Id: ${request_id}"
  --dump-header "${tmp_headers}")
if [[ "${method}" == "HEAD" ]]; then
  curl_args+=(--output /dev/null)
else
  curl_args+=(--output "${output_file}")
fi
curl "${curl_args[@]}" "${base_url}${request_path}"

status_code="$(awk 'toupper($1) ~ /^HTTP\// { code = $2 } END { print code + 0 }' "${tmp_headers}")"
content_type="$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {v=$0; sub(/^[^:]*:[[:space:]]*/, "", v); sub(/[\r\n]+$/, "", v); print v; exit}' "${tmp_headers}")"
content_length="$(awk 'BEGIN{IGNORECASE=1} /^Content-Length:/ {v=$0; sub(/^[^:]*:[[:space:]]*/, "", v); sub(/[\r\n]+$/, "", v); print v; exit}' "${tmp_headers}")"

printf 'HTTP %s\nX-Request-Id: %s\n' "${status_code}" "${request_id}"
[[ -n "${content_type}" ]] && printf 'Content-Type: %s\n' "${content_type}"
[[ -n "${content_length}" ]] && printf 'Content-Length: %s\n' "${content_length}"

(( status_code < 400 )) || exit 1

if [[ "${method}" == "GET" ]]; then
  if command -v shasum >/dev/null 2>&1; then
    actual_hash="sha256:$(shasum -a 256 "${output_file}" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual_hash="sha256:$(sha256sum "${output_file}" | awk '{print $1}')"
  else
    actual_hash=""
  fi
  if [[ -n "${expected_hash}" && -z "${actual_hash}" ]]; then
    echo "error: expected hash provided but no SHA-256 tool is available" >&2
    exit 1
  fi
  [[ -n "${actual_hash}" ]] && printf 'Downloaded-Hash: %s\n' "${actual_hash}"
  if [[ -n "${expected_hash}" && -n "${actual_hash}" && "${actual_hash}" != "${expected_hash}" ]]; then
    echo "error: downloaded hash mismatch" >&2
    exit 1
  fi
fi
