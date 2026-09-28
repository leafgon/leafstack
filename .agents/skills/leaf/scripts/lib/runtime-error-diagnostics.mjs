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
    action: "Check bottle/content extraction and provenance merge: for multi-edge joins, bottle upstream payloads and resolve via leafmixflow key-value map before key lookup.",
  },
  {
    code: "leaflisp_vector_index_undefined",
    pattern: /Vector index \d+ is not defined/i,
    severity: "error",
    meaning: "Leaflisp indexed a vector position that does not exist.",
    action: "Ensure operand vectors are populated in the expected order and length before indexing.",
  },
  {
    code: "leaflisp_unsupported_tokens",
    pattern: /\b\(list\b|\b\(vector\b|\b\(array\b|\binport2\b|unsupported token/i,
    severity: "error",
    meaning: "Leaflisp expression contains unsupported dialect tokens.",
    action: "Use LEAFlisp core forms only. Run preflight-runtime-dto.mjs --diagnose to catch token issues before smoke execution.",
  },
  {
    code: "leaflisp_literal_shell_template",
    pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}|literal shell-template syntax/i,
    severity: "error",
    meaning: "Leaflisp source includes shell-style variable templates that are not expanded at runtime.",
    action: "Do not use ${...} template syntax inside LEAFlisp expressions; set request values directly in payload maps.",
  },
  {
    code: "leaflisp_null_startswith",
    pattern: /Cannot read properties of null \(reading 'startsWith'\)|Cannot read properties of null \(reading \"startsWith\"\)/i,
    severity: "error",
    meaning: "Leaflisp attempted string parsing on a null value; usually caused by parsing :result before HTTP payload is ready.",
    action: "Use nil-safe parser flow: unwrap bottle/content, read :result, guard nil before parse/coercion, and avoid unchecked pair[0/1] assumptions.",
  },
  {
    code: "leaflisp_invalid_number_object",
    pattern: /Invalid number:\s*"\[object Object\]"|Invalid number:\s*\[object Object\]/i,
    severity: "error",
    meaning: "Leaflisp parse/coercion received an object payload where a scalar was expected.",
    action: "Avoid raw (parse inport) for non-scalar-prone upstream payloads; unwrap/select scalar value first, then parse/coerce.",
  },
  {
    code: "operation_not_found",
    pattern: /OPERATION_NOT_FOUND|Unknown operation key for profile/i,
    severity: "error",
    meaning: "Arithmetic API did not find the requested operation key in the selected profile.",
    action: "Use one of add|subtract|multiply|divide|power and verify profile is configured for by-operation delays.",
  },
  {
    code: "operation_id_not_found",
    pattern: /OPERATION_ID_NOT_FOUND/i,
    severity: "error",
    meaning: "Arithmetic API rejected an obsolete request payload that depends on `operationId`.",
    action: "Use by-operation payloads only: `{ profile, operation, operands }` and remove `operationId`.",
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
    pattern: /leaf-runtime-runner-empty-output|Could not parse OUT1 payload|Detected unsettled top-level await/i,
    severity: "error",
    meaning: "Runtime process exited without valid output payload.",
    action: "Check stderr crash trace and run `run-runtime-dto-smoke.mjs` with the same graph/input.",
  },
  {
    code: "output_null",
    pattern: /output-null:OUT\d+|output-null:/i,
    severity: "error",
    meaning: "Output key resolved to null during preflight.",
    action: "Repair sink/output assembly so the outflow key emits a concrete scalar/vector value.",
  },
  {
    code: "dag_contract_failed",
    pattern: /dag-contract-failed|missingDirectEdges|unexpectedDirectEdges|missingReachability|unexpectedReachability/i,
    severity: "error",
    meaning: "Required data-edge contract validation failed.",
    action: "Repair graph data-edge wiring to match required contract edges before runtime tuning.",
  },
  {
    code: "acceptance_vectors_failed",
    pattern: /acceptance-vectors-failed|"mode"\s*:\s*"acceptance-vectors"/i,
    severity: "error",
    meaning: "Acceptance-vector checks reported semantic mismatches.",
    action: "Inspect expected vs actual acceptance outputs and repair computation semantics.",
  },
  {
    code: "leaflisp_wait_bottle_fallback",
    pattern: /leaflisp-wait-bottle-fallback|bottle\s+["']wait["']/i,
    severity: "error",
    meaning: "Leaflisp uses placeholder wait-bottle fallback that can stall async execution.",
    action: "Remove wait-bottle fallback and use deterministic readiness wiring with explicit merge/provenance semantics.",
  },
  {
    code: "leaflisp_lossy_list_coercion",
    pattern: /leaflisp-lossy-list-coercion|\(if\s+\(islist\s+[^\s)]+\)\s+0\s+[^\s)]+\)/i,
    severity: "error",
    meaning: "Leaflisp expression collapses list payloads to scalar zero.",
    action: "Replace lossy list coercion with explicit non-lossy list/object shaping.",
  },
  {
    code: "leaflisp_nonsource_in1_reread",
    pattern: /leaflisp-nonsource-in1-reread/i,
    severity: "error",
    meaning: "Non-source node re-reads root :IN1 key from transformed payloads.",
    action: "Consume transformed upstream values explicitly and avoid generic :IN1 fallback extraction in downstream nodes.",
  },
  {
    code: "runtime_dto_shape_invalid",
    pattern: /declarative schema|mixed declarative and runtime DTO|top-level edges array|runtime DTO requires nested nodes\[\]\.out_edges/i,
    severity: "error",
    meaning: "Artifact shape does not satisfy runtime DTO transport contract.",
    action: "Run validate-runtime-dto.mjs and convert artifact to canonical runtime DTO shape before execution.",
  },
  {
    code: "noncanonical_leaflisp_data",
    pattern: /noncanonical-leaflisp-data/i,
    severity: "error",
    meaning: "Leaf node payload does not satisfy canonical leaflisp data contract.",
    action: "Re-encode node data to include canonical leaf.logic payload and rerun validate-runtime-dto.mjs.",
  },
  {
    code: "unsupported_leaf_node_type",
    pattern: /unsupported leaf node type|unknown leafnodetype|unknown leaf\.logic\.type/i,
    severity: "error",
    meaning: "Graph references a leaf node type unsupported by the runtime/tooling context.",
    action: "Use documented node types and verify nodes[].leafnodetype matches decoded leaf.logic.type.",
  },
  {
    code: "http_contract_missing_required_fields",
    pattern: /http-request-source-missing-required-token|http-request-source-missing-http-request-bottle|http-parse-target-missing-result-read/i,
    severity: "error",
    meaning: "HTTP request/parse contract is incomplete for leafelement(http).",
    action: "Ensure request bottle has :uri/:mode/:data/:operation/:operands and parser unwraps _content then reads :result.",
  },
  {
    code: "leaflisp_raw_parse_inport_nonscalar_risk",
    pattern: /leaflisp-raw-parse-inport-nonscalar-risk/i,
    severity: "error",
    meaning: "Leaflisp node parses inport directly even though upstream shape is non-scalar-prone.",
    action: "Add explicit extraction (bottle/content or keyed scalar) before (parse inport).",
  },
  {
    code: "leaflisp_raw_parse_inport_unproven_scalar",
    pattern: /leaflisp-raw-parse-inport-unproven-scalar/i,
    severity: "warning",
    meaning: "Leaflisp node parses inport directly without proven scalar contract.",
    action: "Keep concise parse only when upstream scalar contract is explicit; otherwise add extraction/guard before parse.",
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

export const extractRefnodeFromText = (text) => {
  const input = String(text ?? "");
  const patterns = [
    /refnode:\s*([A-Za-z0-9_-]+)/i,
    /"refnode"\s*:\s*"([A-Za-z0-9_-]+)"/i,
    /\{refnode:\s*([A-Za-z0-9_-]+)\}/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match && match[1]) return match[1];
  }

  return null;
};

const firstNonEmptyLine = (text) => String(text ?? "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line.length > 0) ?? "";

export const summarizeRuntimeFailure = ({ message = "", stderr = "", stdout = "" } = {}) => {
  const combined = [stderr, stdout, message].filter((entry) => String(entry ?? "").length > 0).join("\n");
  const issues = classifyRuntimeIssues(combined);
  const primaryIssue = issues.find((issue) => issue.severity === "error") ?? issues[0] ?? null;
  const refnode = extractRefnodeFromText(combined);
  const fallbackMessage = firstNonEmptyLine(stderr) || firstNonEmptyLine(message) || "runtime execution failed";

  return {
    issues,
    issueCode: primaryIssue?.code ?? "runtime_error",
    message: primaryIssue?.meaning ?? fallbackMessage,
    nextAction: primaryIssue?.action ?? "Run preflight-runtime-dto.mjs --diagnose and apply the first suggested fix.",
    refnode,
  };
};
