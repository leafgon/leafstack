#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import {
  layoutLeafGraph,
  leafOperationChangesTopology,
  normalizeLeafForceLayoutOptions,
} from "./lib/leaf-force-layout.mjs";

const DEFAULT_ENDPOINT = "https://www.leafgon.com/qmgraphql";
const FORMAT = "leaf.graph-batch.v1";
const NAME_PATTERN = /^[A-Za-z0-9-]+$/;

const QUERIES = {
  addNode: `mutation AddNode($uuid: String!, $leafnodetype: String, $data: String!, $graphdomain: String!, $graphappid: String!, $provdomain: String!, $provappid: String!) {
    addNode(input: [{uuid: $uuid, leafnodetype: $leafnodetype, graph: {domain: $graphdomain, appid: $graphappid}, provenance: {domain: $provdomain, appid: $provappid}, data: $data}]) {node {uuid}}
  }`,
  deleteNode: `mutation DeleteNode($uuid: String!) {
    deleteNode(nfilter: {uuid: {eq: $uuid}}) {node {uuid}}
  }`,
  addEdge: `mutation AddEdge($uuid: String!, $sourceuuid: String!, $targetuuid: String!, $data: String!, $graphdomain: String!, $graphappid: String!, $provdomain: String!, $provappid: String!) {
    addEdge(input: [{uuid: $uuid, source: {uuid: $sourceuuid}, target: {uuid: $targetuuid}, graph: {domain: $graphdomain, appid: $graphappid}, provenance: {domain: $provdomain, appid: $provappid}, data: $data}]) {edge {uuid}}
  }`,
  deleteEdge: `mutation DeleteEdge($uuid: String!) {
    deleteEdge(efilter: {uuid: {eq: $uuid}}) {edge {uuid}}
  }`,
};

const usage = () => {
  console.error(`usage: leaf-graph-batch.mjs <batch.json> [options]

Default: validate and simulate against local graph files without writing.

Options:
  --write-local             atomically write simulated local graph files
  --apply                   apply ordered operations to leaf-server
  --resume                  with --apply, skip exact already-persisted additions
  --sync-local              after --apply, write authoritative re-queries locally
  --confirm <sha256:...>    required for --write-local and --apply
  --endpoint <url>          defaults to ${DEFAULT_ENDPOINT}
  --confirm-endpoint <url>  required for --apply; must equal --endpoint
  --token-env <name>        bearer-token environment variable (default LEAFGON_API_TOKEN)`);
};

const parseArgs = (argv) => {
  const options = {
    endpoint: DEFAULT_ENDPOINT,
    tokenEnv: "LEAFGON_API_TOKEN",
    apply: false,
    resume: false,
    syncLocal: false,
    writeLocal: false,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--resume") options.resume = true;
    else if (argument === "--sync-local") options.syncLocal = true;
    else if (argument === "--write-local") options.writeLocal = true;
    else if (
      ["--confirm", "--endpoint", "--confirm-endpoint", "--token-env"].includes(
        argument,
      )
    ) {
      if (index + 1 >= argv.length)
        throw new Error(`missing value for ${argument}`);
      const value = argv[index + 1];
      if (argument === "--confirm") options.confirm = value;
      if (argument === "--endpoint") options.endpoint = value;
      if (argument === "--confirm-endpoint") options.confirmEndpoint = value;
      if (argument === "--token-env") options.tokenEnv = value;
      index += 1;
    } else if (argument.startsWith("--"))
      throw new Error(`unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length !== 1)
    throw new Error("provide exactly one batch JSON file");
  if (options.syncLocal && !options.apply)
    throw new Error("--sync-local requires --apply");
  if (options.resume && !options.apply)
    throw new Error("--resume requires --apply");
  if (options.writeLocal && options.apply) {
    throw new Error("use --sync-local, not --write-local, with --apply");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.tokenEnv)) {
    throw new Error("--token-env must be an environment-variable name");
  }
  options.batchFile = resolve(positional[0]);
  return options;
};

const graphKey = (domain, appid) => `${domain}/${appid}`;
const clone = (value) => structuredClone(value);
const sorted = (values) =>
  [...values].sort((left, right) => left.localeCompare(right));

const requireString = (value, label) => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
};

const requireNamespace = (value, label) => {
  requireString(value, label);
  if (!NAME_PATTERN.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, and hyphens`);
  }
  return value;
};

