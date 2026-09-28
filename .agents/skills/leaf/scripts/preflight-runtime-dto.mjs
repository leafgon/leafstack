#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractGraph, inspectRuntimeDtoNodes, lintRuntimeDtoHttpContracts } from "./lib/runtime-dto.mjs";
import { classifyRuntimeIssues, extractRefnodeFromText } from "./lib/runtime-error-diagnostics.mjs";

const usage = () => {
  console.error(
    "usage: preflight-runtime-dto.mjs --graph <graph.json> [--in1 <number>] [--out-key <key>] [--out-kind any|scalar|vector] [--out-length <n>] [--vectors <vectors.json>] [--required <required-edges.json>] [--parse-safety off|balanced|strict] [--allow-null-out] [--version <npm-version>] [--ghostos-dir <source-dir>] [--skip-version-check] [--diagnose] [--quiet] [--json-indent <n>] [--log-file <path>]",
  );
};

const parseNonNegativeInteger = (raw, flagName) => {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return value;
};

const parseArgs = (argv) => {
  const options = {};
  const valueFlags = new Set([
    "--graph",
    "--in1",
    "--out-key",
    "--out-kind",
    "--out-length",
    "--vectors",
    "--required",
    "--parse-safety",
    "--version",
    "--ghostos-dir",
    "--json-indent",
    "--log-file",
  ]);
  const booleanFlags = new Set([
    "--quiet",
    "--skip-version-check",
    "--diagnose",
    "--allow-null-out",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (valueFlags.has(argument)) {
      if (index + 1 >= argv.length) {
        throw new Error(`missing value for ${argument}`);
      }
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
      continue;
    }

    if (booleanFlags.has(argument)) {
      options[argument.slice(2)] = true;
      continue;
    }

    throw new Error(`invalid argument: ${argument}`);
  }

  if (!options.graph) throw new Error("--graph is required");

  const outKind = String(options["out-kind"] ?? "any").trim().toLowerCase();
  if (!["any", "scalar", "vector"].includes(outKind)) {
    throw new Error("--out-kind must be one of any|scalar|vector");
  }

  const in1Value = Number(options.in1 ?? 11);
  if (!Number.isFinite(in1Value)) {
    throw new Error(`--in1 must be numeric (got '${options.in1}')`);
  }

  const outLengthRaw = String(options["out-length"] ?? "").trim();
  const outLength = outLengthRaw.length === 0 ? null : parseNonNegativeInteger(outLengthRaw, "--out-length");

  const parseSafety = String(options["parse-safety"] ?? "balanced").trim().toLowerCase();
  if (!["off", "balanced", "strict"].includes(parseSafety)) {
    throw new Error("--parse-safety must be one of off|balanced|strict");
  }

  return {
    graph: resolve(options.graph),
    in1: in1Value,
    outKey: String(options["out-key"] ?? "OUT1"),
    outKind,
    outLength,
    vectors: options.vectors ? resolve(options.vectors) : null,
    required: options.required ? resolve(options.required) : null,
    parseSafety,
    allowNullOut: Boolean(options["allow-null-out"]),
    version: options.version,
    ghostosDir: options["ghostos-dir"] ? resolve(options["ghostos-dir"]) : null,
    skipVersionCheck: Boolean(options["skip-version-check"]),
    diagnose: Boolean(options.diagnose),
    quiet: Boolean(options.quiet),
    jsonIndent:
      typeof options["json-indent"] === "string"
        ? parseNonNegativeInteger(options["json-indent"], "--json-indent")
        : null,
    logFile: options["log-file"] ? resolve(options["log-file"]) : null,
  };
};

const truncateText = (value, maxChars = 1200) => {
  if (typeof value !== "string") return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...<truncated ${value.length - maxChars} chars>`;
};

const formatJson = (payload, options) => {
  const indent = options.quiet ? 0 : (options.jsonIndent ?? 2);
  return JSON.stringify(payload, null, indent);
};

const appendLog = async (options, content) => {
  if (!options.logFile) return;
  await appendFile(options.logFile, `${content.endsWith("\n") ? content : `${content}\n`}`, "utf8");
};

const classifyOutValue = (value) => {
  if (Array.isArray(value)) return "vector";
  if (typeof value === "number") return "scalar";
  return "other";
};

const isObjectRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const quoteArg = (value) => {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:-]+$/.test(raw)) return raw;
  return `'${raw.replace(/'/g, `'\\''`)}'`;
};

