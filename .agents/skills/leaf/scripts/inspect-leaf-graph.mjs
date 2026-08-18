#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const usage = () => {
  console.error("usage: inspect-leaf-graph.mjs <graph.json> [--json]");
};

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const positional = args.filter((arg) => arg !== "--json");

if (positional.length !== 1) {
  usage();
  process.exit(2);
}

const graphPath = resolve(positional[0]);

const extractNodes = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.nodes)) return payload.nodes;
  if (Array.isArray(payload?.graph?.nodes)) return payload.graph.nodes;
  if (Array.isArray(payload?.data?.graph?.nodes)) return payload.data.graph.nodes;
  if (Array.isArray(payload?.data?.getGraph?.nodes)) return payload.data.getGraph.nodes;
  throw new Error("no supported nodes array found");
};

const decodeData = (encoded, label, errors) => {
  if (typeof encoded !== "string" || encoded.length === 0) {
    errors.push(`${label}: data is not a non-empty base64 string`);
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (error) {
    errors.push(`${label}: cannot decode base64 JSON (${error.message})`);
    return undefined;
  }
};

const increment = (record, key) => {
  const normalizedKey = key ?? "<missing>";
  record[normalizedKey] = (record[normalizedKey] ?? 0) + 1;
};

const connectedComponents = (nodeIds, dataEdges) => {
  const adjacency = new Map([...nodeIds].map((id) => [id, new Set()]));
  for (const edge of dataEdges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }

  const visited = new Set();
  const components = [];
  for (const nodeId of nodeIds) {
    if (visited.has(nodeId)) continue;
    const stack = [nodeId];
    const component = [];
    visited.add(nodeId);
    while (stack.length > 0) {
      const current = stack.pop();
      component.push(current);
      for (const neighbor of adjacency.get(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component.sort());
  }
  return components;
};

const payload = JSON.parse(await readFile(graphPath, "utf8"));
const nodes = extractNodes(payload);
const errors = [];
const warnings = [];
const nodeTypes = {};
const edgeTypes = {};
const nodeIds = new Set();
const edgeIds = new Set();
const edges = [];

for (const [nodeIndex, node] of nodes.entries()) {
  const label = `node[${nodeIndex}]`;
  if (typeof node?.uuid !== "string" || node.uuid.length === 0) {
    errors.push(`${label}: missing uuid`);
    continue;
  }
  if (nodeIds.has(node.uuid)) errors.push(`${label}: duplicate node uuid ${node.uuid}`);
  nodeIds.add(node.uuid);

  const decodedNode = decodeData(node.data, `${label} ${node.uuid}`, errors);
  const logicType = decodedNode?.leaf?.logic?.type;
  increment(nodeTypes, logicType);
  if (node.leafnodetype && logicType && node.leafnodetype !== logicType) {
    warnings.push(
      `${label} ${node.uuid}: leafnodetype=${node.leafnodetype} differs from leaf.logic.type=${logicType}`,
    );
  }

  if (!Array.isArray(node.out_edges)) {
    errors.push(`${label} ${node.uuid}: out_edges is not an array`);
    continue;
  }

  for (const [edgeIndex, edge] of node.out_edges.entries()) {
    const edgeLabel = `${label}.out_edges[${edgeIndex}]`;
    if (typeof edge?.uuid !== "string" || edge.uuid.length === 0) {
      errors.push(`${edgeLabel}: missing uuid`);
      continue;
    }
    if (edgeIds.has(edge.uuid)) errors.push(`${edgeLabel}: duplicate edge uuid ${edge.uuid}`);
    edgeIds.add(edge.uuid);
    const decodedEdge = decodeData(edge.data, `${edgeLabel} ${edge.uuid}`, errors);
    const edgeType = decodedEdge?.leaf?.logic?.type;
    increment(edgeTypes, edgeType);
    const source = edge?.source?.uuid;
    const target = edge?.target?.uuid;
    if (source !== node.uuid) {
      warnings.push(`${edgeLabel} ${edge.uuid}: owning node ${node.uuid} differs from source ${source}`);
    }
    edges.push({ uuid: edge.uuid, type: edgeType, source, target });
  }
}

for (const edge of edges) {
  if (!nodeIds.has(edge.source)) errors.push(`edge ${edge.uuid}: missing source node ${edge.source}`);
  if (!nodeIds.has(edge.target)) errors.push(`edge ${edge.uuid}: missing target node ${edge.target}`);
}

const dataEdges = edges.filter((edge) => edge.type === "leafdataedge");
const dataSources = new Set(dataEdges.map((edge) => edge.source));
const dataTargets = new Set(dataEdges.map((edge) => edge.target));
const starts = [...nodeIds].filter((id) => !dataTargets.has(id)).sort();
const ends = [...nodeIds].filter((id) => !dataSources.has(id)).sort();
const components = connectedComponents(nodeIds, dataEdges);

const summary = {
  file: graphPath,
  nodeCount: nodes.length,
  edgeCount: edges.length,
  nodeTypes,
  edgeTypes,
  dataflowComponentCount: components.length,
  dataflowComponents: components,
  startNodes: starts,
  endNodes: ends,
  warnings,
  errors,
};

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Graph: ${summary.file}`);
  console.log(`Nodes: ${summary.nodeCount}`);
  console.log(`Edges: ${summary.edgeCount}`);
  console.log(`Node types: ${JSON.stringify(summary.nodeTypes)}`);
  console.log(`Edge types: ${JSON.stringify(summary.edgeTypes)}`);
  console.log(`Dataflow components: ${summary.dataflowComponentCount}`);
  components.forEach((component, index) => console.log(`  ${index}: ${component.join(", ")}`));
  console.log(`Start nodes: ${starts.join(", ") || "<none>"}`);
  console.log(`End nodes: ${ends.join(", ") || "<none>"}`);
  warnings.forEach((warning) => console.log(`warning: ${warning}`));
  errors.forEach((error) => console.error(`error: ${error}`));
}

if (errors.length > 0) process.exitCode = 1;