const decodeData = (encoded, label) => {
  requireString(encoded, label);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new Error(`${label} is not base64`);
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error(`${label} must contain base64-encoded JSON`);
  }
};

const encodeData = (value, label) => {
  if (typeof value === "string") {
    decodeData(value, label);
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `${label} must be decoded JSON object data or an encoded string`,
    );
  }
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
};

const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};

const comparableNodeData = (encoded) => {
  const payload = decodeData(encoded, "node.data");
  if (payload?.leaf?.logic?.type === "leaflisp") delete payload.leaf.object;
  return canonicalJson(payload);
};

const normalizeRef = (value, label) => {
  const uuid = typeof value === "string" ? value : value?.uuid;
  return { uuid: requireString(uuid, label) };
};

const normalizeNode = (node, label) => {
  if (!node || typeof node !== "object" || Array.isArray(node))
    throw new Error(`${label} must be an object`);
  if (
    node.out_edges &&
    (!Array.isArray(node.out_edges) || node.out_edges.length > 0)
  ) {
    throw new Error(
      `${label}.out_edges must be omitted or empty; add edges with addEdge`,
    );
  }
  return {
    uuid: requireString(node.uuid, `${label}.uuid`),
    leafnodetype: requireString(node.leafnodetype, `${label}.leafnodetype`),
    data: encodeData(node.data, `${label}.data`),
    out_edges: [],
  };
};

const normalizeEdge = (edge, label) => {
  if (!edge || typeof edge !== "object" || Array.isArray(edge))
    throw new Error(`${label} must be an object`);
  return {
    uuid: requireString(edge.uuid, `${label}.uuid`),
    source: normalizeRef(edge.source, `${label}.source`),
    target: normalizeRef(edge.target, `${label}.target`),
    data: encodeData(edge.data, `${label}.data`),
  };
};

const unwrapGraph = (document) =>
  document?.data?.graph ?? document?.graph ?? document;

const flattenEdges = (graph) => graph.nodes.flatMap((node) => node.out_edges);

const validateGraphSet = (graphs, label) => {
  const nodeOwners = new Map();
  const edgeOwners = new Map();
  for (const [key, graph] of graphs) {
    for (const node of graph.nodes) {
      if (nodeOwners.has(node.uuid)) {
        throw new Error(
          `${label} node UUID ${node.uuid} appears in both ${nodeOwners.get(node.uuid)} and ${key}`,
        );
      }
      nodeOwners.set(node.uuid, key);
    }
    for (const edge of flattenEdges(graph)) {
      if (edgeOwners.has(edge.uuid)) {
        throw new Error(
          `${label} edge UUID ${edge.uuid} appears in both ${edgeOwners.get(edge.uuid)} and ${key}`,
        );
      }
      edgeOwners.set(edge.uuid, key);
    }
  }
};