const buildPreflightCommand = (options) => {
  const command = [
    "node .agents/skills/leaf/scripts/preflight-runtime-dto.mjs",
    `--graph ${quoteArg(options.graph)}`,
    `--in1 ${quoteArg(options.in1)}`,
    `--out-key ${quoteArg(options.outKey)}`,
    `--out-kind ${quoteArg(options.outKind)}`,
    `--parse-safety ${quoteArg(options.parseSafety)}`,
    "--diagnose",
  ];
  if (Number.isInteger(options.outLength)) command.push(`--out-length ${quoteArg(options.outLength)}`);
  if (options.vectors) command.push(`--vectors ${quoteArg(options.vectors)}`);
  if (options.required) command.push(`--required ${quoteArg(options.required)}`);
  if (options.allowNullOut) command.push("--allow-null-out");
  if (options.version) command.push(`--version ${quoteArg(options.version)}`);
  if (options.ghostosDir) command.push(`--ghostos-dir ${quoteArg(options.ghostosDir)}`);
  if (options.skipVersionCheck) command.push("--skip-version-check");
  return command.join(" ");
};

const buildDecodeCommand = (options, refnode) => {
  if (typeof refnode !== "string" || refnode.length === 0) return null;
  return [
    "node .agents/skills/leaf/scripts/decode-runtime-dto-payloads.mjs",
    `--graph ${quoteArg(options.graph)}`,
    `--node ${quoteArg(refnode)}`,
    "--redact",
    "--json",
  ].join(" ");
};

