const EDGE_TYPES = new Set(["leafdataedge", "leaflambdaedge", "leafanchoredge"]);

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const requireArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};

const requireString = (value, label) => {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
};

const clone = (value) => structuredClone(value);

const parseScopedId = (identifier, segment) => {
  if (typeof identifier !== "string") return undefined;
  const marker = `/${segment}/`;
  const position = identifier.lastIndexOf(marker);
  if (position < 0) return undefined;
  const parsed = identifier.slice(position + marker.length);
  return parsed.length > 0 ? parsed : undefined;
};

const encodeData = (value, label) => {
  requireObject(value, label);
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
};

const decodeData = (encoded, label) => {
  if (typeof encoded !== "string" || encoded.length === 0)
    throw new Error(`${label} must be a non-empty base64 string`);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (error) {
    throw new Error(`${label} must decode to JSON (${error.message})`);
  }
  return requireObject(parsed, `${label} decoded`);
};

const normalizeEdgeData = (edge, label) => {
  if (Object.hasOwn(edge, "data")) return requireObject(edge.data, `${label}.data`);
  const edgeType = requireString(edge.edgeType, `${label}.edgeType`);
  if (!EDGE_TYPES.has(edgeType)) {
    throw new Error(`${label}.edgeType must be one of ${[...EDGE_TYPES].join(", ")}`);
  }
  return {
    leaf: {
      logic: {
        type: edgeType,
      },
    },
  };
};

export const unwrapGraphPayload = (payload) =>
  payload?.data?.graph ?? payload?.graph ?? payload;

export const buildGraphFromJsonld = (input) => {
  const payload = requireObject(unwrapGraphPayload(input), "jsonld graph");
  const domain = requireString(payload.domain, "domain");
  const appid = requireString(payload.appid, "appid");
  const nodes = requireArray(payload.nodes, "nodes");
  const edges = Array.isArray(payload.edges) ? payload.edges : [];

  const normalizedNodes = [];
  const nodeMap = new Map();

  for (const [index, node] of nodes.entries()) {
    const label = `nodes[${index}]`;
    const normalizedNode = requireObject(node, label);
    const uuid = requireString(
      normalizedNode.uuid ?? parseScopedId(normalizedNode["@id"], "node"),
      `${label}.uuid`,
    );
    if (nodeMap.has(uuid)) throw new Error(`${label}.uuid duplicates node ${uuid}`);

    const leafnodetype = requireString(normalizedNode.leafnodetype, `${label}.leafnodetype`);
    const dataObject = requireObject(normalizedNode.data, `${label}.data`);
    const logicType = dataObject?.leaf?.logic?.type;
    if (logicType !== leafnodetype) {
      throw new Error(
        `${label}.leafnodetype (${leafnodetype}) must match data.leaf.logic.type (${logicType ?? "<missing>"})`,
      );
    }

    const runtimeNode = {
      uuid,
      leafnodetype,
      data: encodeData(dataObject, `${label}.data`),
      out_edges: [],
    };
    normalizedNodes.push(runtimeNode);
    nodeMap.set(uuid, runtimeNode);
  }

  for (const [index, edge] of edges.entries()) {
    const label = `edges[${index}]`;
    const normalizedEdge = requireObject(edge, label);
    const uuid = requireString(
      normalizedEdge.uuid ?? parseScopedId(normalizedEdge["@id"], "edge"),
      `${label}.uuid`,
    );
    const source = requireString(normalizedEdge.source, `${label}.source`);
    const target = requireString(normalizedEdge.target, `${label}.target`);
    if (!nodeMap.has(source)) throw new Error(`${label}.source references unknown node ${source}`);
    if (!nodeMap.has(target)) throw new Error(`${label}.target references unknown node ${target}`);

    const edgeData = normalizeEdgeData(normalizedEdge, label);
    const edgeType = edgeData?.leaf?.logic?.type;
    if (!EDGE_TYPES.has(edgeType)) {
      throw new Error(`${label}.data.leaf.logic.type must be one of ${[...EDGE_TYPES].join(", ")}`);
    }

    nodeMap.get(source).out_edges.push({
      uuid,
      source: { uuid: source },
      target: { uuid: target },
      data: encodeData(edgeData, `${label}.data`),
    });
  }

  return {
    domain,
    appid,
    nodes: normalizedNodes,
  };
};

export const exportGraphToJsonld = (input, context = "https://leafgon.com/ns/leaf-graph-jsonld/v1") => {
  const payload = requireObject(unwrapGraphPayload(input), "runtime graph");
  const domain = requireString(payload.domain, "domain");
  const appid = requireString(payload.appid, "appid");
  const nodes = requireArray(payload.nodes, "nodes");
  const jsonldNodes = [];
  const jsonldEdges = [];

  const graphId = `leaf://${domain}/${appid}`;

  for (const [nodeIndex, node] of nodes.entries()) {
    const label = `nodes[${nodeIndex}]`;
    const normalizedNode = requireObject(node, label);
    const uuid = requireString(normalizedNode.uuid, `${label}.uuid`);
    const leafnodetype = requireString(normalizedNode.leafnodetype, `${label}.leafnodetype`);
    const decodedNode = decodeData(normalizedNode.data, `${label}.data`);
    const logicType = decodedNode?.leaf?.logic?.type;
    if (logicType !== leafnodetype) {
      throw new Error(
        `${label}.leafnodetype (${leafnodetype}) must match decoded data.leaf.logic.type (${logicType ?? "<missing>"})`,
      );
    }

    jsonldNodes.push({
      "@id": `${graphId}/node/${uuid}`,
      "@type": "LeafNode",
      uuid,
      leafnodetype,
      data: clone(decodedNode),
    });

    const outEdges = requireArray(normalizedNode.out_edges, `${label}.out_edges`);
    for (const [edgeIndex, edge] of outEdges.entries()) {
      const edgeLabel = `${label}.out_edges[${edgeIndex}]`;
      const normalizedEdge = requireObject(edge, edgeLabel);
      const edgeUuid = requireString(normalizedEdge.uuid, `${edgeLabel}.uuid`);
      const source = requireString(normalizedEdge?.source?.uuid, `${edgeLabel}.source.uuid`);
      const target = requireString(normalizedEdge?.target?.uuid, `${edgeLabel}.target.uuid`);
      if (source !== uuid) {
        throw new Error(`${edgeLabel}.source.uuid (${source}) must equal owning node uuid (${uuid})`);
      }
      const decodedEdge = decodeData(normalizedEdge.data, `${edgeLabel}.data`);
      const edgeType = decodedEdge?.leaf?.logic?.type;
      if (!EDGE_TYPES.has(edgeType)) {
        throw new Error(
          `${edgeLabel}.data.leaf.logic.type (${edgeType ?? "<missing>"}) must be one of ${[...EDGE_TYPES].join(", ")}`,
        );
      }

      jsonldEdges.push({
        "@id": `${graphId}/edge/${edgeUuid}`,
        "@type": "LeafEdge",
        uuid: edgeUuid,
        source,
        target,
        edgeType,
        data: clone(decodedEdge),
      });
    }
  }

  return {
    "@context": context,
    "@id": graphId,
    "@type": "LeafGraph",
    domain,
    appid,
    nodes: jsonldNodes,
    edges: jsonldEdges,
  };
};
