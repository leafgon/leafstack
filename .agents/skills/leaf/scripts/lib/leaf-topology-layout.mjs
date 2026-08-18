import {
  normalizeNodeDimensionOverrides,
  resolvePiperLeafNodeDimensions,
} from "./piper-node-dimensions.mjs";

const DEFAULT_OPTIONS = Object.freeze({
  algorithm: "layered",
  direction: "RIGHT",
  edgeRouting: "ORTHOGONAL",
  crossingMinimization: "LAYER_SWEEP",
  nodePlacement: "NETWORK_SIMPLEX",
  nodeSpacing: 40,
  layerSpacing: 80,
  edgeNodeSpacing: 24,
  edgeEdgeSpacing: 18,
  collisionPadding: 16,
  padding: 80,
  precision: 2,
  randomSeed: 1,
  failOnOverlap: true,
  nodeDimensions: Object.freeze({}),
  elkOptions: Object.freeze({}),
});

const OPTION_NAMES = new Set(Object.keys(DEFAULT_OPTIONS));
const DIRECTIONS = new Set(["RIGHT", "LEFT", "DOWN", "UP"]);
const EDGE_ROUTING = new Set(["ORTHOGONAL", "POLYLINE"]);
const CROSSING_MINIMIZATION = new Set(["LAYER_SWEEP", "INTERACTIVE"]);
const NODE_PLACEMENT = new Set([
  "NETWORK_SIMPLEX",
  "BRANDES_KOEPF",
  "LINEAR_SEGMENTS",
  "SIMPLE",
]);
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const requireFiniteNumber = (value, label, minimum = 0) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a finite number of at least ${minimum}`);
  }
  return value;
};

const normalizePadding = (value, label) => {
  if (typeof value === "number") {
    requireFiniteNumber(value, label);
    return { top: value, right: value, bottom: value, left: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a number or an object`);
  }
  const names = new Set(["top", "right", "bottom", "left"]);
  if (Object.keys(value).some((key) => !names.has(key))) {
    throw new Error(`${label} supports only top, right, bottom, and left`);
  }
  return Object.fromEntries(
    [...names].map((name) => [
      name,
      requireFiniteNumber(value[name], `${label}.${name}`),
    ]),
  );
};

const normalizeElkOptions = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, option]) => {
      if (!key.startsWith("elk.")) {
        throw new Error(`${label}.${key} must start with elk.`);
      }
      if (!["string", "number", "boolean"].includes(typeof option)) {
        throw new Error(`${label}.${key} must be a string, number, or boolean`);
      }
      return [key, String(option)];
    }),
  );
};

export const normalizeLeafTopologyLayoutOptions = (
  value = {},
  label = "layout",
) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!OPTION_NAMES.has(key)) throw new Error(`${label}.${key} is unsupported`);
  }
  const options = { ...DEFAULT_OPTIONS, ...value };
  if (options.algorithm !== "layered") {
    throw new Error(`${label}.algorithm must be layered`);
  }
  for (const [name, allowed] of [
    ["direction", DIRECTIONS],
    ["edgeRouting", EDGE_ROUTING],
    ["crossingMinimization", CROSSING_MINIMIZATION],
    ["nodePlacement", NODE_PLACEMENT],
  ]) {
    if (!allowed.has(options[name])) {
      throw new Error(`${label}.${name} is unsupported: ${options[name]}`);
    }
  }
  for (const name of [
    "nodeSpacing",
    "layerSpacing",
    "edgeNodeSpacing",
    "edgeEdgeSpacing",
    "collisionPadding",
  ]) {
    requireFiniteNumber(options[name], `${label}.${name}`);
  }
  if (!Number.isInteger(options.precision) || options.precision < 0 || options.precision > 6) {
    throw new Error(`${label}.precision must be an integer between 0 and 6`);
  }
  if (!Number.isInteger(options.randomSeed)) {
    throw new Error(`${label}.randomSeed must be an integer`);
  }
  if (typeof options.failOnOverlap !== "boolean") {
    throw new Error(`${label}.failOnOverlap must be a boolean`);
  }
  options.padding = normalizePadding(options.padding, `${label}.padding`);
  options.nodeDimensions = normalizeNodeDimensionOverrides(
    options.nodeDimensions,
    `${label}.nodeDimensions`,
  );
  options.elkOptions = normalizeElkOptions(options.elkOptions, `${label}.elkOptions`);
  return options;
};

const decodeNodeData = (node, label) => {
  if (typeof node?.data !== "string" || !BASE64_PATTERN.test(node.data)) {
    throw new Error(`${label}.data must be base64-encoded JSON`);
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(node.data, "base64").toString("utf8"));
  } catch {
    throw new Error(`${label}.data must be base64-encoded JSON`);
  }
  if (!decoded?.leaf || typeof decoded.leaf !== "object" || Array.isArray(decoded.leaf)) {
    throw new Error(`${label}.data must contain a leaf object`);
  }
  return decoded;
};