const buildFirstFixRecipe = ({ checks, diagnostics, staticContract, outKey, options, refnode }) => {
  const safeChecks = Array.isArray(checks) ? checks : [];
  const safeDiagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  const firstDiagnosticCode = typeof safeDiagnostics[0]?.code === "string" ? safeDiagnostics[0].code : null;
  const staticIssueCodes = Array.isArray(staticContract?.issues)
    ? staticContract.issues.map((entry) => entry?.code).filter((code) => typeof code === "string")
    : [];
  const hasOutflowStructureIssue = staticIssueCodes.some((code) => [
    "missing-outflow-node",
    "outflow-node-type-mismatch",
    "outflow-node-missing-incoming",
  ].includes(code));

  const recipe = {
    code: null,
    summary: null,
    steps: [],
    nextCommands: [],
  };

  if (safeChecks.includes(`output-envelope-null:${outKey}`)) {
    recipe.code = `output-envelope-null:${outKey}`;
    recipe.summary = `Runtime output envelope is null; repair final output assembly for '${outKey}'.`;
    recipe.steps = [
      "Ensure the final producer returns an object containing the required output key.",
      "Preserve computed values through parse/join stages and avoid collapsing final output to null.",
      "Rerun preflight once after output assembly repair.",
    ];
    recipe.nextCommands = [buildPreflightCommand(options)];
    return recipe;
  }

  if (safeChecks.includes(`output-envelope-nonobject:${outKey}`)) {
    recipe.code = `output-envelope-nonobject:${outKey}`;
    recipe.summary = `Runtime output envelope is not an object; emit '${outKey}' in a keyed output object.`;
    recipe.steps = [
      `Ensure runtime output shape is an object map with key '${outKey}'.`,
      "Avoid returning bare scalar/vector roots when output-key contracts are required.",
      "Rerun preflight once after output-envelope repair.",
    ];
    recipe.nextCommands = [buildPreflightCommand(options)];
    return recipe;
  }

  if (safeChecks.includes(`missing-output-key:${outKey}`)) {
    recipe.code = `missing-output-key:${outKey}`;
    if (hasOutflowStructureIssue) {
      recipe.summary = `Repair sink mapping for '${outKey}' before any other changes.`;
      recipe.steps = [
        `Ensure node '${outKey}' exists with leafnodetype 'leafoutflowport'.`,
        `Ensure at least one compute/parse node has an outgoing edge targeting '${outKey}'.`,
        "Ensure upstream parser emits scalar/vector value (not empty elementio wrapper).",
        "Rerun preflight once after the sink fix.",
      ];
    } else {
      recipe.summary = `Output object is missing '${outKey}'; repair final emit/parse assembly before rewiring sink.`;
      recipe.steps = [
        "Keep existing sink wiring and repair the final producer payload shape.",
        `Ensure final producer returns an object containing key '${outKey}'.`,
        "Rerun preflight once after output assembly repair.",
      ];
    }
    recipe.nextCommands = [buildPreflightCommand(options)];
    return recipe;
  }

  if (safeChecks.includes(`output-null:${outKey}`)) {
    recipe.code = `output-null:${outKey}`;
    recipe.summary = `Repair output assembly for '${outKey}' to emit a non-null value.`;
    recipe.steps = [
      "Ensure the sink-facing node returns computed scalar/vector output, not nil/null.",
      "Verify parser nil-guards are preserving valid computed values and not collapsing to null.",
      "Rerun preflight once after sink/output repair.",
    ];
    recipe.nextCommands = [buildPreflightCommand(options)];
    return recipe;
  }

  if (safeChecks.includes("dag-contract-failed")) {
    recipe.code = "dag-contract-failed";
    recipe.summary = "Repair required data-edge contract mismatches before runtime tuning.";
    recipe.steps = [
      "Review missing/unexpected direct and reachability edges in dagContract diagnostics.",
      "Repair graph edges to match required contract payload.",
      "Rerun preflight once after DAG repair.",
    ];
    recipe.nextCommands = [buildPreflightCommand(options)];
    return recipe;
  }

  if (safeChecks.includes("acceptance-vectors-failed")) {
    recipe.code = "acceptance-vectors-failed";
    recipe.summary = "Runtime smoke passed but acceptance vectors failed; fix semantic computation.";
    recipe.steps = [
      "Inspect acceptanceVectors.results mismatches for expected vs actual outputs.",
      "Repair arithmetic/dataflow semantics while preserving validated output sink wiring.",
      "Rerun preflight once after semantic fix.",
    ];
    recipe.nextCommands = [buildPreflightCommand(options)];
    return recipe;
  }

  const staticContractCheck = safeChecks.find((entry) => entry.startsWith("static-contract:"));
  if (staticContractCheck) {
    const code = staticContractCheck.replace("static-contract:", "");
    const staticMap = {
      "http-node-missing-request-source": {
        summary: "Add a request-builder leaflisp upstream of leafelement(http).",
        steps: [
          "Create/wire request-builder node into HTTP node.",
          "Emit bottle 'http-request' from request-builder.",
          "Rerun preflight.",
        ],
      },
      "http-request-source-missing-http-request-bottle": {
        summary: "Request builder must emit bottle 'http-request'.",
        steps: [
          "Return `(bottle \"http-request\" request)` from request builder.",
          "Keep request map keys: :uri, :mode, :header, :data.{profile,operation,operands}.",
          "Rerun preflight.",
        ],
      },
      "http-request-source-missing-required-token": {
        summary: "Request payload is missing required HTTP contract tokens.",
        steps: [
          "Ensure request expression includes :uri, :mode, :data, :operation, :operands.",
          "Keep :profile present for deterministic profile selection.",
          "Rerun preflight.",
        ],
      },
      "leaflisp-raw-parse-inport-nonscalar-risk": {
        summary: "Raw parse(inport) is fed by non-scalar-risk payload shape.",
        steps: [
          "Unwrap/select scalar value from upstream payload before parse (for example bottle :_content or keyed field).",
          "Keep raw parse(inport) only when scalar contract is explicit and enforced upstream.",
          "Rerun preflight.",
        ],
      },
      "leaflisp-raw-parse-inport-unproven-scalar": {
        summary: "Raw parse(inport) is used without proven scalar contract.",
        steps: [
          "If input is guaranteed scalar, keep concise parse and document/enforce contract upstream.",
          "Otherwise add explicit extraction/guard before parse.",
          "Rerun preflight.",
        ],
      },
      "http-parse-target-missing-result-read": {
        summary: "HTTP parser must read :result from the response payload.",
        steps: [
          "Unwrap bottle/content nil-safely.",
          "Read :result and return parsed scalar/vector output.",
          "Rerun preflight.",
        ],
      },
      "http-parse-target-unsafe-result-parse": {
        summary: "HTTP parser parses :result unsafely and needs nil guards.",
        steps: [
          "Guard missing :result before parse/coercion.",
          "Preserve parser output as scalar/vector without unchecked parse on nil.",
          "Rerun preflight.",
        ],
      },
      "outflow-node-missing-incoming": {
        summary: "Output node exists but has no producer edge.",
        steps: [
          `Wire at least one compute/parse node into '${outKey}'.`,
          "Ensure sink receives finalized computed value.",
          "Rerun preflight.",
        ],
      },
      "leaflisp-wait-bottle-fallback": {
        summary: "Leaflisp emits placeholder wait bottle; replace with deterministic readiness wiring.",
        steps: [
          "Remove bottle \"wait\" fallback logic from compute/request nodes.",
          "Use explicit merge/provenance wiring so requests only execute when required inputs are present.",
          "Rerun preflight.",
        ],
      },
      "leaflisp-lossy-list-coercion": {
        summary: "Leaflisp coerces list payloads to scalar 0, losing data.",
        steps: [
          "Remove lossy (if (islist ...) 0 ...) conversions.",
          "Preserve lists or map them with explicit non-lossy transforms.",
          "Rerun preflight.",
        ],
      },
      "leaflisp-nonsource-in1-reread": {
        summary: "Leaflisp re-reads :IN1 from transformed payloads instead of consuming upstream results.",
        steps: [
          "Consume transformed upstream values explicitly at each stage.",
          "Avoid generic :IN1 fallback extraction in non-source nodes.",
          "Rerun preflight.",
        ],
      },
    };

    if (staticMap[code]) {
      recipe.code = `static-contract:${code}`;
      recipe.summary = staticMap[code].summary;
      recipe.steps = staticMap[code].steps;
      recipe.nextCommands = [buildPreflightCommand(options)];
      return recipe;
    }
  }

  const diagnosticMap = {
    operation_not_found: {
      summary: "Use API operation keys add|subtract|multiply|divide|power only.",
      steps: [
        "Set request data.operation to add|subtract|multiply|divide|power.",
        "Ensure payload uses { profile, operation, operands }.",
        "Rerun preflight.",
      ],
    },
    profile_not_found: {
      summary: "Profile identifier is invalid for current server config.",
      steps: [
        "Set profile to a valid configured value (for example profile-001).",
        "Avoid shell-template literals inside LEAFlisp expressions.",
        "Rerun preflight.",
      ],
    },
    leaflisp_unsupported_tokens: {
      summary: "Replace unsupported LEAFlisp tokens with supported core forms.",
      steps: [
        "Remove list/vector/array/inport2 token usage.",
        "For joins, bottle upstream values and merge via leafmixflow.",
        "Rerun preflight.",
      ],
    },
    leaflisp_literal_shell_template: {
      summary: "Remove shell-template literals from LEAFlisp source.",
      steps: [
        "Do not use ${...} syntax in LEAFlisp.",
        "Set request payload values directly.",
        "Rerun preflight.",
      ],
    },
    leaflisp_invalid_number_object: {
      summary: "Parse received non-scalar object input.",
      steps: [
        "Do not parse raw inport when upstream may provide bottle/map payloads.",
        "Extract scalar field first, then parse/coerce.",
        "Rerun preflight.",
      ],
    },
  };

  if (firstDiagnosticCode && diagnosticMap[firstDiagnosticCode]) {
    recipe.code = firstDiagnosticCode;
    recipe.summary = diagnosticMap[firstDiagnosticCode].summary;
    recipe.steps = diagnosticMap[firstDiagnosticCode].steps;
    const decodeCommand = buildDecodeCommand(options, refnode);
    recipe.nextCommands = decodeCommand ? [decodeCommand, buildPreflightCommand(options)] : [buildPreflightCommand(options)];
    return recipe;
  }

  return null;
};

