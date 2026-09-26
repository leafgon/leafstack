#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeBase64Json, extractGraph } from "./lib/runtime-dto.mjs";

const usage = () => {
  console.error(
    "usage: decode-runtime-dto-payloads.mjs --graph <graph.json> [--node <uuid>]... [--edge <uuid>]... [--all] [--full] [--redact] [--json]",
  );
};

const parseArgs = (argv) => {
  const options = {
    graph: null,
    nodeFilters: [],
    edgeFilters: [],
    all: false,
    full: false,
    redact: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--graph") {
      options.graph = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--node") {
      const value = argv[index + 1] ?? "";
      if (value.length === 0) throw new Error("--node requires a uuid value");
      options.nodeFilters.push(value);
      index += 1;
      continue;
    }
    if (arg === "--edge") {
      const value = argv[index + 1] ?? "";
      if (value.length === 0) throw new Error("--edge requires a uuid value");
      options.edgeFilters.push(value);
      index += 1;
      continue;
    }
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--full") {
      options.full = true;
      continue;
    }
    if (arg === "--redact") {
      options.redact = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`invalid argument: ${arg}`);
  }

  if (!options.graph) throw new Error("--graph is required");

  return options;
};

const increment = (record, key) => {
  const normalized = key && String(key).length > 0 ? String(key) : "<missing>";
  record[normalized] = (record[normalized] ?? 0) + 1;
};

const summarizePayload = (decoded, fallbackType = null) => ({
  api: decoded?.leaf?.api ?? null,
  logicType: decoded?.leaf?.logic?.type ?? fallbackType,
  argKeys: Object.keys(decoded?.leaf?.logic?.args ?? {}),
  appdataKeys: Object.keys(decoded?.leaf?.appdata ?? {}),
});

const REDACTED_VALUE = "<redacted>";
const REDACTED_BEARER = "<redacted:bearer>";
const REDACTED_JWT = "<redacted:jwt>";
const REDACTED_TOKENISH = "<redacted:tokenish>";
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|token|secret|password|passphrase|api[_-]?key|x[-_]api[-_]key|session|credential|signature|jwt)/i;

const redactString = (value) => {
  if (/^\s*bearer\s+/i.test(value)) return REDACTED_BEARER;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return REDACTED_JWT;
  if (/^[A-Za-z0-9+/_=-]{40,}$/.test(value)) return REDACTED_TOKENISH;
  return value;
};

const redactPayload = (value, parentKey = "") => {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactPayload(entry, parentKey));
  }

  if (typeof value === "string") {
    if (SENSITIVE_KEY_PATTERN.test(parentKey)) return REDACTED_VALUE;
    return redactString(value);
  }

  if (typeof value !== "object") return value;

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    output[key] = redactPayload(nested, key);
  }
  return output;
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
const payload = JSON.parse(await readFile(graphPath, "utf8"));
const graph = extractGraph(payload);

if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
  throw new Error("graph payload must contain a runtime DTO nodes array");
}

const edges = [];
const nodeTypeCounts = {};
const edgeTypeCounts = {};
const nodeDecodeErrors = [];
const edgeDecodeErrors = [];
const nodeIndex = new Map();
const edgeIndex = new Map();

for (const [index, node] of graph.nodes.entries()) {
  const uuid = node?.uuid;
  const leafnodetype = node?.leafnodetype;
  if (typeof uuid === "string" && uuid.length > 0) {
    nodeIndex.set(uuid, { index, node });
  }

  try {
    const decoded = decodeBase64Json(node?.data, `nodes[${index}].data`);
    increment(nodeTypeCounts, decoded?.leaf?.logic?.type ?? leafnodetype);
  } catch (error) {
    increment(nodeTypeCounts, leafnodetype);
    nodeDecodeErrors.push({ index, uuid: uuid ?? null, error: error.message });
  }

  for (const [edgeOffset, edge] of (node?.out_edges ?? []).entries()) {
    edges.push(edge);
    if (typeof edge?.uuid === "string" && edge.uuid.length > 0) {
      edgeIndex.set(edge.uuid, { edge, index: edges.length - 1 });
    }
    try {
      const decodedEdge = decodeBase64Json(edge?.data, `nodes[${index}].out_edges[${edgeOffset}].data`);
      increment(edgeTypeCounts, decodedEdge?.leaf?.logic?.type);
    } catch (error) {
      increment(edgeTypeCounts, null);
      edgeDecodeErrors.push({
        ownerNode: uuid ?? null,
        edgeUuid: edge?.uuid ?? null,
        error: error.message,
      });
    }
  }
}

const targetNodeUuids = options.all ? [...nodeIndex.keys()] : options.nodeFilters;
const targetEdgeUuids = options.all ? [...edgeIndex.keys()] : options.edgeFilters;

