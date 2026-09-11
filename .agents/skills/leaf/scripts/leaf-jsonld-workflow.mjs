#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphFromJsonld, exportGraphToJsonld } from "./lib/leaf-jsonld.mjs";

const usage = () => {
  console.error(`usage: leaf-jsonld-workflow.mjs --jsonld <graph.jsonld> [options]

Options:
  --graph-out <graph.json>           destination transport DTO graph JSON
  --input <input.json>               runtime input JSON for executeLEAFGraph
  --refnode <node-uuid>              runtime target node for executeLEAFGraph
  --skip-run                         compile + inspect only; skip executeLEAFGraph
  --version <npm-version>            forwarded to run-leaf-graph.mjs
  --ghostos-dir <source-dir>         forwarded to run-leaf-graph.mjs
  --jsonld-roundtrip-out <file>      optional normalized JSON-LD export path
  --context <context-uri>            JSON-LD @context for roundtrip export`);
};

const parseArgs = (argv) => {
  const options = {
    skipRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-run") {
      options.skipRun = true;
      continue;
    }
    if (
      [
        "--jsonld",
        "--graph-out",
        "--input",
        "--refnode",
        "--version",
        "--ghostos-dir",
        "--jsonld-roundtrip-out",
        "--context",
      ].includes(argument)
    ) {
      if (index + 1 >= argv.length) {
        throw new Error(`missing value for ${argument}`);
      }
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  if (!options.jsonld) throw new Error("--jsonld is required");
  if (!options.skipRun && options["ghostos-dir"] && !options.version) {
    throw new Error("--ghostos-dir requires --version unless --skip-run is set");
  }
  return options;
};

const defaultGraphOut = (jsonldPath) =>
  jsonldPath.replace(/\.jsonld$/i, ".json").replace(/\.ld\+json$/i, ".json");

const parseJsonOutput = (raw, label) => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON (${error.message})`);
  }
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const jsonldPath = resolve(options.jsonld);
const graphPath = resolve(options["graph-out"] ?? defaultGraphOut(jsonldPath));

const parsedJsonld = JSON.parse(await readFile(jsonldPath, "utf8"));
const graph = buildGraphFromJsonld(parsedJsonld);

await mkdir(dirname(graphPath), { recursive: true });
await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

const scriptDirectory = resolve(dirname(fileURLToPath(import.meta.url)));
const inspectScript = resolve(scriptDirectory, "inspect-leaf-graph.mjs");
const runScript = resolve(scriptDirectory, "run-leaf-graph.mjs");

const inspectRaw = execFileSync(process.execPath, [inspectScript, graphPath, "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const inspect = parseJsonOutput(inspectRaw, "inspect-leaf-graph.mjs");
if (Array.isArray(inspect.errors) && inspect.errors.length > 0) {
  throw new Error(
    `compiled graph failed inspection: ${inspect.errors.join("; ")}`,
  );
}

let run;
  if (!options.skipRun) {
    const runArguments = [runScript, "--graph", graphPath];
    if (options.input) runArguments.push("--input", resolve(options.input));
    if (options.refnode) runArguments.push("--refnode", options.refnode);
    if (options.version) runArguments.push("--version", options.version);
  if (options["ghostos-dir"])
    runArguments.push("--ghostos-dir", resolve(options["ghostos-dir"]));
  const runRaw = execFileSync(process.execPath, runArguments, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  run = parseJsonOutput(runRaw, "run-leaf-graph.mjs");
}

let roundtripPath;
if (options["jsonld-roundtrip-out"]) {
  roundtripPath = resolve(options["jsonld-roundtrip-out"]);
  const roundtrip = exportGraphToJsonld(graph, options.context);
  await mkdir(dirname(roundtripPath), { recursive: true });
  await writeFile(roundtripPath, `${JSON.stringify(roundtrip, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

console.log(
  JSON.stringify(
    {
      mode: "jsonld-workflow",
      jsonldPath,
      graphPath,
      inspected: {
        nodeCount: inspect.nodeCount,
        edgeCount: inspect.edgeCount,
        errors: inspect.errors,
        warnings: inspect.warnings,
      },
      executed: !options.skipRun,
      run,
      roundtripPath: roundtripPath ?? null,
    },
    null,
    2,
  ),
);
