#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "${script_dir}/.." && pwd)"
skill_file="${skill_dir}/SKILL.md"

required_files=(
  "SKILL.md"
  "agents/openai.yaml"
  "references/architecture.md"
  "references/browser-capture.md"
  "references/blob-storage.md"
  "references/graph-runtime.md"
  "references/jsonld-workflow.md"
  "references/offline-validation.md"
  "references/runtime-dto-authoring-kit.md"
  "references/runtime-dto-payload-contracts.md"
  "references/leaflisp.md"
  "references/leaf-server-api.md"
  "references/leafelements.md"
  "references/multi-graph-batches.md"
  "references/examples/offline-batch.json"
  "references/examples/offline-graph.json"
  "references/examples/offline-graph.jsonld"
  "references/examples/runtime-dto-http-arith.json"
  "references/examples/runtime-dto-contract-template.json"
  "references/examples/l6-hybrid-spell-lisp.required-data-edges.json"
  "references/examples/l6-hybrid-spell-lisp.acceptance-vectors.json"
  "scripts/inspect-leaf-workspace.sh"
  "scripts/capture-leaf-editor.mjs"
  "scripts/leaf-blob-storage.mjs"
  "scripts/leaf-jsonld-build.mjs"
  "scripts/leaf-jsonld-export.mjs"
  "scripts/leaf-jsonld-workflow.mjs"
  "scripts/inspect-leaf-graph.mjs"
  "scripts/decode-runtime-dto-payloads.mjs"
  "scripts/scaffold-runtime-dto.mjs"
  "scripts/validate-dag-contract.mjs"
  "scripts/validate-runtime-dto.mjs"
  "scripts/runtime-dto-kit.mjs"
  "scripts/preflight-runtime-dto.mjs"
  "scripts/runtime-dto-fastlane.mjs"
  "scripts/explain-runtime-error.mjs"
  "scripts/run-acceptance-vectors.mjs"
  "scripts/lib/leaf-force-layout.mjs"
  "scripts/lib/runtime-dto.mjs"
  "scripts/lib/runtime-error-diagnostics.mjs"
  "scripts/lib/leaf-jsonld.mjs"
  "scripts/lib/leaf-semantic-layout.mjs"
  "scripts/lib/leaf-topology-layout.mjs"
  "scripts/lib/piper-node-dimensions.mjs"
  "scripts/leaf-graph-batch.mjs"
  "scripts/run-leaf-graph.mjs"
  "scripts/run-runtime-dto-smoke.mjs"
  "scripts/run-leaflisp.mjs"
  "scripts/tests/leaf-force-layout.test.mjs"
  "scripts/tests/leaf-blob-storage.test.mjs"
  "scripts/tests/leaf-jsonld-tools.test.mjs"
  "scripts/tests/leaf-jsonld-workflow.test.mjs"
  "scripts/tests/leaf-graph-batch.test.mjs"
  "scripts/tests/validate-dag-contract.test.mjs"
  "scripts/tests/validate-runtime-dto.test.mjs"
  "scripts/tests/scaffold-runtime-dto.test.mjs"
  "scripts/tests/run-acceptance-vectors.test.mjs"
  "scripts/tests/run-runtime-dto-smoke.test.mjs"
  "scripts/tests/runtime-dto-kit.test.mjs"
  "scripts/tests/preflight-runtime-dto.test.mjs"
  "scripts/tests/runtime-dto-fastlane.test.mjs"
  "scripts/tests/explain-runtime-error.test.mjs"
  "scripts/tests/run-leaf-graph.test.mjs"
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

node - <<'NODE' "${skill_dir}"
const fs = require("fs");
const path = require("path");

const skillDir = process.argv[2];
const violations = [];

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") continue;
    if (!Array.isArray(payload.nodes)) continue;

    const firstNode = payload.nodes.find(
      (node) => node && typeof node === "object" && !Array.isArray(node),
    );
    const hasTopLevelEdges = Array.isArray(payload.edges);
    const looksLegacyNode =
      firstNode &&
      Object.hasOwn(firstNode, "id") &&
      Object.hasOwn(firstNode, "type") &&
      !Object.hasOwn(firstNode, "uuid");

    if (hasTopLevelEdges || looksLegacyNode) {
      violations.push(path.relative(skillDir, fullPath));
    }
  }
};

walk(skillDir);

