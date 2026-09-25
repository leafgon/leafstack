#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { extractGraph, inspectRuntimeDtoNodes, validateRuntimeDtoGraph } from "./lib/runtime-dto.mjs";

const usage = () => {
  console.error(
    "usage: explain-runtime-error.mjs (--text <message> | --stderr <stderr.log>) [--graph <graph.json>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set(["--text", "--stderr", "--graph"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument) || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${argument}`);
    }
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }

  if (!options.text && !options.stderr) {
    throw new Error("either --text or --stderr is required");
  }

  return {
    text: options.text,
    stderr: options.stderr ? resolve(options.stderr) : null,
    graph: options.graph ? resolve(options.graph) : null,
  };
};

const issueCatalog = [
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

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const stderrText = options.stderr
  ? await readFile(options.stderr, "utf8")
  : String(options.text ?? "");

const issues = [];
for (const issue of issueCatalog) {
  if (!issue.pattern.test(stderrText)) continue;
  issues.push({
    code: issue.code,
    severity: issue.severity,
    meaning: issue.meaning,
    action: issue.action,
  });
}

let graphDiagnostics = null;
if (options.graph) {
  const parsed = JSON.parse(await readFile(options.graph, "utf8"));
  const graph = extractGraph(parsed);
  const shape = validateRuntimeDtoGraph(graph);
  const nodes = inspectRuntimeDtoNodes(graph);
  const nodeDecodeErrors = nodes
    .filter((entry) => typeof entry.error === "string" && entry.error.length > 0)
    .map((entry) => ({
      nodeIndex: entry.index,
      uuid: entry.uuid,
      error: entry.error,
    }));

  graphDiagnostics = {
    pass: shape.pass,
    declarativeShape: shape.declarativeShape,
    nodeCount: shape.nodeCount,
    edgeCount: shape.edgeCount,
    problems: shape.problems,
    warnings: shape.warnings,
    nodeDecodeErrors,
  };

  if (!shape.pass) {
    issues.push({
      code: "runtime_dto_shape_invalid",
      severity: "error",
      meaning: "Graph fails runtime DTO shape validation.",
      action: "Run `validate-runtime-dto.mjs` and repair listed field-path problems before runtime execution.",
    });
  }

  if (nodeDecodeErrors.length > 0) {
    issues.push({
      code: "malformed_node_payloads",
      severity: "error",
      meaning: "One or more nodes contain invalid base64 JSON payloads.",
      action: "Re-encode affected node `data` and ensure decoded payload includes `leaf.logic.type`.",
    });
  }
}

const dedupedIssues = [];
const seen = new Set();
for (const issue of issues) {
  if (seen.has(issue.code)) continue;
  seen.add(issue.code);
  dedupedIssues.push(issue);
}

const output = {
  mode: "explain-runtime-error",
  source: options.stderr ? "stderr-file" : "text",
  stderrPath: options.stderr,
  graphPath: options.graph,
  issueCount: dedupedIssues.length,
  issues: dedupedIssues,
  graphDiagnostics,
};

console.log(JSON.stringify(output, null, 2));
