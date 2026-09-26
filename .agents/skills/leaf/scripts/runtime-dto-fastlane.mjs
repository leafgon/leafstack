#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeRuntimeFailure } from "./lib/runtime-error-diagnostics.mjs";

const usage = () => {
  console.error(
    "usage: runtime-dto-fastlane.mjs --graph <graph.json> [--in1 <number>] [--out-key <key>] [--out-kind any|scalar|vector] [--out-length <n>] [--version <npm-version>] [--ghostos-dir <source-dir>] [--skip-version-check] [--quiet] [--json-indent <n>] [--log-file <path>]",
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

  const in1 = Number(options.in1 ?? 11);
  if (!Number.isFinite(in1)) {
    throw new Error(`--in1 must be numeric (got '${options.in1}')`);
  }

  return {
    graph: resolve(options.graph),
    in1,
    outKey: String(options["out-key"] ?? "OUT1"),
    outKind: String(options["out-kind"] ?? "any"),
    outLength:
      typeof options["out-length"] === "string"
        ? parseNonNegativeInteger(options["out-length"], "--out-length")
        : null,
    version: options.version,
    ghostosDir: options["ghostos-dir"] ? resolve(options["ghostos-dir"]) : null,
    skipVersionCheck: Boolean(options["skip-version-check"]),
    quiet: Boolean(options.quiet),
    jsonIndent:
      typeof options["json-indent"] === "string"
        ? parseNonNegativeInteger(options["json-indent"], "--json-indent")
        : null,
    logFile: options["log-file"] ? resolve(options["log-file"]) : null,
  };
};

const formatJson = (payload, options) => {
  const indent = options.quiet ? 0 : (options.jsonIndent ?? 2);
  return JSON.stringify(payload, null, indent);
};

const appendLog = async (options, content) => {
  if (!options.logFile) return;
  await appendFile(options.logFile, `${content.endsWith("\n") ? content : `${content}\n`}`, "utf8");
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
const preflightScript = resolve(scriptsRoot, "preflight-runtime-dto.mjs");

try {
  const args = [
    preflightScript,
    "--graph", options.graph,
    "--in1", String(options.in1),
    "--out-key", options.outKey,
    "--out-kind", options.outKind,
    "--diagnose",
    "--quiet",
  ];

  if (Number.isInteger(options.outLength)) args.push("--out-length", String(options.outLength));
  if (options.version) args.push("--version", options.version);
  if (options.ghostosDir) args.push("--ghostos-dir", options.ghostosDir);
  if (options.skipVersionCheck) args.push("--skip-version-check");
  if (options.logFile) args.push("--log-file", options.logFile);

  const raw = execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const preflight = JSON.parse(raw);
  const issues = Array.isArray(preflight?.diagnostics?.issues) ? preflight.diagnostics.issues : [];
  const output = {
    mode: "runtime-dto-fastlane",
    pass: Boolean(preflight?.pass),
    graphPath: options.graph,
    input: { IN1: options.in1 },
    checks: Array.isArray(preflight?.checks) ? preflight.checks : [],
    issueCount: issues.length,
    topIssue: issues[0] ?? null,
    nextActions: issues.map((issue) => issue.action).filter(Boolean).slice(0, 3),
    diagnostics: preflight?.diagnostics ?? null,
    preflight,
  };

  console.log(formatJson(output, options));
  if (!output.pass) process.exitCode = 1;
} catch (error) {
  const stderrText = typeof error?.stderr === "string" ? error.stderr : "";
  const stdoutText = typeof error?.stdout === "string" ? error.stdout : "";

  if (stdoutText.trim().startsWith("{")) {
    try {
      const preflight = JSON.parse(stdoutText);
      if (preflight?.mode === "preflight-runtime-dto") {
        const issues = Array.isArray(preflight?.diagnostics?.issues) ? preflight.diagnostics.issues : [];
        const output = {
          mode: "runtime-dto-fastlane",
          pass: Boolean(preflight?.pass),
          graphPath: options.graph,
          input: { IN1: options.in1 },
          checks: Array.isArray(preflight?.checks) ? preflight.checks : [],
          issueCount: issues.length,
          topIssue: issues[0] ?? null,
          nextActions: issues.map((issue) => issue.action).filter(Boolean).slice(0, 3),
          diagnostics: preflight?.diagnostics ?? null,
          preflight,
        };

        console.log(formatJson(output, options));
        process.exit(1);
      }
    } catch {
      // Fall through to compact failure summary.
    }
  }

  const summary = summarizeRuntimeFailure({
    message: error?.message ?? String(error),
    stderr: stderrText,
    stdout: stdoutText,
  });

  await appendLog(
    options,
    [
      `[runtime-dto-fastlane] ${new Date().toISOString()}`,
      `message: ${summary.message}`,
      `issueCode: ${summary.issueCode}`,
      `refnode: ${summary.refnode ?? "n/a"}`,
      stderrText ? `stderr:\n${stderrText}` : "",
      stdoutText ? `stdout:\n${stdoutText}` : "",
    ].filter(Boolean).join("\n\n"),
  );

  const output = {
    mode: "runtime-dto-fastlane",
    pass: false,
    graphPath: options.graph,
    input: { IN1: options.in1 },
    issueCode: summary.issueCode,
    refnode: summary.refnode,
    message: summary.message,
    nextAction: summary.nextAction,
    issues: summary.issues,
  };

  console.error(formatJson(output, options));
  process.exit(1);
}
