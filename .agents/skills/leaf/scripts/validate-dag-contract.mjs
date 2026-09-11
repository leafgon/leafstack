#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const usage = () => {
  console.error(
    "usage: validate-dag-contract.mjs --graph <graph.json> --required <required-edges.json>",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set(["--graph", "--required"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument) || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${argument}`);
    }
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!options.graph) throw new Error("--graph is required");
  if (!options.required) throw new Error("--required is required");
  return options;
};

const extractGraph = (payload) => payload?.data?.graph ?? payload?.graph ?? payload;

const decodeData = (encoded, label) => {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error(`${label} must be a non-empty base64 string`);
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid base64 JSON (${error.message})`);
  }
};

const normalizeRequiredEdges = (payload) => {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.edges)
      ? payload.edges
      : Array.isArray(payload?.requiredEdges)
        ? payload.requiredEdges
        : null;
  if (!candidates) {
    throw new Error("required edges must be an array, or an object with edges/requiredEdges array");
  }

  const normalized = [];
  for (const [index, edge] of candidates.entries()) {
    if (typeof edge === "string") {
      const [from, to] = edge.split("->").map((value) => value?.trim());
      if (!from || !to) throw new Error(`required edge ${index} must be 'from->to'`);
      normalized.push({ from, to });
      continue;
    }
    if (!edge || typeof edge !== "object") {
      throw new Error(`required edge ${index} must be a string or object`);
    }
    const from = edge.from ?? edge.source;
    const to = edge.to ?? edge.target;
    if (typeof from !== "string" || from.length === 0 || typeof to !== "string" || to.length === 0) {
      throw new Error(`required edge ${index} must include non-empty from/to`);
    }
    normalized.push({ from, to });
  }

  return normalized;
};

const toKey = ({ from, to }) => `${from}->${to}`;

const closure = (nodes, edges) => {
  const adjacency = new Map([...nodes].map((node) => [node, new Set()]));
  for (const edge of edges) {
    if (adjacency.has(edge.from) && adjacency.has(edge.to)) {
      adjacency.get(edge.from).add(edge.to);
    }
  }
  const reachable = new Set();
  for (const start of nodes) {
    const queue = [start];
    const visited = new Set([start]);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
        reachable.add(`${start}->${next}`);
      }
    }
  }
  return reachable;
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
const requiredPath = resolve(options.required);

const parsedGraph = JSON.parse(await readFile(graphPath, "utf8"));
const graph = extractGraph(parsedGraph);
if (!graph || !Array.isArray(graph.nodes)) {
  throw new Error("graph payload must resolve to an object with a nodes array");
}

const parsedRequired = JSON.parse(await readFile(requiredPath, "utf8"));
const requiredEdges = normalizeRequiredEdges(parsedRequired);
const requiredSet = new Set(requiredEdges.map(toKey));
const contractNodes = new Set(requiredEdges.flatMap(({ from, to }) => [from, to]));

const dataEdges = [];
for (const node of graph.nodes) {
  if (!node || typeof node !== "object") continue;
  const source = node.uuid;
  if (typeof source !== "string" || source.length === 0) continue;
  const outEdges = Array.isArray(node.out_edges) ? node.out_edges : [];
  for (const edge of outEdges) {
    const target = edge?.target?.uuid;
    if (typeof target !== "string" || target.length === 0) continue;
    const decodedEdge = decodeData(edge?.data, `edge ${edge?.uuid ?? "<missing>"}.data`);
    const edgeType = decodedEdge?.leaf?.logic?.type;
    if (edgeType === "leafdataedge") {
      dataEdges.push({ from: source, to: target, uuid: edge?.uuid ?? null });
    }
  }
}

const dataEdgeSet = new Set(dataEdges.map(toKey));

const missingDirectEdges = [...requiredSet].filter((edge) => !dataEdgeSet.has(edge));
const unexpectedDirectEdges = dataEdges
  .filter(
    ({ from, to }) =>
      (contractNodes.has(from) || contractNodes.has(to)) && !requiredSet.has(`${from}->${to}`),
  )
  .map(({ from, to }) => `${from}->${to}`);

const contractDataEdges = dataEdges.filter(
  ({ from, to }) => contractNodes.has(from) && contractNodes.has(to),
);

const expectedClosure = closure(contractNodes, requiredEdges);
const actualClosure = closure(contractNodes, contractDataEdges);

const missingReachability = [...expectedClosure].filter((edge) => !actualClosure.has(edge));
const unexpectedReachability = [...actualClosure].filter((edge) => !expectedClosure.has(edge));

const externalDataEdges = dataEdges
  .filter(({ from, to }) => !contractNodes.has(from) && !contractNodes.has(to))
  .map(({ from, to }) => `${from}->${to}`);

const pass =
  missingDirectEdges.length === 0 &&
  unexpectedDirectEdges.length === 0 &&
  missingReachability.length === 0 &&
  unexpectedReachability.length === 0;

const result = {
  mode: "dag-contract-check",
  graphPath,
  requiredPath,
  contractNodeCount: contractNodes.size,
  requiredEdgeCount: requiredEdges.length,
  dataEdgeCount: dataEdges.length,
  pass,
  missingDirectEdges,
  unexpectedDirectEdges,
  missingReachability,
  unexpectedReachability,
  ignoredExternalDataEdges: externalDataEdges,
};

console.log(JSON.stringify(result, null, 2));
if (!pass) process.exitCode = 1;
