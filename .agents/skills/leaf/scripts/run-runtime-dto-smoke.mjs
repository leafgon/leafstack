#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = () => {
  console.error(
    "usage: run-runtime-dto-smoke.mjs --graph <graph.json> [--in1 <number>] [--refnode <node-uuid>] [--version <npm-version>] [--ghostos-dir <source-dir>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set([
    "--graph",
    "--in1",
    "--refnode",
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
  const in1Value = Number(options.in1 ?? 11);
  if (!Number.isFinite(in1Value)) {
    throw new Error(`--in1 must be numeric (got '${options.in1}')`);
  }
  return {
    graph: resolve(options.graph),
    in1: in1Value,
    refnode: options.refnode,
    version: options.version,
    ghostosDir: options["ghostos-dir"],
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
  };

  console.log(JSON.stringify(output, null, 2));
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
