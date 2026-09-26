export const issueCatalog = [
  {
    code: "models_manager_decode_warning",
    pattern: /failed to refresh available models|failed to decode models response|missing field `models`/i,
    severity: "warning",
    meaning: "Codex model-manager response parsing failed; usually unrelated to LEAF graph runtime semantics.",
    action: "Treat as infrastructure noise unless the run terminates immediately. Re-run if persistent.",
  },
  {
    code: "runtime_timeout",
    pattern: /ETIMEDOUT|Runner timeout|timed out/i,
    severity: "error",
    meaning: "Runtime execution exceeded configured timeout budget.",
    action: "Increase timeout for heavy profiles or reduce exploratory commands; run smoke check earlier.",
  },
  {
    code: "buffer_undefined_payload",
    pattern: /The first argument must be of type string|Received undefined/i,
    severity: "error",
    meaning: "A node/edge payload expected base64 JSON but received undefined/invalid content.",
    action: "Validate runtime DTO shape and inspect node/edge `data` payload encoding.",
  },
  {
    code: "weave_default_missing",
    pattern: /_default|has no _default defined|weaveDataflowPlane/i,
    severity: "error",
    meaning: "A reduced node function is missing; often caused by malformed node data or unsupported node type wiring.",
    action: "Verify decoded `leaf.logic.type`, `leafnodetype` alignment, and required wiring for that node kind.",
  },
  {
    code: "leaflisp_expected_vector_got_number",
    pattern: /Type Error! Expected 'Vector', but got 'Number'/i,
    severity: "error",
    meaning: "Leaflisp received a scalar where a vector operand was required.",
    action: "Verify request payload assembly and input-shape normalization for vector-indexed expressions.",
  },
  {
    code: "leaflisp_expected_hashmap_got_number",
    pattern: /Type Error! Expected 'HashMap', but got 'Number'/i,
    severity: "error",
    meaning: "Leaflisp map access attempted on a scalar value.",
    action: "Check bottle/content extraction and ensure map-typed payload before key lookup.",
  },
  {
    code: "leaflisp_vector_index_undefined",
    pattern: /Vector index \d+ is not defined/i,
    severity: "error",
    meaning: "Leaflisp indexed a vector position that does not exist.",
    action: "Ensure operand vectors are populated in the expected order and length before indexing.",
  },
  {
    code: "operation_id_not_found",
    pattern: /OPERATION_ID_NOT_FOUND/i,
    severity: "error",
    meaning: "Arithmetic API did not find `operationId` in selected latency profile.",
    action: "Use operation IDs provisioned in profile map or apply a validator remapper policy at replay time.",
  },
  {
    code: "profile_not_found",
    pattern: /PROFILE_NOT_FOUND|Unknown latency profile/i,
    severity: "error",
    meaning: "Arithmetic API profile identifier is invalid/unavailable.",
    action: "Set `ARITHMETIC_PROFILE_ID` correctly and verify server profile config.",
  },
  {
    code: "runner_empty_output",
    pattern: /leaf-runtime-runner-empty-output|Could not parse OUT1 payload/i,
    severity: "error",
    meaning: "Runtime process exited without valid output payload.",
    action: "Check stderr crash trace and run `run-runtime-dto-smoke.mjs` with the same graph/input.",
  },
];

export const classifyRuntimeIssues = (text) => {
  const input = String(text ?? "");
  const issues = [];

  for (const issue of issueCatalog) {
    if (!issue.pattern.test(input)) continue;
    issues.push({
      code: issue.code,
      severity: issue.severity,
      meaning: issue.meaning,
      action: issue.action,
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const issue of issues) {
    if (seen.has(issue.code)) continue;
    seen.add(issue.code);
    deduped.push(issue);
  }

  return deduped;
};

