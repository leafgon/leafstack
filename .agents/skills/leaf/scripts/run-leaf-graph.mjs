#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const usage = () => {
  console.error(
    "usage: run-leaf-graph.mjs --graph <graph.json> [--input <input.json>] [--refnode <node-uuid>] [--version <npm-version>] [--ghostos-dir <source-dir>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set([
    "--graph",
    "--input",
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
  return options;
};

const resolveNpmVersion = (versionSpec) => {
  const raw = execFileSync("npm", ["view", `ghostos@${versionSpec}`, "version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const resolvedVersion = JSON.parse(raw);
  if (typeof resolvedVersion !== "string" || resolvedVersion.length === 0) {
    throw new Error(`npm did not resolve ghostos@${versionSpec} to one version`);
  }
  return resolvedVersion;
};

const extractGraph = (payload) => payload?.data?.graph ?? payload?.graph ?? payload;

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

if (!options.graph) {
  usage();
  process.exit(2);
}

let ghostosEntrypoint;
let ghostosCore;
let loadGhostosCore;
let installedVersion;

if (options["ghostos-dir"]) {
  const ghostosDirectory = resolve(options["ghostos-dir"]);
  const packageJsonPath = resolve(ghostosDirectory, "package.json");
  const packageMetadata = JSON.parse(await readFile(packageJsonPath, "utf8"));
  installedVersion = packageMetadata.version;
  ghostosEntrypoint = resolve(ghostosDirectory, "src/index.core.js");
  await access(ghostosEntrypoint);

  if (!options.version) {
    throw new Error("--ghostos-dir is an explicit source override and requires --version");
  }
} else {
  const requireFromProject = createRequire(resolve(process.cwd(), "package.json"));
  let packageJsonPath;
  try {
    packageJsonPath = requireFromProject.resolve("ghostos/package.json");
  } catch {
    throw new Error("ghostos is not installed in the current project; install ghostos@latest");
  }

  const packageMetadata = JSON.parse(await readFile(packageJsonPath, "utf8"));
  installedVersion = packageMetadata.version;
  loadGhostosCore = () => requireFromProject("ghostos/core");
}

const requestedSpec = options.version ?? "latest";
const requestedVersion = resolveNpmVersion(requestedSpec);
if (installedVersion !== requestedVersion) {
  throw new Error(
    `installed ghostos ${installedVersion} does not match requested ghostos@${requestedSpec} (${requestedVersion})`,
  );
}

if (loadGhostosCore) {
  ghostosCore = loadGhostosCore();
}

const parsedGraph = JSON.parse(await readFile(resolve(options.graph), "utf8"));
const graph = extractGraph(parsedGraph);
if (!graph || !Array.isArray(graph.nodes)) {
  throw new Error("graph payload must resolve to an object with a nodes array");
}

const input = options.input ? JSON.parse(await readFile(resolve(options.input), "utf8")) : {};

if (!ghostosCore) {
  ghostosCore = await import(pathToFileURL(ghostosEntrypoint).href);
}

const { executeLEAFGraph } = ghostosCore;
if (typeof executeLEAFGraph !== "function") {
  throw new Error("ghostos/core does not export executeLEAFGraph");
}

const runtimeOptions = {};
if (typeof graph.domain === "string" && graph.domain.length > 0) {
  runtimeOptions.domain = graph.domain;
}
if (typeof graph.appid === "string" && graph.appid.length > 0) {
  runtimeOptions.appid = graph.appid;
}
if (typeof options.refnode === "string" && options.refnode.length > 0) {
  runtimeOptions.refnode = options.refnode;
}

const output = await executeLEAFGraph(graph, input, runtimeOptions);
console.log(
  JSON.stringify(
    {
      ghostosVersion: installedVersion,
      graphPath: resolve(options.graph),
      input,
      runtimeOptions,
      output,
    },
    null,
    2,
  ),
);