if (violations.length > 0) {
  console.error(
    `error: disallowed non-JSON-LD graph schema detected in .json file(s): ${violations.join(", ")}`,
  );
  console.error(
    "use transport DTO .json or .jsonld source compiled into transport DTO .json",
  );
  process.exit(1);
}
NODE

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
count_pattern() {
  local pattern="$1"
  if command -v rg >/dev/null 2>&1; then
    printf '%s\n' "${frontmatter}" | rg -c -- "${pattern}"
  else
    printf '%s\n' "${frontmatter}" | grep -E -c -- "${pattern}"
  fi
}

has_line_outside_allowed() {
  local allowed_pattern='^(name|description): '
  if command -v rg >/dev/null 2>&1; then
    printf '%s\n' "${frontmatter}" | rg -q -v -- "${allowed_pattern}"
  else
    printf '%s\n' "${frontmatter}" | grep -E -q -v -- "${allowed_pattern}"
  fi
}

if [[ "$(count_pattern '^name: leaf$')" -ne 1 ]]; then
  echo "error: SKILL.md must declare exactly 'name: leaf'" >&2
  exit 1
fi
if [[ "$(count_pattern '^description: .+')" -ne 1 ]]; then
  echo "error: SKILL.md must declare one non-empty description" >&2
  exit 1
fi
if has_line_outside_allowed; then
  echo "error: SKILL.md frontmatter may contain only name and description" >&2
  exit 1
fi

bash -n "${script_dir}/inspect-leaf-workspace.sh"
bash -n "${script_dir}/validate-skill.sh"
node --check "${script_dir}/inspect-leaf-graph.mjs"
node --check "${script_dir}/decode-runtime-dto-payloads.mjs"
node --check "${script_dir}/capture-leaf-editor.mjs"
node --check "${script_dir}/leaf-blob-storage.mjs"
node --check "${script_dir}/leaf-jsonld-build.mjs"
node --check "${script_dir}/leaf-jsonld-export.mjs"
node --check "${script_dir}/leaf-jsonld-workflow.mjs"
node --check "${script_dir}/validate-dag-contract.mjs"
node --check "${script_dir}/validate-runtime-dto.mjs"
node --check "${script_dir}/scaffold-runtime-dto.mjs"
node --check "${script_dir}/runtime-dto-kit.mjs"
node --check "${script_dir}/preflight-runtime-dto.mjs"
node --check "${script_dir}/runtime-dto-fastlane.mjs"
node --check "${script_dir}/explain-runtime-error.mjs"
node --check "${script_dir}/run-acceptance-vectors.mjs"
node --check "${script_dir}/lib/leaf-force-layout.mjs"
node --check "${script_dir}/lib/runtime-dto.mjs"
node --check "${script_dir}/lib/runtime-error-diagnostics.mjs"
node --check "${script_dir}/lib/leaf-jsonld.mjs"
node --check "${script_dir}/lib/leaf-semantic-layout.mjs"
node --check "${script_dir}/lib/leaf-topology-layout.mjs"
node --check "${script_dir}/lib/piper-node-dimensions.mjs"
node --check "${script_dir}/leaf-graph-batch.mjs"
node --check "${script_dir}/run-leaf-graph.mjs"
node --check "${script_dir}/run-runtime-dto-smoke.mjs"
node --check "${script_dir}/run-leaflisp.mjs"
node --test "${script_dir}/tests/leaf-force-layout.test.mjs"
node --test "${script_dir}/tests/leaf-blob-storage.test.mjs"
node --test "${script_dir}/tests/leaf-jsonld-tools.test.mjs"
node --test "${script_dir}/tests/leaf-jsonld-workflow.test.mjs"
node --test "${script_dir}/tests/leaf-graph-batch.test.mjs"
node --test "${script_dir}/tests/validate-dag-contract.test.mjs"
node --test "${script_dir}/tests/validate-runtime-dto.test.mjs"
node --test "${script_dir}/tests/scaffold-runtime-dto.test.mjs"
node --test "${script_dir}/tests/run-acceptance-vectors.test.mjs"
node --test "${script_dir}/tests/run-runtime-dto-smoke.test.mjs"
node --test "${script_dir}/tests/runtime-dto-kit.test.mjs"
node --test "${script_dir}/tests/preflight-runtime-dto.test.mjs"
node --test "${script_dir}/tests/runtime-dto-fastlane.test.mjs"
node --test "${script_dir}/tests/explain-runtime-error.test.mjs"
node --test "${script_dir}/tests/run-leaf-graph.test.mjs"
node --test "${script_dir}/tests/leaf-semantic-layout.test.mjs"
node --test "${script_dir}/tests/leaf-topology-layout.test.mjs"

echo "leaf skill validation passed"
