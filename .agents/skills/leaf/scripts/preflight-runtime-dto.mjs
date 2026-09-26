#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractGraph, lintRuntimeDtoHttpContracts } from "./lib/runtime-dto.mjs";
import { classifyRuntimeIssues } from "./lib/runtime-error-diagnostics.mjs";

const usage = () => {
  console.error(
    "usage: preflight-runtime-dto.mjs --graph <graph.json> [--in1 <number>] [--out-key <key>] [--out-kind any|scalar|vector] [--out-length <n>] [--version <npm-version>] [--ghostos-dir <source-dir>] [--skip-version-check] [--diagnose] [--quiet] [--json-indent <n>] [--log-file <path>]",
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
    "--version",
    "--ghostos-dir",
    "--json-indent",
    "--log-file",
  ]);
  const booleanFlags = new Set([
    "--quiet",
    "--skip-version-check",
    "--diagnose",
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

  return {
    graph: resolve(options.graph),
    in1: in1Value,
    outKey: String(options["out-key"] ?? "OUT1"),
    outKind,
    outLength,
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

try {
  const diagnostics = [];
  const checks = [];
  let observedOutKind = null;
  let observedOutLength = null;
  let staticContract = null;
  let smoke = null;
  let smokeError = null;

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
    staticContract = lintRuntimeDtoHttpContracts(graph, { outKey: options.outKey });
    for (const issue of staticContract.issues) {
      checks.push(`static-contract:${issue.code}`);
    }
  }

  if (validation?.pass && checks.length === 0) {
    const smokeArgs = ["--graph", options.graph, "--in1", String(options.in1)];
    if (options.version) smokeArgs.push("--version", options.version);
    if (options.ghostosDir) smokeArgs.push("--ghostos-dir", options.ghostosDir);
    if (options.skipVersionCheck) smokeArgs.push("--skip-version-check");
    if (options.quiet) smokeArgs.push("--quiet");
    if (Number.isInteger(options.jsonIndent)) {
      smokeArgs.push("--json-indent", String(options.jsonIndent));
    }
    if (options.logFile) smokeArgs.push("--log-file", options.logFile);

    const smokeRun = await runScriptJson(smokeScript, smokeArgs, options);
    if (smokeRun.ok) {
      smoke = smokeRun.payload;

      const outValue = smoke?.output?.[options.outKey];
      observedOutKind = classifyOutValue(outValue);
      observedOutLength = Array.isArray(outValue) ? outValue.length : null;

      if (!(options.outKey in (smoke?.output ?? {}))) {
        checks.push(`missing-output-key:${options.outKey}`);
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
    }
  }

  const pass = Boolean(validation?.pass) && checks.length === 0;

  const output = {
    mode: "preflight-runtime-dto",
    pass,
    graphPath: options.graph,
    input: { IN1: options.in1 },
    outKey: options.outKey,
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

  if (smokeError) {
    output.steps.smokeError = {
      script: smokeError.script,
      message: smokeError.message,
      stderr: truncateText(smokeError.stderr),
    };
  }

  if (options.diagnose) {
    output.diagnostics = {
      enabled: true,
      issueCount: dedupeDiagnostics(diagnostics).length,
      issues: dedupeDiagnostics(diagnostics),
    };
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