const validateGraph = (graph, expected, label) => {
  if (!graph || typeof graph !== "object" || Array.isArray(graph))
    throw new Error(`${label} must contain a graph object`);
  if (graph.domain !== expected.domain || graph.appid !== expected.appid) {
    throw new Error(
      `${label} address does not match ${graphKey(expected.domain, expected.appid)}`,
    );
  }
  if (!Array.isArray(graph.nodes))
    throw new Error(`${label}.nodes must be an array`);
  const nodeIds = new Set();
  const edgeIds = new Set();
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    const nodeLabel = `${label}.nodes[${nodeIndex}]`;
    requireString(node.uuid, `${nodeLabel}.uuid`);
    if (nodeIds.has(node.uuid))
      throw new Error(`${label} has duplicate node UUID ${node.uuid}`);
    nodeIds.add(node.uuid);
    requireString(node.leafnodetype, `${nodeLabel}.leafnodetype`);
    const nodeData = decodeData(node.data, `${nodeLabel}.data`);
    if (nodeData?.leaf?.logic?.type !== node.leafnodetype) {
      throw new Error(
        `${nodeLabel} leafnodetype does not match decoded leaf.logic.type`,
      );
    }
    if (!Array.isArray(node.out_edges))
      throw new Error(`${nodeLabel}.out_edges must be an array`);
  }
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    for (const [edgeIndex, edge] of node.out_edges.entries()) {
      const edgeLabel = `${label}.nodes[${nodeIndex}].out_edges[${edgeIndex}]`;
      requireString(edge.uuid, `${edgeLabel}.uuid`);
      if (edgeIds.has(edge.uuid))
        throw new Error(`${label} has duplicate edge UUID ${edge.uuid}`);
      edgeIds.add(edge.uuid);
      const source = normalizeRef(edge.source, `${edgeLabel}.source`).uuid;
      const target = normalizeRef(edge.target, `${edgeLabel}.target`).uuid;
      if (source !== node.uuid)
        throw new Error(`${edgeLabel} must be nested under its source node`);
      if (!nodeIds.has(target))
        throw new Error(`${edgeLabel} targets missing node ${target}`);
      const edgeData = decodeData(edge.data, `${edgeLabel}.data`);
      if (
        !new Set(["leafdataedge", "leaflambdaedge", "leafanchoredge"]).has(
          edgeData?.leaf?.logic?.type,
        )
      ) {
        throw new Error(`${edgeLabel} has unsupported decoded edge type`);
      }
    }
  }
  return graph;
};

const normalizeOperation = (operation, index, graphSpecs) => {
  const label = `operations[${index}]`;
  if (!operation || typeof operation !== "object" || Array.isArray(operation))
    throw new Error(`${label} must be an object`);
  const domain = requireNamespace(operation.domain, `${label}.domain`);
  const appid = requireNamespace(operation.appid, `${label}.appid`);
  const key = graphKey(domain, appid);
  if (!graphSpecs.has(key))
    throw new Error(`${label} references undeclared graph ${key}`);
  const normalized = {
    op: requireString(operation.op, `${label}.op`),
    domain,
    appid,
  };
  if (normalized.op === "addNode")
    normalized.node = normalizeNode(operation.node, `${label}.node`);
  else if (normalized.op === "updateNode") {
    normalized.uuid = requireString(operation.uuid, `${label}.uuid`);
    const set = operation.set;
    if (!set || typeof set !== "object" || Array.isArray(set))
      throw new Error(`${label}.set must be an object`);
    normalized.set = {};
    if (Object.hasOwn(set, "data"))
      normalized.set.data = encodeData(set.data, `${label}.set.data`);
    if (Object.hasOwn(set, "leafnodetype")) {
      normalized.set.leafnodetype = requireString(
        set.leafnodetype,
        `${label}.set.leafnodetype`,
      );
    }
    if (Object.keys(normalized.set).length === 0)
      throw new Error(`${label}.set is empty`);
  } else if (normalized.op === "deleteNode" || normalized.op === "deleteEdge") {
    normalized.uuid = requireString(operation.uuid, `${label}.uuid`);
  } else if (normalized.op === "addEdge")
    normalized.edge = normalizeEdge(operation.edge, `${label}.edge`);
  else throw new Error(`${label}.op is unsupported: ${normalized.op}`);

  const provenance = operation.node?.provenance ?? operation.edge?.provenance;
  normalized.provenance = {
    domain: provenance?.domain ?? domain,
    appid: provenance?.appid ?? appid,
  };
  requireNamespace(normalized.provenance.domain, `${label}.provenance.domain`);
  requireNamespace(normalized.provenance.appid, `${label}.provenance.appid`);
  return normalized;
};