const runScriptJson = async (scriptPath, args, options) => {
  try {
    const output = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      payload: JSON.parse(output),
      error: null,
    };
  } catch (error) {
    const stderrText = typeof error?.stderr === "string" ? error.stderr : "";
    const stdoutText = typeof error?.stdout === "string" ? error.stdout : "";
    const details = [
      `[preflight-runtime-dto] child failure at ${new Date().toISOString()}`,
      `script: ${scriptPath}`,
      `args: ${JSON.stringify(args)}`,
      `message: ${error?.message ?? String(error)}`,
    ];

    if (stderrText.length > 0) {
      details.push(`stderr:\n${stderrText}`);
    }

    if (stdoutText.length > 0) {
      details.push(`stdout:\n${stdoutText}`);
    }

    await appendLog(options, `${details.join("\n\n")}\n`);

    return {
      ok: false,
      payload: null,
      error: {
        script: scriptPath,
        args,
        message: error?.message ?? String(error),
        stderr: stderrText,
        stdout: stdoutText,
      },
    };
  }
};

const collectDiagnostics = (options, ...texts) => {
  if (!options.diagnose) return [];
  const aggregated = texts
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .join("\n");
  return classifyRuntimeIssues(aggregated);
};

const dedupeDiagnostics = (diagnostics) => {
  const results = [];
  const seen = new Set();
  for (const entry of diagnostics) {
    if (!entry || typeof entry.code !== "string") continue;
    if (seen.has(entry.code)) continue;
    seen.add(entry.code);
    results.push(entry);
  }
  return results;
};

