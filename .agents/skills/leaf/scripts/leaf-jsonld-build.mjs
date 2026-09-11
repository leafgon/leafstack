#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildGraphFromJsonld } from "./lib/leaf-jsonld.mjs";

const usage = () => {
  console.error("usage: leaf-jsonld-build.mjs --jsonld <graph.jsonld> [--out <graph.json>]");
};

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--jsonld", "--out"].includes(argument)) {
      if (index + 1 >= argv.length)
        throw new Error(`missing value for ${argument}`);
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.jsonld) throw new Error("--jsonld is required");
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

const jsonldPath = resolve(options.jsonld);
const parsedJsonld = JSON.parse(await readFile(jsonldPath, "utf8"));
const graph = buildGraphFromJsonld(parsedJsonld);

if (options.out) {
  const destination = resolve(options.out);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(graph, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      {
        mode: "jsonld-to-graph",
        jsonldPath,
        graphPath: destination,
        nodeCount: graph.nodes.length,
        edgeCount: graph.nodes.reduce((count, node) => count + node.out_edges.length, 0),
      },
      null,
      2,
    ),
  );
} else {
  console.log(JSON.stringify(graph, null, 2));
}
