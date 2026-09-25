#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { extractGraph, validateRuntimeDtoGraph } from "./lib/runtime-dto.mjs";

const usage = () => {
  console.error("usage: validate-runtime-dto.mjs --graph <graph.json>");
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set(["--graph"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument) || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${argument}`);
    }
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!options.graph) throw new Error("--graph is required");
  return { graph: resolve(options.graph) };
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const parsed = JSON.parse(await readFile(options.graph, "utf8"));
const graph = extractGraph(parsed);
const validation = validateRuntimeDtoGraph(graph);

const output = {
  mode: "validate-runtime-dto",
  graphPath: options.graph,
  pass: validation.pass,
  declarativeShape: validation.declarativeShape,
  nodeCount: validation.nodeCount,
  edgeCount: validation.edgeCount,
  problems: validation.problems,
  warnings: validation.warnings,
};

console.log(JSON.stringify(output, null, 2));
if (!validation.pass) process.exitCode = 1;
