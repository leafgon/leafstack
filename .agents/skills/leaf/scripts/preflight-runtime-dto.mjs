#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const usage = () => {
  console.error(
    "usage: preflight-runtime-dto.mjs --graph <graph.json> [--in1 <number>] [--out-key <key>] [--out-kind any|scalar|vector] [--out-length <n>] [--version <npm-version>] [--ghostos-dir <source-dir>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set([
    "--graph",
    "--in1",
    "--out-key",
    "--out-kind",
    "--out-length",
    "--version",
    "--ghostos-dir",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument) || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${argument}`);
    }

    options[argument.slice(2)] = argv[index + 1];
    index += 1;
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
  const outLength = outLengthRaw.length === 0 ? null : Number.parseInt(outLengthRaw, 10);
  if (outLengthRaw.length > 0 && (!Number.isFinite(outLength) || outLength < 0)) {
    throw new Error(`--out-length must be a non-negative integer (got '${outLengthRaw}')`);
  }

  return {
    graph: resolve(options.graph),
    in1: in1Value,
    outKey: String(options["out-key"] ?? "OUT1"),
    outKind,
    outLength,
    version: options.version,
    ghostosDir: options["ghostos-dir"],
  };
};

const runScriptJson = (scriptPath, args) => {
  const output = execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
};

const classifyOutValue = (value) => {
  if (Array.isArray(value)) return "vector";
  if (typeof value === "number") return "scalar";
  return "other";
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

const validation = runScriptJson(validateScript, ["--graph", options.graph]);

let smoke = null;
const checks = [];
let observedOutKind = null;
let observedOutLength = null;

if (validation.pass) {
  const smokeArgs = ["--graph", options.graph, "--in1", String(options.in1)];
  if (options.version) smokeArgs.push("--version", options.version);
  if (options.ghostosDir) smokeArgs.push("--ghostos-dir", options.ghostosDir);

  smoke = runScriptJson(smokeScript, smokeArgs);

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
}

const pass = Boolean(validation.pass) && checks.length === 0;

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

console.log(JSON.stringify(output, null, 2));
if (!pass) process.exitCode = 1;