const decodedNodes = [];
const missingNodeUuids = [];
for (const targetUuid of targetNodeUuids) {
  const entry = nodeIndex.get(targetUuid);
  if (!entry) {
    missingNodeUuids.push(targetUuid);
    continue;
  }
  const { node, index } = entry;
  try {
    const decoded = decodeBase64Json(node?.data, `nodes[${index}].data`);
    const outputDecoded = options.redact ? redactPayload(decoded) : decoded;
    decodedNodes.push({
      uuid: node.uuid,
      leafnodetype: node.leafnodetype ?? null,
      summary: summarizePayload(outputDecoded, node.leafnodetype ?? null),
      decoded: options.full ? outputDecoded : undefined,
    });
  } catch (error) {
    decodedNodes.push({
      uuid: node?.uuid ?? null,
      leafnodetype: node?.leafnodetype ?? null,
      error: error.message,
    });
  }
}

const decodedEdges = [];
const missingEdgeUuids = [];
for (const targetUuid of targetEdgeUuids) {
  const entry = edgeIndex.get(targetUuid);
  if (!entry) {
    missingEdgeUuids.push(targetUuid);
    continue;
  }
  const { edge } = entry;
  try {
    const decoded = decodeBase64Json(edge?.data, `edge ${targetUuid} data`);
    const outputDecoded = options.redact ? redactPayload(decoded) : decoded;
    decodedEdges.push({
      uuid: edge.uuid,
      source: edge?.source?.uuid ?? null,
      target: edge?.target?.uuid ?? null,
      summary: summarizePayload(outputDecoded, null),
      decoded: options.full ? outputDecoded : undefined,
    });
  } catch (error) {
    decodedEdges.push({
      uuid: edge?.uuid ?? null,
      source: edge?.source?.uuid ?? null,
      target: edge?.target?.uuid ?? null,
      error: error.message,
    });
  }
}

const output = {
  file: graphPath,
  graph: {
    domain: graph.domain ?? null,
    appid: graph.appid ?? null,
    nodeCount: graph.nodes.length,
    edgeCount: edges.length,
  },
  typeCounts: {
    node: nodeTypeCounts,
    edge: edgeTypeCounts,
  },
    decodeErrors: {
      node: nodeDecodeErrors,
      edge: edgeDecodeErrors,
    },
    redactApplied: options.redact,
    selected: {
      nodes: decodedNodes,
      edges: decodedEdges,
    missingNodeUuids,
    missingEdgeUuids,
  },
};

if (options.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`Graph: ${output.file}`);
  console.log(`Domain/App: ${output.graph.domain ?? "<missing>"}/${output.graph.appid ?? "<missing>"}`);
  console.log(`Nodes/Edges: ${output.graph.nodeCount}/${output.graph.edgeCount}`);
  console.log(`Node types: ${JSON.stringify(output.typeCounts.node)}`);
  console.log(`Edge types: ${JSON.stringify(output.typeCounts.edge)}`);
  if (output.selected.nodes.length > 0) {
    console.log("Selected nodes:");
    for (const item of output.selected.nodes) {
      if (item.error) {
        console.log(`  ${item.uuid ?? "<missing>"}: error=${item.error}`);
        continue;
      }
      console.log(
        `  ${item.uuid}: logic=${item.summary.logicType} args=[${item.summary.argKeys.join(",",
        )}] appdata=[${item.summary.appdataKeys.join(",")}]`,
      );
    }
  }
  if (output.selected.edges.length > 0) {
    console.log("Selected edges:");
    for (const item of output.selected.edges) {
      if (item.error) {
        console.log(`  ${item.uuid ?? "<missing>"}: error=${item.error}`);
        continue;
      }
      console.log(
        `  ${item.uuid}: ${item.source ?? "<missing>"} -> ${item.target ?? "<missing>"} logic=${item.summary.logicType}`,
      );
    }
  }
  if (output.selected.missingNodeUuids.length > 0) {
    console.log(`Missing nodes: ${output.selected.missingNodeUuids.join(", ")}`);
  }
  if (output.selected.missingEdgeUuids.length > 0) {
    console.log(`Missing edges: ${output.selected.missingEdgeUuids.join(", ")}`);
  }
  if (output.decodeErrors.node.length > 0 || output.decodeErrors.edge.length > 0) {
    console.log(
      `Decode errors: nodes=${output.decodeErrors.node.length}, edges=${output.decodeErrors.edge.length}`,
    );
  }
  if (!options.all && options.nodeFilters.length === 0 && options.edgeFilters.length === 0) {
    console.log("Tip: add --node <uuid>, --edge <uuid>, or --all to decode payload details.");
  }
  if (options.full && !options.redact) {
    console.log("Tip: add --redact when sharing full decoded payloads.");
  }
}