const encodeNodeData = (decoded) =>
  Buffer.from(JSON.stringify(decoded), "utf8").toString("base64");

const flattenGraph = (graph, options) => {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    throw new Error("graph must be an object");
  }
  if (!Array.isArray(graph.nodes)) throw new Error("graph.nodes must be an array");
  const records = graph.nodes.map((node, index) => {
    if (typeof node?.uuid !== "string" || node.uuid.length === 0) {
      throw new Error(`graph.nodes[${index}].uuid must be a non-empty string`);
    }
    const decoded = decodeNodeData(node, `graph.nodes[${index}]`);
    return {
      node,
      decoded,
      dimensions: resolvePiperLeafNodeDimensions(decoded, options.nodeDimensions),
    };
  });
  records.sort((left, right) => left.node.uuid.localeCompare(right.node.uuid));
  const nodeIds = new Set(records.map((record) => record.node.uuid));
  if (nodeIds.size !== records.length) throw new Error("graph has duplicate node UUIDs");

  const edgeIds = new Set();
  const edges = [];
  for (const record of records) {
    if (!Array.isArray(record.node.out_edges)) {
      throw new Error(`node ${record.node.uuid}.out_edges must be an array`);
    }
    for (const edge of record.node.out_edges) {
      if (typeof edge?.uuid !== "string" || edge.uuid.length === 0) {
        throw new Error(`node ${record.node.uuid} has an edge without a UUID`);
      }
      if (edgeIds.has(edge.uuid)) throw new Error(`graph has duplicate edge UUID ${edge.uuid}`);
      edgeIds.add(edge.uuid);
      const source = edge.source?.uuid;
      const target = edge.target?.uuid;
      if (source !== record.node.uuid) {
        throw new Error(`edge ${edge.uuid} must be nested under its source node`);
      }
      if (!nodeIds.has(target)) throw new Error(`edge ${edge.uuid} targets missing node ${target}`);
      edges.push({ uuid: edge.uuid, source, target });
    }
  }
  edges.sort((left, right) => left.uuid.localeCompare(right.uuid));
  return { records, edges };
};

const paddingLiteral = ({ top, right, bottom, left }) =>
  `[top=${top},left=${left},bottom=${bottom},right=${right}]`;

const buildElkGraph = (records, edges, options) => ({
  id: "leaf-root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": options.direction,
    "elk.edgeRouting": options.edgeRouting,
    "elk.spacing.nodeNode": String(options.nodeSpacing),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(options.layerSpacing),
    "elk.spacing.edgeNode": String(options.edgeNodeSpacing),
    "elk.spacing.edgeEdge": String(options.edgeEdgeSpacing),
    "elk.layered.crossingMinimization.strategy": options.crossingMinimization,
    "elk.layered.nodePlacement.strategy": options.nodePlacement,
    "elk.separateConnectedComponents": "true",
    "elk.randomSeed": String(options.randomSeed),
    "elk.padding": paddingLiteral(options.padding),
    ...options.elkOptions,
  },
  children: records.map((record) => ({
    id: record.node.uuid,
    width: record.dimensions.width,
    height: record.dimensions.height,
  })),
  edges: edges.map((edge) => ({
    id: edge.uuid,
    sources: [edge.source],
    targets: [edge.target],
  })),
});

const loadElk = async (runtime) => {
  if (runtime?.elk && typeof runtime.elk.layout === "function") return runtime.elk;
  if (runtime && Object.keys(runtime).some((key) => key !== "elk")) {
    throw new Error("runtime supports only elk");
  }
  try {
    const module = await import("elkjs/lib/elk.bundled.js");
    const Constructor = module.default ?? module.ELK ?? module;
    return new Constructor();
  } catch (error) {
    throw new Error(
      "elkjs is required; install elkjs@0.12.0 or pass runtime.elk with a layout() method",
      { cause: error },
    );
  }
};

const round = (value, precision) => {
  const factor = 10 ** precision;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
};

const point = (value, label, precision) => {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`${label} must contain finite x/y coordinates`);
  }
  return { x: round(value.x, precision), y: round(value.y, precision) };
};

