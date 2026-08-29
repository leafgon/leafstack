#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: blob-api-request.sh <METHOD> <PATH> [JSON_FILE|-]

Required: LEAF_BLOB_API_BASE_URL, LEAF_BLOB_API_TOKEN
Optional: LEAF_BLOB_API_TIMEOUT_SECONDS (default 30)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then usage; exit 0; fi
if [[ $# -lt 2 || $# -gt 3 ]]; then usage >&2; exit 2; fi
if [[ -z "${LEAF_BLOB_API_BASE_URL:-}" || -z "${LEAF_BLOB_API_TOKEN:-}" ]]; then
  echo "error: LEAF_BLOB_API_BASE_URL and LEAF_BLOB_API_TOKEN are required" >&2
  exit 2
fi

method="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
case "${method}" in GET|HEAD|POST|PUT|DELETE) ;; *) echo "error: unsupported method" >&2; exit 2 ;; esac
request_path="$2"
json_file="${3:-}"
timeout_seconds="${LEAF_BLOB_API_TIMEOUT_SECONDS:-30}"
[[ "${timeout_seconds}" =~ ^[1-9][0-9]{0,2}$ ]] || { echo "error: invalid timeout" >&2; exit 2; }
[[ "${request_path}" == /api/v1/* && "${request_path}" != *$'\n'* && "${request_path}" != *$'\r'* ]] || {
  echo "error: path must be a safe /api/v1 route" >&2; exit 2;
}
if [[ -n "${json_file}" && "${json_file}" != "-" && ! -f "${json_file}" ]]; then
  echo "error: JSON file not found: ${json_file}" >&2; exit 2
fi

base_url="${LEAF_BLOB_API_BASE_URL%/}"
if [[ ! "${base_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ && ! "${base_url}" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then
  echo "error: base URL must be an HTTPS origin (HTTP is loopback-only)" >&2; exit 2
fi

tmp_headers="$(mktemp)"
tmp_body="$(mktemp)"
cleanup() { rm -f "${tmp_headers}" "${tmp_body}"; }
trap cleanup EXIT
request_id="codex-blob-$(date +%s)-$$"

curl_args=(--silent --show-error --request "${method}" --max-time "${timeout_seconds}"
  --header "Authorization: Bearer ${LEAF_BLOB_API_TOKEN}" --header "Accept: application/json"
  --header "X-Request-Id: ${request_id}" --dump-header "${tmp_headers}"
  --output "${tmp_body}" "${base_url}${request_path}")
if [[ -n "${json_file}" ]]; then
  curl_args+=(--header "Content-Type: application/json")
  [[ "${json_file}" == "-" ]] && curl_args+=(--data-binary @-) || curl_args+=(--data-binary "@${json_file}")
fi
curl "${curl_args[@]}"

status_code="$(awk 'toupper($1) ~ /^HTTP\// { code = $2 } END { print code + 0 }' "${tmp_headers}")"
printf 'HTTP %s\nX-Request-Id: %s\n' "${status_code}" "${request_id}"
if command -v jq >/dev/null 2>&1; then jq . "${tmp_body}" 2>/dev/null || sed -n '1,200p' "${tmp_body}"; else sed -n '1,200p' "${tmp_body}"; fi
(( status_code < 400 ))