const applyOperation = (graph, operation) => {
  const findNode = (uuid) => graph.nodes.find((node) => node.uuid === uuid);
  if (operation.op === "addNode") {
    if (findNode(operation.node.uuid))
      throw new Error(
        `${graphKey(operation.domain, operation.appid)} already has node ${operation.node.uuid}`,
      );
    graph.nodes.push(clone(operation.node));
  } else if (operation.op === "updateNode") {
    const node = findNode(operation.uuid);
    if (!node)
      throw new Error(
        `${graphKey(operation.domain, operation.appid)} has no node ${operation.uuid}`,
      );
    Object.assign(node, operation.set);
  } else if (operation.op === "deleteNode") {
    if (!findNode(operation.uuid))
      throw new Error(
        `${graphKey(operation.domain, operation.appid)} has no node ${operation.uuid}`,
      );
    graph.nodes = graph.nodes.filter((node) => node.uuid !== operation.uuid);
    for (const node of graph.nodes) {
      node.out_edges = node.out_edges.filter(
        (edge) =>
          edge.source.uuid !== operation.uuid &&
          edge.target.uuid !== operation.uuid,
      );
    }
  } else if (operation.op === "addEdge") {
    if (flattenEdges(graph).some((edge) => edge.uuid === operation.edge.uuid)) {
      throw new Error(
        `${graphKey(operation.domain, operation.appid)} already has edge ${operation.edge.uuid}`,
      );
    }
    const source = findNode(operation.edge.source.uuid);
    if (!source || !findNode(operation.edge.target.uuid)) {
      throw new Error(
        `${graphKey(operation.domain, operation.appid)} addEdge endpoints must exist locally`,
      );
    }
    source.out_edges.push(clone(operation.edge));
  } else if (operation.op === "deleteEdge") {
    const owner = graph.nodes.find((node) =>
      node.out_edges.some((edge) => edge.uuid === operation.uuid),
    );
    if (!owner)
      throw new Error(
        `${graphKey(operation.domain, operation.appid)} has no edge ${operation.uuid}`,
      );
    owner.out_edges = owner.out_edges.filter(
      (edge) => edge.uuid !== operation.uuid,
    );
  }
};

const operationSummary = (operation) => ({
  op: operation.op,
  graph: graphKey(operation.domain, operation.appid),
  uuid: operation.node?.uuid ?? operation.edge?.uuid ?? operation.uuid,
});

const loadManifest = async (batchFile) => {
  const raw = await readFile(batchFile, "utf8");
  const manifest = JSON.parse(raw);
  if (manifest.format !== FORMAT)
    throw new Error(`batch format must be ${FORMAT}`);
  if (!Array.isArray(manifest.graphs) || manifest.graphs.length === 0)
    throw new Error("graphs must be a non-empty array");
  if (!Array.isArray(manifest.operations) || manifest.operations.length === 0)
    throw new Error("operations must be a non-empty array");
  const baseDirectory = dirname(batchFile);
  const graphSpecs = new Map();
  const graphFiles = new Set();
  for (const [index, item] of manifest.graphs.entries()) {
    const domain = requireNamespace(item?.domain, `graphs[${index}].domain`);
    const appid = requireNamespace(item?.appid, `graphs[${index}].appid`);
    const file = requireString(item?.file, `graphs[${index}].file`);
    if (extname(file).toLowerCase() !== ".json")
      throw new Error(`graphs[${index}].file must end in .json`);
    const key = graphKey(domain, appid);
    if (graphSpecs.has(key)) throw new Error(`duplicate graph address ${key}`);
    const resolvedFile = resolve(baseDirectory, file);
    if (graphFiles.has(resolvedFile))
      throw new Error(`multiple graph addresses use ${resolvedFile}`);
    graphFiles.add(resolvedFile);
    const layout = Object.hasOwn(item, "layout")
      ? normalizeLeafForceLayoutOptions(item.layout, `graphs[${index}].layout`)
      : undefined;
    graphSpecs.set(key, {
      domain,
      appid,
      file: resolvedFile,
      create: item.create === true,
      layout,
    });
  }
  const operations = manifest.operations.map((operation, index) =>
    normalizeOperation(operation, index, graphSpecs),
  );
  return {
    digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    graphSpecs,
    operations,
  };
};