const parseEmbeddedJsonObject = (text) => {
  const input = String(text ?? "").trim();
  if (!input) return null;

  const lines = input.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!(line.startsWith("{") && line.endsWith("}"))) continue;
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }

  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

const buildFocusNodeDiagnostics = async (graphPath, refnode) => {
  if (typeof refnode !== "string" || refnode.length === 0) return null;

  const parsedGraph = JSON.parse(await readFile(graphPath, "utf8"));
  const graph = extractGraph(parsedGraph);
  const nodes = inspectRuntimeDtoNodes(graph);
  const matched = nodes.find((entry) => entry.uuid === refnode) ?? null;
  if (!matched) {
    return { refnode, found: false };
  }

  return {
    refnode,
    found: true,
    nodeIndex: matched.index,
    leafnodetype: matched.leafnodetype,
    logicType: matched.decoded?.leaf?.logic?.type ?? null,
    logicArgsPreview: matched.decoded?.leaf?.logic?.args ?? null,
    decodeError: matched.error,
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

const scriptsRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const validateScript = resolve(scriptsRoot, "validate-runtime-dto.mjs");
const smokeScript = resolve(scriptsRoot, "run-runtime-dto-smoke.mjs");
const validateDagContractScript = resolve(scriptsRoot, "validate-dag-contract.mjs");
const acceptanceVectorsScript = resolve(scriptsRoot, "run-acceptance-vectors.mjs");

try {
  const diagnostics = [];
  const checks = [];
  let observedOutKind = null;
  let observedOutLength = null;
  let staticContract = null;
  let dagContract = null;
  let smoke = null;
  let acceptanceVectors = null;
  let smokeError = null;
  let embeddedSmokeError = null;

  const validationRun = await runScriptJson(validateScript, ["--graph", options.graph], options);
  const validation = validationRun.ok ? validationRun.payload : null;

  if (!validationRun.ok) {
    checks.push("validation-runner-failed");
    diagnostics.push(
      ...collectDiagnostics(
        options,
        validationRun.error?.message,
        validationRun.error?.stderr,
        validationRun.error?.stdout,
      ),
    );
  }

  if (validation?.pass) {
    const parsedGraph = JSON.parse(await readFile(options.graph, "utf8"));
    const graph = extractGraph(parsedGraph);
    staticContract = lintRuntimeDtoHttpContracts(graph, {
      outKey: options.outKey,
      parseSafety: options.parseSafety,
    });
    for (const issue of staticContract.issues) {
      checks.push(`static-contract:${issue.code}`);
    }
  }

  if (validation?.pass && checks.length === 0 && options.required) {
    const dagRun = await runScriptJson(
      validateDagContractScript,
      ["--graph", options.graph, "--required", options.required],
      options,
    );
    if (dagRun.ok) {
      dagContract = dagRun.payload;
      if (!dagContract?.pass) {
        checks.push("dag-contract-failed");
      }
    } else {
      const embeddedDag = parseEmbeddedJsonObject(dagRun.error?.stdout);
      if (embeddedDag?.mode === "dag-contract-check") {
        dagContract = embeddedDag;
        checks.push("dag-contract-failed");
      } else {
        checks.push("dag-contract-runner-failed");
        diagnostics.push(
          ...collectDiagnostics(
            options,
            dagRun.error?.message,
            dagRun.error?.stderr,
            dagRun.error?.stdout,
          ),
        );
      }
    }
  }

  if (validation?.pass && checks.length === 0) {
    const smokeArgs = ["--graph", options.graph, "--in1", String(options.in1)];
    if (options.version) smokeArgs.push("--version", options.version);
    if (options.ghostosDir) smokeArgs.push("--ghostos-dir", options.ghostosDir);
    if (options.skipVersionCheck) smokeArgs.push("--skip-version-check");
    if (options.quiet) smokeArgs.push("--quiet");
    if (options.diagnose || options.quiet) smokeArgs.push("--error-json");
    if (Number.isInteger(options.jsonIndent)) {
      smokeArgs.push("--json-indent", String(options.jsonIndent));
    }
    if (options.logFile) smokeArgs.push("--log-file", options.logFile);

    const smokeRun = await runScriptJson(smokeScript, smokeArgs, options);
    if (smokeRun.ok) {
      smoke = smokeRun.payload;

      const smokeOutput = smoke?.output;
      const hasObjectOutput = isObjectRecord(smokeOutput);
      const hasOutKey = hasObjectOutput && Object.prototype.hasOwnProperty.call(smokeOutput, options.outKey);
      const outValue = hasOutKey ? smokeOutput[options.outKey] : undefined;
      observedOutKind = classifyOutValue(outValue);
      observedOutLength = Array.isArray(outValue) ? outValue.length : null;

      if (!hasObjectOutput) {
        if (smokeOutput === null || smokeOutput === undefined) {
          checks.push(`output-envelope-null:${options.outKey}`);
        } else {
          checks.push(`output-envelope-nonobject:${options.outKey}`);
        }
      } else if (!hasOutKey) {
        checks.push(`missing-output-key:${options.outKey}`);
      }

      if (!options.allowNullOut && hasOutKey && outValue === null) {
        checks.push(`output-null:${options.outKey}`);
      }

      if (options.outKind !== "any" && observedOutKind !== options.outKind) {
        checks.push(`output-kind-mismatch:expected-${options.outKind}:actual-${observedOutKind}`);
      }

      if (Number.isInteger(options.outLength)) {
        if (!Array.isArray(outValue)) {
          checks.push(`output-length-check-requires-vector:${options.outKey}`);
        } else if (outValue.length !== options.outLength) {
          checks.push(`output-length-mismatch:expected-${options.outLength}:actual-${outValue.length}`);
        }
      }
    } else {
      smokeError = smokeRun.error;
      checks.push("smoke-execution-failed");
      diagnostics.push(
        ...collectDiagnostics(
          options,
          smokeRun.error?.message,
          smokeRun.error?.stderr,
          smokeRun.error?.stdout,
        ),
      );

      embeddedSmokeError = parseEmbeddedJsonObject(smokeRun.error?.stderr) ?? parseEmbeddedJsonObject(smokeRun.error?.stdout);
      if (embeddedSmokeError) {
        if (Array.isArray(embeddedSmokeError.issues) && embeddedSmokeError.issues.length > 0) {
          diagnostics.push(...embeddedSmokeError.issues);
        } else if (typeof embeddedSmokeError.issueCode === "string" && embeddedSmokeError.issueCode.length > 0) {
          diagnostics.push({
            code: embeddedSmokeError.issueCode,
            severity: "error",
            meaning: embeddedSmokeError.message ?? "runtime execution failed",
            action: embeddedSmokeError.nextAction ?? "Run preflight-runtime-dto.mjs --diagnose and apply the first suggested fix.",
          });
        }
      }
    }
  }

  if (validation?.pass && checks.length === 0 && options.vectors) {
    const acceptanceArgs = ["--graph", options.graph, "--vectors", options.vectors];
    if (options.version) acceptanceArgs.push("--version", options.version);
    if (options.ghostosDir) acceptanceArgs.push("--ghostos-dir", options.ghostosDir);

    const acceptanceRun = await runScriptJson(acceptanceVectorsScript, acceptanceArgs, options);
    if (acceptanceRun.ok) {
      acceptanceVectors = acceptanceRun.payload;
      if (!acceptanceVectors?.allPass) {
        checks.push("acceptance-vectors-failed");
      }
    } else {
      const embeddedAcceptance = parseEmbeddedJsonObject(acceptanceRun.error?.stdout);
      if (embeddedAcceptance?.mode === "acceptance-vectors") {
        acceptanceVectors = embeddedAcceptance;
        checks.push("acceptance-vectors-failed");
      } else {
        checks.push("acceptance-vectors-runner-failed");
        diagnostics.push(
          ...collectDiagnostics(
            options,
            acceptanceRun.error?.message,
            acceptanceRun.error?.stderr,
            acceptanceRun.error?.stdout,
          ),
        );
      }
    }
  }

  const pass = Boolean(validation?.pass) && checks.length === 0;

  const output = {
    mode: "preflight-runtime-dto",
    pass,
    graphPath: options.graph,
    input: { IN1: options.in1 },
    outKey: options.outKey,
    vectorsPath: options.vectors,
    requiredPath: options.required,
    parseSafety: options.parseSafety,
    allowNullOut: options.allowNullOut,
    outKindExpected: options.outKind,
    outKindObserved: observedOutKind,
    outLengthExpected: options.outLength,
    outLengthObserved: observedOutLength,
    checks,
    steps: {
      validation,
      smoke,
    },
  };

  if (staticContract) {
    output.staticContract = staticContract;
  }

  if (dagContract) {
    output.dagContract = dagContract;
  }

  if (acceptanceVectors) {
    output.acceptanceVectors = acceptanceVectors;
  }

  if (smokeError) {
    output.steps.smokeError = {
      script: smokeError.script,
      message: smokeError.message,
      stderr: truncateText(smokeError.stderr),
    };

    if (embeddedSmokeError) {
      output.steps.smokeError.embedded = embeddedSmokeError;
    }
  }

  if (options.diagnose) {
    const refnode = extractRefnodeFromText([
      smokeError?.stderr,
      smokeError?.stdout,
      smokeError?.message,
      output?.steps?.smokeError?.embedded?.refnode,
    ].filter(Boolean).join("\n"));

    const focus = await buildFocusNodeDiagnostics(options.graph, refnode);
    const issueList = dedupeDiagnostics(diagnostics);
    output.diagnostics = {
      enabled: true,
      issueCount: issueList.length,
      issues: issueList,
      refnode,
      focus,
      nextActions: issueList.map((issue) => issue.action).filter(Boolean).slice(0, 3),
    };

    const minimalCommands = [buildPreflightCommand(options)];
    const decodeCommand = buildDecodeCommand(options, refnode);
    if (decodeCommand) minimalCommands.push(decodeCommand);
    const firstFixRecipe = buildFirstFixRecipe({
      checks,
      diagnostics: issueList,
      staticContract,
      outKey: options.outKey,
      options,
      refnode,
    });
    if (firstFixRecipe) {
      output.firstFixRecipe = firstFixRecipe;
      output.nextCommands = firstFixRecipe.nextCommands.length > 0
        ? firstFixRecipe.nextCommands.slice(0, 2)
        : minimalCommands.slice(0, 2);
    } else {
      output.nextCommands = minimalCommands.slice(0, 2);
    }
  }

  output.completion = pass
    ? {
      readyToSubmit: true,
      stopNow: true,
      reason: "Runtime DTO shape, static contracts, and smoke/output checks passed.",
    }
    : {
      readyToSubmit: false,
      stopNow: false,
      reason: "One or more preflight gates failed; apply diagnostics and rerun preflight.",
    };

  if (!output.nextCommands) {
    output.nextCommands = [buildPreflightCommand(options)];
  }

  console.log(formatJson(output, options));
  if (!pass) process.exitCode = 1;
} catch (error) {
  await appendLog(
    options,
    `[preflight-runtime-dto] ${new Date().toISOString()}\nmessage: ${error?.message ?? String(error)}\n${typeof error?.stack === "string" ? `stack:\n${error.stack}\n` : ""}`,
  );
  console.error(`error: ${error.message}`);
  process.exit(1);
}
