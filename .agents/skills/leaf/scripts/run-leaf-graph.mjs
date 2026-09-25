#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, appendFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const usage = () => {
  console.error(
    "usage: run-leaf-graph.mjs --graph <graph.json> [--input <input.json>] [--refnode <node-uuid>] [--version <npm-version>] [--ghostos-dir <source-dir>] [--skip-version-check] [--quiet] [--json-indent <n>] [--log-file <path>]",
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
    "--input",
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

  if (!options.graph) {
    throw new Error("--graph is required");
  }

  return {
    graph: resolve(options.graph),
    input: options.input ? resolve(options.input) : null,
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

try {
  let ghostosEntrypoint;
  let ghostosCore;
  let loadGhostosCore;
  let installedVersion;

  if (options.ghostosDir) {
    const packageJsonPath = resolve(options.ghostosDir, "package.json");
    const packageMetadata = JSON.parse(await readFile(packageJsonPath, "utf8"));
    installedVersion = packageMetadata.version;
    ghostosEntrypoint = resolve(options.ghostosDir, "src/index.core.js");
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

  let versionCheck = "strict:latest";

  if (options.version) {
    const requestedVersion = resolveNpmVersion(options.version);
    if (installedVersion !== requestedVersion) {
      throw new Error(
        `installed ghostos ${installedVersion} does not match requested ghostos@${options.version} (${requestedVersion})`,
      );
    }
    versionCheck = `strict:${options.version}`;
  } else if (options.skipVersionCheck) {
    versionCheck = "skipped-latest-check";
  } else {
    const latestVersion = resolveNpmVersion("latest");
    if (installedVersion !== latestVersion) {
      throw new Error(
        `installed ghostos ${installedVersion} does not match requested ghostos@latest (${latestVersion})`,
      );
    }
  }

  if (loadGhostosCore) {
    ghostosCore = loadGhostosCore();
  }

  const parsedGraph = JSON.parse(await readFile(options.graph, "utf8"));
  const graph = extractGraph(parsedGraph);
  if (!graph || !Array.isArray(graph.nodes)) {
    throw new Error("graph payload must resolve to an object with a nodes array");
  }

  const input = options.input ? JSON.parse(await readFile(options.input, "utf8")) : {};

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
    formatJson(
      {
        ghostosVersion: installedVersion,
        graphPath: options.graph,
        input,
        runtimeOptions,
        output,
        versionCheck,
      },
      options,
    ),
  );
} catch (error) {
  const details = [
    `[run-leaf-graph] ${new Date().toISOString()}`,
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
}
