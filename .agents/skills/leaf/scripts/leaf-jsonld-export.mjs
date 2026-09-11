#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exportGraphToJsonld } from "./lib/leaf-jsonld.mjs";

const usage = () => {
  console.error(
    "usage: leaf-jsonld-export.mjs --graph <graph.json> [--out <graph.jsonld>] [--context <context-uri>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--graph", "--out", "--context"].includes(argument)) {
      if (index + 1 >= argv.length)
        throw new Error(`missing value for ${argument}`);
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.graph) throw new Error("--graph is required");
  return options;
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const graphPath = resolve(options.graph);
const parsedGraph = JSON.parse(await readFile(graphPath, "utf8"));
const jsonld = exportGraphToJsonld(parsedGraph, options.context);

if (options.out) {
  const destination = resolve(options.out);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(jsonld, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      {
        mode: "graph-to-jsonld",
        graphPath,
        jsonldPath: destination,
        nodeCount: jsonld.nodes.length,
        edgeCount: jsonld.edges.length,
      },
      null,
      2,
    ),
  );
} else {
  console.log(JSON.stringify(jsonld, null, 2));
}