const loadLocalGraphs = async (graphSpecs) => {
  const graphs = new Map();
  for (const [key, spec] of graphSpecs) {
    let graph;
    try {
      graph = unwrapGraph(JSON.parse(await readFile(spec.file, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT" && spec.create)
        graph = { domain: spec.domain, appid: spec.appid, nodes: [] };
      else throw error;
    }
    graphs.set(key, validateGraph(graph, spec, spec.file));
  }
  validateGraphSet(graphs, "local graph set");
  return graphs;
};

const simulate = (sourceGraphs, graphSpecs, operations) => {
  const graphs = new Map(
    [...sourceGraphs].map(([key, graph]) => [key, clone(graph)]),
  );
  const layoutEvents = [];
  for (const [operationIndex, operation] of operations.entries()) {
    const key = graphKey(operation.domain, operation.appid);
    applyOperation(graphs.get(key), operation);
    const layout = graphSpecs.get(key).layout;
    if (layout && leafOperationChangesTopology(operation)) {
      const result = layoutLeafGraph(graphs.get(key), layout);
      graphs.set(key, result.graph);
      layoutEvents.push({
        operation: operationIndex,
        graph: key,
        changedNodes: result.changedNodeUuids.length,
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount,
        overlapCount: result.overlapCount,
        edgeCrossingCount: result.edgeCrossingCount,
        sharedSegmentCount: result.sharedSegmentCount,
        edgeEdgeProximityCount: result.edgeEdgeProximityCount,
        edgeNodeIntersectionCount: result.edgeNodeIntersectionCount,
        edgeNodeProximityCount: result.edgeNodeProximityCount,
        minimumEdgeDistance: result.minimumEdgeDistance,
      });
    }
    validateGraph(graphs.get(key), graphSpecs.get(key), key);
    validateGraphSet(graphs, "simulated graph set");
  }
  return { graphs, layoutEvents };
};

const writeGraphs = async (graphs, graphSpecs) => {
  for (const [key, graph] of graphs) {
    const destination = graphSpecs.get(key).file;
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, destination);
  }
};

const validateEndpoint = (endpoint) => {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "leaf-server endpoint must not contain credentials, query parameters, or fragments",
    );
  }
  const local = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      "leaf-server endpoint must use HTTPS unless it is local test infrastructure",
    );
  }
  if (!url.pathname.endsWith("/qmgraphql"))
    throw new Error("leaf-server endpoint must end in /qmgraphql");
  return url.toString();
};