const normalizeElkOutput = (output, records, edges, options) => {
  if (!output || !Array.isArray(output.children) || !Array.isArray(output.edges)) {
    throw new Error("ELK output must contain children and edges arrays");
  }
  const children = new Map();
  for (const child of output.children) {
    if (children.has(child?.id)) throw new Error(`ELK returned duplicate node ${child?.id}`);
    children.set(child?.id, child);
  }
  const positions = new Map();
  for (const record of records) {
    const child = children.get(record.node.uuid);
    if (!child) throw new Error(`ELK output is missing node ${record.node.uuid}`);
    positions.set(
      record.node.uuid,
      point(child, `ELK node ${record.node.uuid}`, options.precision),
    );
  }
  const edgeById = new Map(edges.map((edge) => [edge.uuid, edge]));
  const outputEdges = new Map(output.edges.map((edge) => [edge.id, edge]));
  const routes = edges.map((edge) => {
    const sections = outputEdges.get(edge.uuid)?.sections ?? [];
    if (!Array.isArray(sections)) throw new Error(`ELK edge ${edge.uuid}.sections must be an array`);
    return {
      uuid: edge.uuid,
      source: edge.source,
      target: edge.target,
      sections: sections.map((section, index) => ({
        startPoint: point(
          section.startPoint,
          `ELK edge ${edge.uuid} section ${index} startPoint`,
          options.precision,
        ),
        bendPoints: (section.bendPoints ?? []).map((bend, bendIndex) =>
          point(
            bend,
            `ELK edge ${edge.uuid} section ${index} bendPoints[${bendIndex}]`,
            options.precision,
          ),
        ),
        endPoint: point(
          section.endPoint,
          `ELK edge ${edge.uuid} section ${index} endPoint`,
          options.precision,
        ),
      })),
    };
  });
  for (const outputEdge of output.edges) {
    if (!edgeById.has(outputEdge.id)) throw new Error(`ELK returned unknown edge ${outputEdge.id}`);
  }
  return {
    positions,
    routes,
    width: Number.isFinite(output.width) ? round(output.width, options.precision) : null,
    height: Number.isFinite(output.height) ? round(output.height, options.precision) : null,
  };
};

const orientation = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const strictlyCrosses = (a, b, c, d) => {
  const values = [
    orientation(a, b, c),
    orientation(a, b, d),
    orientation(c, d, a),
    orientation(c, d, b),
  ];
  return (
    ((values[0] > 1e-6 && values[1] < -1e-6) ||
      (values[0] < -1e-6 && values[1] > 1e-6)) &&
    ((values[2] > 1e-6 && values[3] < -1e-6) ||
      (values[2] < -1e-6 && values[3] > 1e-6))
  );
};

const routeSegments = (routes) =>
  routes.flatMap((route) =>
    route.sections.flatMap((section) => {
      const points = [section.startPoint, ...section.bendPoints, section.endPoint];
      return points.slice(0, -1).map((start, index) => ({
        uuid: route.uuid,
        source: route.source,
        target: route.target,
        start,
        end: points[index + 1],
      }));
    }),
  );

const collinearOverlap = (left, right) => {
  const horizontalLeft = Math.abs(left.start.y - left.end.y) < 1e-6;
  const horizontalRight = Math.abs(right.start.y - right.end.y) < 1e-6;
  const verticalLeft = Math.abs(left.start.x - left.end.x) < 1e-6;
  const verticalRight = Math.abs(right.start.x - right.end.x) < 1e-6;
  if (horizontalLeft && horizontalRight && Math.abs(left.start.y - right.start.y) < 1e-6) {
    return (
      Math.min(Math.max(left.start.x, left.end.x), Math.max(right.start.x, right.end.x)) -
        Math.max(Math.min(left.start.x, left.end.x), Math.min(right.start.x, right.end.x)) >
      1e-6
    );
  }
  if (verticalLeft && verticalRight && Math.abs(left.start.x - right.start.x) < 1e-6) {
    return (
      Math.min(Math.max(left.start.y, left.end.y), Math.max(right.start.y, right.end.y)) -
        Math.max(Math.min(left.start.y, left.end.y), Math.min(right.start.y, right.end.y)) >
      1e-6
    );
  }
  return false;
};

const segmentIntersectsRectInterior = (segment, rect) => {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  let minimum = 0;
  let maximum = 1;
  for (const [origin, delta, low, high] of [
    [segment.start.x, dx, rect.x, rect.x + rect.width],
    [segment.start.y, dy, rect.y, rect.y + rect.height],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin <= low + 1e-6 || origin >= high - 1e-6) return false;
      continue;
    }
    const first = (low - origin) / delta;
    const second = (high - origin) / delta;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (maximum - minimum <= 1e-6) return false;
  }
  const middle = (minimum + maximum) / 2;
  const x = segment.start.x + dx * middle;
  const y = segment.start.y + dy * middle;
  return (
    x > rect.x + 1e-6 &&
    x < rect.x + rect.width - 1e-6 &&
    y > rect.y + 1e-6 &&
    y < rect.y + rect.height - 1e-6
  );
};

