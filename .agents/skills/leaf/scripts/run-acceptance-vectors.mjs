#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const usage = () => {
  console.error(
    "usage: run-acceptance-vectors.mjs --graph <graph.json> --vectors <vectors.json> [--refnode <node-uuid>] [--version <npm-version>] [--ghostos-dir <source-dir>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set([
    "--graph",
    "--vectors",
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
  if (!options.vectors) throw new Error("--vectors is required");
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

const normalizeExpectedOutput = (expected, actual, refnode) => {
  if (
    expected &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    typeof refnode === "string" &&
    refnode.length > 0 &&
    (!actual || typeof actual !== "object" || Array.isArray(actual))
  ) {
    return { [refnode]: actual };
  }
  return actual;
};

const extractCases = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.cases)) return payload.cases;
  if (Array.isArray(payload?.acceptanceVectors)) return payload.acceptanceVectors;
  throw new Error("vectors file must be an array, or object with cases/acceptanceVectors array");
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
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
if (!ghostosCore) {
  ghostosCore = await import(pathToFileURL(ghostosEntrypoint).href);
}

const { executeLEAFGraph } = ghostosCore;
if (typeof executeLEAFGraph !== "function") {
  throw new Error("ghostos/core does not export executeLEAFGraph");
}

const graphPath = resolve(options.graph);
const vectorsPath = resolve(options.vectors);
const parsedGraph = JSON.parse(await readFile(graphPath, "utf8"));
const graph = extractGraph(parsedGraph);
if (!graph || !Array.isArray(graph.nodes)) {
  throw new Error("graph payload must resolve to an object with a nodes array");
}

const vectorsPayload = JSON.parse(await readFile(vectorsPath, "utf8"));
const cases = extractCases(vectorsPayload);
const defaultRefnode = options.refnode ?? vectorsPayload?.refnode;

const results = [];
for (const [index, acceptanceCase] of cases.entries()) {
  const input = acceptanceCase?.input;
  const expected = acceptanceCase?.expected;
  const caseRefnode = acceptanceCase?.refnode ?? defaultRefnode;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`case ${index + 1} must include an object input`);
  }
  if (!Object.hasOwn(acceptanceCase ?? {}, "expected")) {
    throw new Error(`case ${index + 1} must include expected`);
  }

  const runtimeOptions = {};
  if (typeof graph.domain === "string" && graph.domain.length > 0) {
    runtimeOptions.domain = graph.domain;
  }
  if (typeof graph.appid === "string" && graph.appid.length > 0) {
    runtimeOptions.appid = graph.appid;
  }
  if (typeof caseRefnode === "string" && caseRefnode.length > 0) {
    runtimeOptions.refnode = caseRefnode;
  }

  const actualRaw = await executeLEAFGraph(graph, input, runtimeOptions);
  const actual = normalizeExpectedOutput(expected, actualRaw, caseRefnode);
  const pass = isDeepStrictEqual(actual, expected);

  results.push({
    case: acceptanceCase?.case ?? acceptanceCase?.id ?? index + 1,
    input,
    expected,
    actual,
    pass,
  });
}

const allPass = results.every((result) => result.pass);
const output = {
  mode: "acceptance-vectors",
  graphPath,
  vectorsPath,
  ghostosVersion: installedVersion,
  refnode: defaultRefnode ?? null,
  allPass,
  results,
};

console.log(JSON.stringify(output, null, 2));
if (!allPass) process.exitCode = 1;
