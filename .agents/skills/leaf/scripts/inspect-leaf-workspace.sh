#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "${script_dir}/.." && pwd)"
workspace_root="${1:-$(cd "${skill_dir}/../../.." && pwd)}"

echo "Leaf skill workspace: ${workspace_root}"
echo

echo "Runtime toolchain"
if command -v node >/dev/null 2>&1; then
  printf '  node: %s\n' "$(node --version)"
else
  echo "  node: missing"
fi
if command -v npm >/dev/null 2>&1; then
  printf '  npm:  %s\n' "$(npm --version)"
else
  echo "  npm:  missing"
fi

echo
echo "Selected GhostOS npm release"
if ghostos_npm_metadata="$(npm view ghostos@latest version engines exports --json 2>/dev/null)"; then
  printf '%s\n' "${ghostos_npm_metadata}"
else
  echo "  unavailable; resolve npm connectivity before execution"
fi

echo
echo "Installed GhostOS package (optional)"
if command -v node >/dev/null 2>&1; then
  if installed_version="$(node -p "(() => { try { return require('ghostos/package.json').version; } catch { return ''; } })()" 2>/dev/null)" && [[ -n "${installed_version}" ]]; then
    printf '  ghostos: %s\n' "${installed_version}"
  else
    echo "  ghostos: not installed in current Node resolution context"
  fi
fi

echo
echo "Leaf skill package files"
reference_files=(
  "${skill_dir}/SKILL.md"
  "${skill_dir}/references/architecture.md"
  "${skill_dir}/references/leaf-server-api.md"
  "${skill_dir}/references/graph-runtime.md"
  "${skill_dir}/scripts/inspect-leaf-graph.mjs"
  "${skill_dir}/scripts/leaf-graph-batch.mjs"
  "${skill_dir}/scripts/run-leaflisp.mjs"
)

for path in "${reference_files[@]}"; do
  if [[ -f "${path}" ]]; then
    printf '  ok      %s\n' "${path#${workspace_root}/}"
  else
    printf '  missing %s\n' "${path#${workspace_root}/}"
  fi
done

echo
echo "Endpoint reminder"
echo "  target /qmgraphql endpoint, domain/app scope, and auth must be confirmed before mutations"
