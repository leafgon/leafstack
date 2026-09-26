#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { extractGraph, inspectRuntimeDtoNodes, validateRuntimeDtoGraph } from "./lib/runtime-dto.mjs";
import { classifyRuntimeIssues } from "./lib/runtime-error-diagnostics.mjs";

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

const issues = classifyRuntimeIssues(stderrText);

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
