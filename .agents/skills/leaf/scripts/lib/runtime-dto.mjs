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

const getNodeLogic = (node, index) => {
  const decoded = decodeBase64Json(node?.data, `nodes[${index}].data`);
  const logic = decoded?.leaf?.logic;
  if (!logic || typeof logic !== "object") {
    throw new Error(`nodes[${index}].data must include leaf.logic object`);
  }
  return logic;
};

export const lintRuntimeDtoHttpContracts = (graph, options = {}) => {
  const outKey = typeof options.outKey === "string" && options.outKey.length > 0 ? options.outKey : "OUT1";
  const issues = [];
  const warnings = [];
  const facts = {
    outKey,
    nodeCount: 0,
    httpNodeCount: 0,
  };

  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    return {
      pass: false,
      issues: [
        {
          code: "graph-nodes-missing",
          message: "graph.nodes must be an array for HTTP contract linting",
        },
      ],
      warnings,
      facts,
    };
  }

  facts.nodeCount = graph.nodes.length;

  const nodeByUuid = new Map();
  const nodeMetaByUuid = new Map();
  const incomingByTarget = new Map();

  for (const [index, node] of graph.nodes.entries()) {
    if (!node || typeof node !== "object") continue;
    const uuid = typeof node.uuid === "string" ? node.uuid : null;
    if (!uuid) continue;

    nodeByUuid.set(uuid, node);

    let logic = null;
    let decodeError = null;
    try {
      logic = getNodeLogic(node, index);
    } catch (error) {
      decodeError = error.message;
    }

    nodeMetaByUuid.set(uuid, {
      index,
      leafnodetype: typeof node.leafnodetype === "string" ? node.leafnodetype : null,
      logic,
      decodeError,
    });

    for (const edge of Array.isArray(node.out_edges) ? node.out_edges : []) {
      const targetUuid = edge?.target?.uuid;
      if (typeof targetUuid !== "string" || targetUuid.length === 0) continue;
      const entries = incomingByTarget.get(targetUuid) ?? [];
      entries.push({ sourceUuid: uuid, edgeUuid: edge?.uuid ?? null });
      incomingByTarget.set(targetUuid, entries);
    }
  }

  const outNode = nodeByUuid.get(outKey);
  if (!outNode) {
    issues.push({
      code: "missing-outflow-node",
      message: `outflow node '${outKey}' is not present in graph.nodes`,
    });
  } else if (outNode.leafnodetype !== "leafoutflowport") {
    issues.push({
      code: "outflow-node-type-mismatch",
      message: `node '${outKey}' must use leafoutflowport (found '${outNode.leafnodetype ?? "unknown"}')`,
    });
  }

  for (const [uuid, meta] of nodeMetaByUuid.entries()) {
    const logicType = meta.logic?.type;
    const elementName = meta.logic?.args?.elementname;
    if (meta.leafnodetype !== "leafelement" || logicType !== "leafelement" || elementName !== "http") {
      continue;
    }

    facts.httpNodeCount += 1;
    const incoming = incomingByTarget.get(uuid) ?? [];
    if (incoming.length === 0) {
      issues.push({
        code: "http-node-missing-request-source",
        message: `http node '${uuid}' has no incoming request source`,
      });
    }

    for (const entry of incoming) {
      const sourceMeta = nodeMetaByUuid.get(entry.sourceUuid);
      if (!sourceMeta) {
        issues.push({
          code: "http-request-source-missing",
          message: `http node '${uuid}' source '${entry.sourceUuid}' does not exist`,
        });
        continue;
      }

      if (sourceMeta.decodeError) {
        issues.push({
          code: "http-request-source-decode-error",
          message: `http source '${entry.sourceUuid}' has invalid payload (${sourceMeta.decodeError})`,
        });
        continue;
      }

      if (sourceMeta.leafnodetype !== "leaflisp" || sourceMeta.logic?.type !== "leaflisp") {
        issues.push({
          code: "http-request-source-non-leaflisp",
          message: `http node '${uuid}' source '${entry.sourceUuid}' must be leaflisp request-builder`,
        });
        continue;
      }

      const expression = String(sourceMeta.logic?.args?.lispexpression ?? "");
      if (!/bottle\s+["']http-request["']/.test(expression)) {
        issues.push({
          code: "http-request-source-missing-http-request-bottle",
          message: `request source '${entry.sourceUuid}' must emit bottle \"http-request\"`,
        });
      }

      for (const token of [":uri", ":operation", ":operands"]) {
        if (!expression.includes(token)) {
          warnings.push({
            code: "http-request-source-missing-token",
            message: `request source '${entry.sourceUuid}' expression does not contain ${token}`,
          });
        }
      }
    }

    const outgoing = Array.isArray(nodeByUuid.get(uuid)?.out_edges) ? nodeByUuid.get(uuid).out_edges : [];
    if (outgoing.length === 0) {
      issues.push({
        code: "http-node-missing-parse-target",
        message: `http node '${uuid}' has no outgoing parse target`,
      });
      continue;
    }

    for (const edge of outgoing) {
      const targetUuid = edge?.target?.uuid;
      const targetMeta = typeof targetUuid === "string" ? nodeMetaByUuid.get(targetUuid) : null;
      if (!targetMeta) {
        issues.push({
          code: "http-parse-target-missing",
          message: `http node '${uuid}' target '${targetUuid ?? "unknown"}' does not exist`,
        });
        continue;
      }

      if (targetMeta.decodeError) {
        issues.push({
          code: "http-parse-target-decode-error",
          message: `parse node '${targetUuid}' has invalid payload (${targetMeta.decodeError})`,
        });
        continue;
      }

      if (targetMeta.leafnodetype !== "leaflisp" || targetMeta.logic?.type !== "leaflisp") {
        issues.push({
          code: "http-parse-target-non-leaflisp",
          message: `http node '${uuid}' target '${targetUuid}' must be leaflisp parser`,
        });
        continue;
      }

      const parseExpression = String(targetMeta.logic?.args?.lispexpression ?? "");
      if (!parseExpression.includes(":result")) {
        issues.push({
          code: "http-parse-target-missing-result-read",
          message: `parse node '${targetUuid}' should extract :result from HTTP response`,
        });
      }
    }
  }

  return {
    pass: issues.length === 0,
    issues,
    warnings,
    facts,
  };
};