const postGraphql = async (endpoint, token, query, variables) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    redirect: "error",
  });
  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new Error(`leaf-server returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok)
    throw new Error(`leaf-server returned HTTP ${response.status}`);
  if (Object.hasOwn(envelope, "error"))
    throw new Error("leaf-server returned an application error");
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    throw new Error(
      `leaf-server returned ${envelope.errors.length} GraphQL error(s)`,
    );
  }
  if (!envelope.data || typeof envelope.data !== "object")
    throw new Error("leaf-server response has no data object");
  return envelope;
};

const queryRemoteGraph = async (endpoint, token, spec) => {
  const query = `query {
    graph: getGraph(domain: ${JSON.stringify(spec.domain)}, appid: ${JSON.stringify(spec.appid)}, filter: {}) {
      domain appid nodes { uuid leafnodetype data out_edges { uuid source { uuid } target { uuid } data } }
    }
  }`;
  const envelope = await postGraphql(endpoint, token, query, {});
  const graph = envelope.data.graph ?? {
    domain: spec.domain,
    appid: spec.appid,
    nodes: [],
  };
  return validateGraph(graph, spec, graphKey(spec.domain, spec.appid));
};

const updateQuery = (set) => {
  const declarations = ["$uuid: String!"];
  const fields = [];
  if (Object.hasOwn(set, "data")) {
    declarations.push("$data: String");
    fields.push("data: $data");
  }
  if (Object.hasOwn(set, "leafnodetype")) {
    declarations.push("$leafnodetype: String");
    fields.push("leafnodetype: $leafnodetype");
  }
  return `mutation UpdateNode(${declarations.join(", ")}) {
    updateNode(input: {filter: {uuid: {eq: $uuid}}, set: {${fields.join(", ")}}}) {node {uuid} numUids}
  }`;
};

const responseIds = (envelope, operation) => {
  const field = operation.op;
  const payload = envelope.data[field];
  const records = payload?.[operation.op.includes("Edge") ? "edge" : "node"];
  if (!Array.isArray(records)) {
    if (operation.op === "updateNode" && payload?.numUids === 1) {
      return [operation.uuid];
    }
    throw new Error(`${operation.op} response has no record list`);
  }
  return records
    .map((record) => record?.uuid)
    .filter((uuid) => typeof uuid === "string");
};

const matchingPersistedEdgeIds = (graph, operation) =>
  flattenEdges(graph)
    .filter(
      (edge) =>
        edge.source.uuid === operation.edge.source.uuid &&
        edge.target.uuid === operation.edge.target.uuid &&
        edge.data === operation.edge.data,
    )
    .map(({ uuid }) => uuid);

const authoritativeAdditionId = (graph, operation) => {
  if (operation.op === "addNode") {
    const node = graph.nodes.find(({ uuid }) => uuid === operation.node.uuid);
    if (!node) return null;
    if (
      node.leafnodetype !== operation.node.leafnodetype ||
      comparableNodeData(node.data) !== comparableNodeData(operation.node.data)
    ) {
      throw new Error(`addNode UUID ${operation.node.uuid} already has different data`);
    }
    return node.uuid;
  }
  if (operation.op === "addEdge") {
    const matches = matchingPersistedEdgeIds(graph, operation);
    if (matches.length > 1)
      throw new Error(`addEdge ${operation.edge.uuid} has ambiguous persisted matches`);
    return matches[0] ?? null;
  }
  return null;
};

const authoritativeCompletedOperationId = (graph, operation) => {
  const additionId = authoritativeAdditionId(graph, operation);
  if (additionId) return additionId;
  if (operation.op === "updateNode") {
    const node = graph.nodes.find((candidate) => candidate.uuid === operation.uuid);
    const matches =
      node &&
      Object.entries(operation.set).every(
        ([key, value]) =>
          key === "data"
            ? comparableNodeData(node.data) === comparableNodeData(value)
            : JSON.stringify(node[key]) === JSON.stringify(value),
      );
    return matches ? operation.uuid : null;
  }
  if (operation.op === "deleteNode") {
    return graph.nodes.some(({ uuid }) => uuid === operation.uuid)
      ? null
      : operation.uuid;
  }
  if (operation.op === "deleteEdge") {
    return flattenEdges(graph).some(({ uuid }) => uuid === operation.uuid)
      ? null
      : operation.uuid;
  }
  return null;
};

const executeRemoteOperation = async (
  endpoint,
  token,
  operation,
  edgeUuidMap,
) => {
  let query = QUERIES[operation.op];
  let variables;
  if (operation.op === "addNode") {
    variables = {
      uuid: operation.node.uuid,
      leafnodetype: operation.node.leafnodetype,
      data: operation.node.data,
      graphdomain: operation.domain,
      graphappid: operation.appid,
      provdomain: operation.provenance.domain,
      provappid: operation.provenance.appid,
    };
  } else if (operation.op === "updateNode") {
    query = updateQuery(operation.set);
    variables = { uuid: operation.uuid, ...operation.set };
  } else if (operation.op === "deleteNode")
    variables = { uuid: operation.uuid };
  else if (operation.op === "addEdge") {
    variables = {
      uuid: operation.edge.uuid,
      sourceuuid: operation.edge.source.uuid,
      targetuuid: operation.edge.target.uuid,
      data: operation.edge.data,
      graphdomain: operation.domain,
      graphappid: operation.appid,
      provdomain: operation.provenance.domain,
      provappid: operation.provenance.appid,
    };
  } else if (operation.op === "deleteEdge") {
    variables = { uuid: edgeUuidMap.get(operation.uuid) ?? operation.uuid };
  }
  const envelope = await postGraphql(endpoint, token, query, variables);
  let ids;
  let acknowledgement = "mutation-response";
  try {
    ids = responseIds(envelope, operation);
  } catch (error) {
    const graph = await queryRemoteGraph(endpoint, token, operation);
    if (operation.op === "addNode" || operation.op === "addEdge") {
      const persistedId = authoritativeAdditionId(graph, operation);
      if (!persistedId) throw error;
      ids = [persistedId];
    } else if (operation.op === "updateNode") {
      const node = graph.nodes.find((candidate) => candidate.uuid === operation.uuid);
      const matches =
        node &&
        Object.entries(operation.set).every(
          ([key, value]) =>
            key === "data"
              ? comparableNodeData(node.data) === comparableNodeData(value)
              : JSON.stringify(node[key]) === JSON.stringify(value),
        );
      if (!matches) throw error;
      ids = [operation.uuid];
    } else if (operation.op === "deleteNode") {
      if (graph.nodes.some(({ uuid }) => uuid === operation.uuid)) throw error;
      ids = [operation.uuid];
    } else if (operation.op === "deleteEdge") {
      if (flattenEdges(graph).some(({ uuid }) => uuid === variables.uuid)) throw error;
      ids = [variables.uuid];
    } else throw error;
    acknowledgement = "authoritative-requery";
  }
  if (ids.length === 0) throw new Error(`${operation.op} returned no UUID`);
  if (operation.op === "addNode" && !ids.includes(operation.node.uuid)) {
    throw new Error(
      `addNode did not return requested UUID ${operation.node.uuid}`,
    );
  }
  if (operation.op === "updateNode" && !ids.includes(operation.uuid)) {
    throw new Error(`updateNode did not return target UUID ${operation.uuid}`);
  }
  if (operation.op === "deleteNode" && !ids.includes(operation.uuid)) {
    throw new Error(`deleteNode did not return target UUID ${operation.uuid}`);
  }
  if (operation.op === "addEdge") edgeUuidMap.set(operation.edge.uuid, ids[0]);
  if (operation.op === "deleteEdge" && !ids.includes(variables.uuid)) {
    throw new Error(`deleteEdge did not return target UUID ${variables.uuid}`);
  }
  return {
    ...operationSummary(operation),
    persistedUuid: ids[0],
    acknowledgement,
    leafEventCount: envelope.extensions?.leafEvents?.length ?? 0,
  };
};

const replaceExpectedEdgeIds = (graphs, edgeUuidMap) => {
  for (const graph of graphs.values()) {
    for (const edge of flattenEdges(graph))
      edge.uuid = edgeUuidMap.get(edge.uuid) ?? edge.uuid;
  }
};

const nodeProjection = (graph) =>
  new Map(
    graph.nodes.map((node) => [
      node.uuid,
      {
        uuid: node.uuid,
        leafnodetype: node.leafnodetype,
        data: comparableNodeData(node.data),
      },
    ]),
  );

const edgeProjection = (graph) =>
  new Map(flattenEdges(graph).map((edge) => [edge.uuid, edge]));

const assertChangedProjection = (before, expected, actual, key, tracked) => {
  for (const [kind, projector] of [
    ["nodes", nodeProjection],
    ["edges", edgeProjection],
  ]) {
    const beforeMap = projector(before);
    const expectedMap = projector(expected);
    const actualMap = projector(actual);
    const ids = new Set([
      ...beforeMap.keys(),
      ...expectedMap.keys(),
      ...tracked[kind],
    ]);
    for (const id of ids) {
      if (
        JSON.stringify(beforeMap.get(id)) ===
        JSON.stringify(expectedMap.get(id))
      )
        continue;
      if (
        JSON.stringify(expectedMap.get(id)) !==
        JSON.stringify(actualMap.get(id))
      ) {
        throw new Error(
          `authoritative verification failed for ${key} object ${id}`,
        );
      }
    }
  }
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
  const batch = await loadManifest(options.batchFile);
  const layoutGraphs = sorted(
    [...batch.graphSpecs].filter(([, spec]) => spec.layout).map(([key]) => key),
  );
  if (options.apply && layoutGraphs.length > 0) {
    throw new Error(
      `force-directed layout is local-only; remove layout from ${layoutGraphs.join(", ")} before --apply`,
    );
  }
  const mutationMode = options.writeLocal || options.apply;
  if (mutationMode && options.confirm !== batch.digest) {
    throw new Error(
      `confirmation mismatch; review the plan and pass --confirm ${batch.digest}`,
    );
  }

  if (!options.apply) {
    const localGraphs = await loadLocalGraphs(batch.graphSpecs);
    const simulation = simulate(
      localGraphs,
      batch.graphSpecs,
      batch.operations,
    );
    if (options.writeLocal)
      await writeGraphs(simulation.graphs, batch.graphSpecs);
    console.log(
      JSON.stringify(
        {
          format: FORMAT,
          mode: options.writeLocal ? "local-write" : "local-plan",
          confirmation: batch.digest,
          graphs: sorted(batch.graphSpecs.keys()),
          operations: batch.operations.map(operationSummary),
          layouts: simulation.layoutEvents,
        },
        null,
        2,
      ),
    );
  } else {
    const endpoint = validateEndpoint(options.endpoint);
    if (
      !options.confirmEndpoint ||
      validateEndpoint(options.confirmEndpoint) !== endpoint
    ) {
      throw new Error(
        `confirm the live target with --confirm-endpoint ${endpoint}`,
      );
    }
    const token = process.env[options.tokenEnv];
    if (typeof token !== "string" || token.length === 0)
      throw new Error(`missing bearer token in ${options.tokenEnv}`);
    const before = new Map();
    for (const [key, spec] of batch.graphSpecs)
      before.set(key, await queryRemoteGraph(endpoint, token, spec));
    validateGraphSet(before, "authoritative graph set");
    const edgeUuidMap = new Map();
    const acknowledgements = [];
    const pendingOperations = [];
    for (const operation of batch.operations) {
      const key = graphKey(operation.domain, operation.appid);
      const persistedId = options.resume
        ? authoritativeCompletedOperationId(before.get(key), operation)
        : null;
      if (!persistedId) {
        pendingOperations.push(operation);
        continue;
      }
      if (operation.op === "addEdge")
        edgeUuidMap.set(operation.edge.uuid, persistedId);
      acknowledgements.push({
        ...operationSummary(operation),
        persistedUuid: persistedId,
        acknowledgement: "authoritative-preexisting",
        leafEventCount: 0,
      });
    }
    const expected = simulate(
      before,
      batch.graphSpecs,
      pendingOperations,
    ).graphs;
    for (const operation of pendingOperations) {
      try {
        acknowledgements.push(
          await executeRemoteOperation(endpoint, token, operation, edgeUuidMap),
        );
      } catch (error) {
        const summary = operationSummary(operation);
        throw new Error(
          `batch stopped at ${summary.op} ${summary.graph} ${summary.uuid} after ${acknowledgements.length} acknowledgement(s): ${error.message}`,
        );
      }
    }
    replaceExpectedEdgeIds(expected, edgeUuidMap);
    const tracked = { nodes: new Set(), edges: new Set() };
    for (const operation of batch.operations) {
      if (operation.op.endsWith("Node")) {
        tracked.nodes.add(operation.node?.uuid ?? operation.uuid);
      } else {
        const uuid = operation.edge?.uuid ?? operation.uuid;
        tracked.edges.add(uuid);
        tracked.edges.add(edgeUuidMap.get(uuid) ?? uuid);
      }
    }
    const authoritative = new Map();
    for (const [key, spec] of batch.graphSpecs) {
      const graph = await queryRemoteGraph(endpoint, token, spec);
      authoritative.set(key, graph);
      assertChangedProjection(
        before.get(key),
        expected.get(key),
        graph,
        key,
        tracked,
      );
    }
    if (options.syncLocal) await writeGraphs(authoritative, batch.graphSpecs);
    console.log(
      JSON.stringify(
        {
          format: FORMAT,
          mode: options.syncLocal ? "remote-apply-and-sync" : "remote-apply",
          confirmation: batch.digest,
          endpoint,
          graphs: sorted(batch.graphSpecs.keys()),
          acknowledgements,
          verified: true,
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(1);
}
