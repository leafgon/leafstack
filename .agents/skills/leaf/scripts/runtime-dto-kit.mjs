#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = () => {
  console.error(
    "usage: runtime-dto-kit.mjs --out <graph.json> [--domain <domain>] [--appid <appid>] [--endpoint <url>] [--profile-default <profile-id>] [--operation add|subtract|multiply|divide|power] [--constant <number>] [--operation-id <id>] [--in1 <number>] [--refnode <uuid>] [--version <npm-version>] [--ghostos-dir <source-dir>] [--skip-smoke]",
  );
};

const parseArgs = (argv) => {
  const options = {
    skipSmoke: false,
  };
  const supported = new Set([
    "--out",
    "--domain",
    "--appid",
    "--endpoint",
    "--profile-default",
    "--operation",
    "--constant",
    "--operation-id",
    "--in1",
    "--refnode",
    "--version",
    "--ghostos-dir",
    "--skip-smoke",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) {
      throw new Error(`invalid argument: ${argument}`);
    }

    if (argument === "--skip-smoke") {
      options.skipSmoke = true;
      continue;
    }

    if (index + 1 >= argv.length) {
      throw new Error(`missing value for argument: ${argument}`);
    }

    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }

  if (!options.out) throw new Error("--out is required");

  return {
    out: resolve(options.out),
    domain: options.domain,
    appid: options.appid,
    endpoint: options.endpoint,
    profileDefault: options["profile-default"],
    operation: options.operation,
    constant: options.constant,
    operationId: options["operation-id"],
    in1: options.in1,
    refnode: options.refnode,
    version: options.version,
    ghostosDir: options["ghostos-dir"],
    skipSmoke: options.skipSmoke,
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

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const scriptsRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const scaffoldScript = resolve(scriptsRoot, "scaffold-runtime-dto.mjs");
const validateScript = resolve(scriptsRoot, "validate-runtime-dto.mjs");
const smokeScript = resolve(scriptsRoot, "run-runtime-dto-smoke.mjs");

const scaffoldArgs = ["--out", options.out];
if (options.domain) scaffoldArgs.push("--domain", options.domain);
if (options.appid) scaffoldArgs.push("--appid", options.appid);
if (options.endpoint) scaffoldArgs.push("--endpoint", options.endpoint);
if (options.profileDefault) scaffoldArgs.push("--profile-default", options.profileDefault);
if (options.operation) scaffoldArgs.push("--operation", options.operation);
if (options.constant) scaffoldArgs.push("--constant", options.constant);
if (options.operationId) scaffoldArgs.push("--operation-id", options.operationId);

const validateArgs = ["--graph", options.out];

const smokeArgs = ["--graph", options.out];
if (options.in1) smokeArgs.push("--in1", options.in1);
if (options.refnode) smokeArgs.push("--refnode", options.refnode);
if (options.version) smokeArgs.push("--version", options.version);
if (options.ghostosDir) smokeArgs.push("--ghostos-dir", options.ghostosDir);

const scaffold = runScriptJson(scaffoldScript, scaffoldArgs);
const validation = runScriptJson(validateScript, validateArgs);

let smoke = null;
if (!options.skipSmoke) {
  smoke = runScriptJson(smokeScript, smokeArgs);
}

const output = {
  mode: "runtime-dto-kit",
  out: options.out,
  pass: Boolean(validation.pass),
  steps: {
    scaffold,
    validation,
    smoke,
  },
};

console.log(JSON.stringify(output, null, 2));
if (!validation.pass) process.exitCode = 1;
