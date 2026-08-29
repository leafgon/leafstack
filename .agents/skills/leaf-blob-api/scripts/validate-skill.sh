#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "${script_dir}/.." && pwd)"
required_files=(SKILL.md agents/openai.yaml references/blob-api.md scripts/blob-api-request.sh scripts/blob-contract-list.sh scripts/validate-skill.sh)
for relative_path in "${required_files[@]}"; do
  [[ -f "${skill_dir}/${relative_path}" ]] || { echo "error: missing ${relative_path}" >&2; exit 1; }
done
[[ "$(sed -n '1p' "${skill_dir}/SKILL.md")" == "---" ]] || { echo "error: invalid frontmatter" >&2; exit 1; }
rg -q '^name: leaf-blob-api$' "${skill_dir}/SKILL.md"
rg -q '^description: .+' "${skill_dir}/SKILL.md"
bash -n "${script_dir}/blob-api-request.sh"
bash -n "${script_dir}/blob-contract-list.sh"
bash -n "${script_dir}/validate-skill.sh"
"${script_dir}/blob-api-request.sh" --help >/dev/null
"${script_dir}/blob-contract-list.sh" --help >/dev/null
echo "leaf-blob-api skill validation passed"
