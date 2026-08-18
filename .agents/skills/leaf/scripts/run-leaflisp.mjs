#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const usage = () => {
  console.error(
    "usage: run-leaflisp.mjs --code <program.leaflisp> [--input <input.json>] [--version <npm-version>] [--ghostos-dir <source-dir>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set(["--code", "--input", "--version", "--ghostos-dir"]);
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

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

if (!options.code) {
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

const code = await readFile(resolve(options.code), "utf8");
const input = options.input ? JSON.parse(await readFile(resolve(options.input), "utf8")) : [];
if (!ghostosCore) {
  ghostosCore = await import(pathToFileURL(ghostosEntrypoint).href);
}
const { executeLEAFlisp } = ghostosCore;

const output = executeLEAFlisp(input, code, { refnode: resolve(options.code) });
console.log(JSON.stringify({ ghostosVersion: installedVersion, output }, null, 2));
