export const extractGraph = (payload) => payload?.data?.graph ?? payload?.graph ?? payload;

export const encodeBase64Json = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

export const decodeBase64Json = (encoded, label = "base64-json") => {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error(`${label} must be a non-empty base64 string`);
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (error) {
    throw new Error(`${label} is not valid base64 (${error.message})`);
  }

  try {
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${error.message})`);
  }
};

export const isDeclarativeGraphShape = (graph) => {
  if (!graph || typeof graph !== "object") return false;
  if (typeof graph.kind === "string" && graph.kind.trim().toLowerCase() === "leaf-graph") return true;
  if (Object.hasOwn(graph, "inputs") || Object.hasOwn(graph, "outputs")) return true;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  return nodes.some(
    (node) =>
      node
      && typeof node === "object"
      && Object.hasOwn(node, "id")
      && Object.hasOwn(node, "element")
      && !Object.hasOwn(node, "uuid"),
  );
};

const validateNodeBase = (node, index, problems) => {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    problems.push(`nodes[${index}] must be an object`);
    return;
  }

  if (typeof node.uuid !== "string" || node.uuid.length === 0) {
    problems.push(`nodes[${index}].uuid must be a non-empty string`);
  }

  if (typeof node.leafnodetype !== "string" || node.leafnodetype.length === 0) {
    problems.push(`nodes[${index}].leafnodetype must be a non-empty string`);
  }

  if (Object.hasOwn(node, "id") || Object.hasOwn(node, "element")) {
    problems.push(`nodes[${index}] appears declarative (id/element keys are not runtime DTO fields)`);
  }
};

const validateEdge = ({ edge, nodeUuid, nodeIndex, edgeIndex, knownNodeIds, problems, warnings }) => {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}] must be an object`);
    return;
  }

  if (typeof edge.uuid !== "string" || edge.uuid.length === 0) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].uuid must be a non-empty string`);
  }

  const sourceUuid = edge?.source?.uuid;
  const targetUuid = edge?.target?.uuid;

  if (typeof sourceUuid !== "string" || sourceUuid.length === 0) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].source.uuid must be a non-empty string`);
  } else if (sourceUuid !== nodeUuid) {
    warnings.push(`edge ${edge.uuid ?? `<${nodeIndex}:${edgeIndex}>`} source.uuid (${sourceUuid}) does not match parent node uuid (${nodeUuid})`);
  }

  if (typeof targetUuid !== "string" || targetUuid.length === 0) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].target.uuid must be a non-empty string`);
  } else if (!knownNodeIds.has(targetUuid)) {
    warnings.push(`edge ${edge.uuid ?? `<${nodeIndex}:${edgeIndex}>`} targets unknown node uuid (${targetUuid})`);
  }

  try {
    const decoded = decodeBase64Json(edge.data, `nodes[${nodeIndex}].out_edges[${edgeIndex}].data`);
    const logicType = decoded?.leaf?.logic?.type;
    if (typeof logicType !== "string" || logicType.length === 0) {
      problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].data must include leaf.logic.type`);
    }
  } catch (error) {
    problems.push(error.message);
  }
};

export const validateRuntimeDtoGraph = (graph) => {
  const problems = [];
  const warnings = [];

  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return {
      pass: false,
      problems: ["graph payload must resolve to an object"],
      warnings,
      nodeCount: 0,
      edgeCount: 0,
      declarativeShape: false,
    };
  }

  const declarativeShape = isDeclarativeGraphShape(graph);
  if (declarativeShape) {
    problems.push("graph payload appears to be declarative schema (kind/inputs/outputs/id+element), not runtime DTO");
  }

  if (typeof graph.domain !== "string" || graph.domain.length === 0) {
    problems.push("graph.domain must be a non-empty string");
  }

  if (typeof graph.appid !== "string" || graph.appid.length === 0) {
    problems.push("graph.appid must be a non-empty string");
  }

  if (!Array.isArray(graph.nodes)) {
    problems.push("graph.nodes must be an array");
    return {
      pass: false,
      problems,
      warnings,
      nodeCount: 0,
      edgeCount: 0,
      declarativeShape,
    };
  }

  const nodeIds = new Set();
  for (const [index, node] of graph.nodes.entries()) {
    validateNodeBase(node, index, problems);
    if (node && typeof node.uuid === "string" && node.uuid.length > 0) {
      if (nodeIds.has(node.uuid)) {
        problems.push(`duplicate node uuid: ${node.uuid}`);
      }
      nodeIds.add(node.uuid);
    }
  }

  let edgeCount = 0;
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;

    try {
      const decodedNode = decodeBase64Json(node.data, `nodes[${nodeIndex}].data`);
      const logicType = decodedNode?.leaf?.logic?.type;
      if (typeof logicType !== "string" || logicType.length === 0) {
        problems.push(`nodes[${nodeIndex}].data must include leaf.logic.type`);
      } else if (node.leafnodetype !== logicType) {
        warnings.push(`node ${node.uuid ?? `<${nodeIndex}>`} leafnodetype (${node.leafnodetype}) differs from data leaf.logic.type (${logicType})`);
      }
    } catch (error) {
      problems.push(error.message);
    }

    if (!Array.isArray(node.out_edges)) {
      problems.push(`nodes[${nodeIndex}].out_edges must be an array`);
      continue;
    }

    for (const [edgeIndex, edge] of node.out_edges.entries()) {
      edgeCount += 1;
      validateEdge({
        edge,
        nodeUuid: node.uuid,
        nodeIndex,
        edgeIndex,
        knownNodeIds: nodeIds,
        problems,
        warnings,
      });
    }
  }

  return {
    pass: problems.length === 0,
    problems,
    warnings,
    nodeCount: graph.nodes.length,
    edgeCount,
    declarativeShape,
  };
};

export const inspectRuntimeDtoNodes = (graph) => {
  const entries = [];
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    return entries;
  }

  for (const [index, node] of graph.nodes.entries()) {
    const entry = {
      index,
      uuid: typeof node?.uuid === "string" ? node.uuid : null,
      leafnodetype: typeof node?.leafnodetype === "string" ? node.leafnodetype : null,
      decoded: null,
      error: null,
      json: null,
    };

    try {
      entry.decoded = decodeBase64Json(node?.data, `nodes[${index}].data`);
      entry.json = JSON.stringify(entry.decoded);
    } catch (error) {
      entry.error = error.message;
    }

    entries.push(entry);
  }

  return entries;
};
