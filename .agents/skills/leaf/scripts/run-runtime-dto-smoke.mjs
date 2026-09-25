#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = () => {
  console.error(
    "usage: run-runtime-dto-smoke.mjs --graph <graph.json> [--in1 <number>] [--refnode <node-uuid>] [--version <npm-version>] [--ghostos-dir <source-dir>] [--skip-version-check] [--quiet] [--json-indent <n>] [--log-file <path>]",
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
    "--refnode",
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

  const in1Value = Number(options.in1 ?? 11);
  if (!Number.isFinite(in1Value)) {
    throw new Error(`--in1 must be numeric (got '${options.in1}')`);
  }

  return {
    graph: resolve(options.graph),
    in1: in1Value,
    refnode: options.refnode,
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

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runLeafGraphScript = join(skillDir, "scripts", "run-leaf-graph.mjs");
const tempDirectory = await mkdtemp(join(tmpdir(), "leaf-runtime-dto-smoke-"));
const inputPath = join(tempDirectory, "input.json");

try {
  await writeFile(inputPath, `${JSON.stringify({ IN1: options.in1 }, null, 2)}\n`, "utf8");

  const args = [runLeafGraphScript, "--graph", options.graph, "--input", inputPath];
  if (options.refnode) args.push("--refnode", options.refnode);
  if (options.version) args.push("--version", options.version);
  if (options.ghostosDir) args.push("--ghostos-dir", options.ghostosDir);
  if (options.skipVersionCheck) args.push("--skip-version-check");
  if (options.quiet) args.push("--quiet");
  if (Number.isInteger(options.jsonIndent)) args.push("--json-indent", String(options.jsonIndent));
  if (options.logFile) args.push("--log-file", options.logFile);

  const raw = execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const parsed = JSON.parse(raw);
  const output = {
    mode: "runtime-dto-smoke",
    graphPath: options.graph,
    input: { IN1: options.in1 },
    ghostosVersion: parsed.ghostosVersion,
    runtimeOptions: parsed.runtimeOptions,
    output: parsed.output,
    versionCheck: parsed.versionCheck,
  };

  console.log(formatJson(output, options));
} catch (error) {
  const details = [
    `[run-runtime-dto-smoke] ${new Date().toISOString()}`,
    `message: ${error?.message ?? String(error)}`,
  ];

  if (typeof error?.stack === "string" && error.stack.length > 0) {
    details.push(`stack:\n${error.stack}`);
  }

  if (typeof error?.stderr === "string" && error.stderr.length > 0) {
    details.push(`stderr:\n${error.stderr}`);
  }

  if (typeof error?.stdout === "string" && error.stdout.length > 0) {
    details.push(`stdout:\n${error.stdout}`);
  }

  await appendLog(options, `${details.join("\n\n")}\n`);

  const stderrSnippet = truncateText(typeof error?.stderr === "string" ? error.stderr : "");
  if (stderrSnippet.length > 0) {
    console.error(`error: ${error.message}\n${stderrSnippet}`);
  } else {
    console.error(`error: ${error.message}`);
  }
  process.exit(1);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
