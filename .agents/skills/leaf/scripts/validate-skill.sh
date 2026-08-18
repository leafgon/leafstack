#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "${script_dir}/.." && pwd)"
skill_file="${skill_dir}/SKILL.md"

required_files=(
  "SKILL.md"
  "agents/openai.yaml"
  "references/architecture.md"
  "references/graph-runtime.md"
  "references/leaflisp.md"
  "references/leaf-server-api.md"
  "references/leafelements.md"
  "references/multi-graph-batches.md"
  "scripts/inspect-leaf-workspace.sh"
  "scripts/inspect-leaf-graph.mjs"
  "scripts/lib/leaf-force-layout.mjs"
  "scripts/lib/leaf-semantic-layout.mjs"
  "scripts/lib/leaf-topology-layout.mjs"
  "scripts/lib/piper-node-dimensions.mjs"
  "scripts/leaf-graph-batch.mjs"
  "scripts/run-leaflisp.mjs"
  "scripts/tests/leaf-force-layout.test.mjs"
  "scripts/tests/leaf-graph-batch.test.mjs"
  "scripts/tests/leaf-semantic-layout.test.mjs"
  "scripts/tests/leaf-topology-layout.test.mjs"
  "scripts/validate-skill.sh"
)

for relative_path in "${required_files[@]}"; do
  if [[ ! -f "${skill_dir}/${relative_path}" ]]; then
    echo "error: missing ${relative_path}" >&2
    exit 1
  fi
done

if [[ "$(sed -n '1p' "${skill_file}")" != "---" ]]; then
  echo "error: SKILL.md must start with YAML frontmatter" >&2
  exit 1
fi

frontmatter_end="$(awk 'NR > 1 && $0 == "---" { print NR; exit }' "${skill_file}")"
if [[ -z "${frontmatter_end}" ]]; then
  echo "error: SKILL.md frontmatter is not closed" >&2
  exit 1
fi

frontmatter="$(sed -n "2,$((frontmatter_end - 1))p" "${skill_file}")"
if [[ "$(printf '%s\n' "${frontmatter}" | rg -c '^name: leaf$')" -ne 1 ]]; then
  echo "error: SKILL.md must declare exactly 'name: leaf'" >&2
  exit 1
fi
if [[ "$(printf '%s\n' "${frontmatter}" | rg -c '^description: .+')" -ne 1 ]]; then
  echo "error: SKILL.md must declare one non-empty description" >&2
  exit 1
fi
if printf '%s\n' "${frontmatter}" | rg -q -v '^(name|description): '; then
  echo "error: SKILL.md frontmatter may contain only name and description" >&2
  exit 1
fi

bash -n "${script_dir}/inspect-leaf-workspace.sh"
bash -n "${script_dir}/validate-skill.sh"
node --check "${script_dir}/inspect-leaf-graph.mjs"
node --check "${script_dir}/lib/leaf-force-layout.mjs"
node --check "${script_dir}/lib/leaf-semantic-layout.mjs"
node --check "${script_dir}/lib/leaf-topology-layout.mjs"
node --check "${script_dir}/lib/piper-node-dimensions.mjs"
node --check "${script_dir}/leaf-graph-batch.mjs"
node --check "${script_dir}/run-leaflisp.mjs"
node --test "${script_dir}/tests/leaf-force-layout.test.mjs"
node --test "${script_dir}/tests/leaf-graph-batch.test.mjs"
node --test "${script_dir}/tests/leaf-semantic-layout.test.mjs"
node --test "${script_dir}/tests/leaf-topology-layout.test.mjs"

echo "leaf skill validation passed"