const calculateMetrics = (records, positions, routes, options) => {
  const boxes = records.map((record) => {
    const position = positions.get(record.node.uuid);
    return {
      uuid: record.node.uuid,
      x: position.x,
      y: position.y,
      width: record.dimensions.width,
      height: record.dimensions.height,
      center: {
        x: position.x + record.dimensions.width / 2,
        y: position.y + record.dimensions.height / 2,
      },
    };
  });
  const boxesById = new Map(boxes.map((box) => [box.uuid, box]));
  let overlapCount = 0;
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      if (
        (a.width + b.width) / 2 + options.collisionPadding -
          Math.abs(a.center.x - b.center.x) >
          1e-6 &&
        (a.height + b.height) / 2 + options.collisionPadding -
          Math.abs(a.center.y - b.center.y) >
          1e-6
      ) {
        overlapCount += 1;
      }
    }
  }
  const segments = routeSegments(routes);
  let routedEdgeCrossingCount = 0;
  let routedEdgeOverlapCount = 0;
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      if (a.uuid === b.uuid) continue;
      if (strictlyCrosses(a.start, a.end, b.start, b.end)) routedEdgeCrossingCount += 1;
      if (collinearOverlap(a, b)) routedEdgeOverlapCount += 1;
    }
  }
  const edgeNodeHits = new Set();
  for (const segment of segments) {
    for (const box of boxes) {
      if (box.uuid === segment.source || box.uuid === segment.target) continue;
      if (segmentIntersectsRectInterior(segment, box)) {
        edgeNodeHits.add(`${segment.uuid}:${box.uuid}`);
      }
    }
  }
  let straightEdgeCrossingCount = 0;
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      const a = routes[left];
      const b = routes[right];
      if ([a.source, a.target].some((uuid) => uuid === b.source || uuid === b.target)) continue;
      if (
        strictlyCrosses(
          boxesById.get(a.source).center,
          boxesById.get(a.target).center,
          boxesById.get(b.source).center,
          boxesById.get(b.target).center,
        )
      ) {
        straightEdgeCrossingCount += 1;
      }
    }
  }
  const routedLengths = routes.map((route) =>
    route.sections.reduce((total, section) => {
      const points = [section.startPoint, ...section.bendPoints, section.endPoint];
      return (
        total +
        points
          .slice(0, -1)
          .reduce(
            (sum, start, index) =>
              sum + Math.hypot(start.x - points[index + 1].x, start.y - points[index + 1].y),
            0,
          )
      );
    }, 0),
  );
  return {
    overlapCount,
    straightEdgeCrossingCount,
    routedEdgeCrossingCount,
    routedEdgeOverlapCount,
    edgeNodeIntersectionCount: edgeNodeHits.size,
    averageRoutedEdgeLength:
      routedLengths.length === 0
        ? 0
        : round(
            routedLengths.reduce((sum, length) => sum + length, 0) / routedLengths.length,
            options.precision,
          ),
    maximumRoutedEdgeLength:
      routedLengths.length === 0
        ? 0
        : round(Math.max(...routedLengths), options.precision),
  };
};

export const layoutLeafTopology = async (
  sourceGraph,
  layoutOptions = {},
  runtime = {},
) => {
  const options = normalizeLeafTopologyLayoutOptions(layoutOptions);
  const graph = structuredClone(sourceGraph);
  const { records, edges } = flattenGraph(graph, options);
  const elk = await loadElk(runtime);
  const output = await elk.layout(buildElkGraph(records, edges, options));
  const normalized = normalizeElkOutput(output, records, edges, options);
  const metrics = calculateMetrics(
    records,
    normalized.positions,
    normalized.routes,
    options,
  );
  if (metrics.overlapCount > 0 && options.failOnOverlap) {
    throw new Error(`ELK layered layout left ${metrics.overlapCount} overlapping node pair(s)`);
  }

  const changedNodeUuids = [];
  for (const record of records) {
    const { x, y } = normalized.positions.get(record.node.uuid);
    if (record.decoded.leaf.appdata == null) record.decoded.leaf.appdata = {};
    if (
      typeof record.decoded.leaf.appdata !== "object" ||
      Array.isArray(record.decoded.leaf.appdata)
    ) {
      throw new Error(`node ${record.node.uuid} leaf.appdata must be an object`);
    }
    const previous = record.decoded.leaf.appdata.position ?? {};
    if (typeof previous !== "object" || Array.isArray(previous)) {
      throw new Error(`node ${record.node.uuid} leaf.appdata.position must be an object`);
    }
    if (previous.x === x && previous.y === y) continue;
    changedNodeUuids.push(record.node.uuid);
    record.decoded.leaf.appdata.position = { ...previous, x, y };
    record.node.data = encodeNodeData(record.decoded);
  }

  return {
    graph,
    routedEdges: normalized.routes,
    changedNodeUuids,
    nodeCount: records.length,
    edgeCount: edges.length,
    width: normalized.width,
    height: normalized.height,
    ...metrics,
    options,
  };
};
