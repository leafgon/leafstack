import { layoutLeafTopology } from "./leaf-topology-layout.mjs";
import { applyLeafEdgeGeometryForces } from "./leaf-force-layout.mjs";
import {
  normalizeNodeDimensionOverrides,
  resolvePiperLeafNodeDimensions,
} from "./piper-node-dimensions.mjs";

const DEFAULT_OPTIONS = Object.freeze({
  algorithm: "semantic",
  dataSpacing: 40,
  lambdaSpacing: 40,
  anchorSpacing: 40,
  nodeSpacing: 24,
  collisionPadding: 10,
  boundaryPadding: 24,
  componentCompaction: true,
  componentCompactionIterations: 12,
  constraintIterations: 200,
  collisionIterations: 100,
  attraction: 0.35,
  repulsion: 0.18,
  edgeRepulsion: 0.1,
  edgeNodeRepulsion: 0.5,
  crossingPenalty: 1,
  sharedSegmentPenalty: 0.5,
  edgeClearance: 12,
  sharedSegmentTolerance: 8,
  gravity: 0.06,
  boundaryRepulsion: 0.15,
  boundaryGravity: 0.08,
  initialTemperature: 12,
  dataAlignmentStrength: 0.2,
  lambdaAlignmentStrength: 0.2,
  anchorAlignmentStrength: 0.2,
  padding: 32,
  precision: 2,
  randomSeed: 1,
  failOnOverlap: true,
  failOnDirectionViolation: true,
  nodeDimensions: Object.freeze({}),
  elkOptions: Object.freeze({}),
});

const OPTION_NAMES = new Set(Object.keys(DEFAULT_OPTIONS));
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_EDGE = "leafdataedge";
const LAMBDA_EDGE = "leaflambdaedge";
const ANCHOR_EDGE = "leafanchoredge";

const requireFiniteNumber = (
  value,
  label,
  { minimum = 0, maximum = Infinity } = {},
) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    const upper = maximum === Infinity ? "" : ` and at most ${maximum}`;
    throw new Error(`${label} must be a finite number of at least ${minimum}${upper}`);
  }
  return value;
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
      return [key, option];
    }),
  );
};

export const normalizeLeafSemanticLayoutOptions = (
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
  if (options.algorithm !== "semantic") {
    throw new Error(`${label}.algorithm must be semantic`);
  }
  for (const name of [
    "dataSpacing",
    "lambdaSpacing",
    "anchorSpacing",
    "nodeSpacing",
    "collisionPadding",
    "boundaryPadding",
    "padding",
    "attraction",
    "repulsion",
    "edgeRepulsion",
    "edgeNodeRepulsion",
    "crossingPenalty",
    "sharedSegmentPenalty",
    "edgeClearance",
    "sharedSegmentTolerance",
    "gravity",
    "boundaryRepulsion",
    "boundaryGravity",
    "initialTemperature",
  ]) {
    requireFiniteNumber(options[name], `${label}.${name}`);
  }
  for (const name of [
    "dataAlignmentStrength",
    "lambdaAlignmentStrength",
    "anchorAlignmentStrength",
  ]) {
    requireFiniteNumber(options[name], `${label}.${name}`, { maximum: 1 });
  }
  for (const name of [
    "componentCompactionIterations",
    "constraintIterations",
    "collisionIterations",
  ]) {
    if (
      !Number.isInteger(options[name]) ||
      options[name] < 1 ||
      options[name] > 10_000
    ) {
      throw new Error(`${label}.${name} must be an integer between 1 and 10000`);
    }
  }
  if (!Number.isInteger(options.randomSeed)) {
    throw new Error(`${label}.randomSeed must be an integer`);
  }
  if (
    !Number.isInteger(options.precision) ||
    options.precision < 0 ||
    options.precision > 6
  ) {
    throw new Error(`${label}.precision must be an integer between 0 and 6`);
  }
  for (const name of [
    "componentCompaction",
    "failOnOverlap",
    "failOnDirectionViolation",
  ]) {
    if (typeof options[name] !== "boolean") {
      throw new Error(`${label}.${name} must be a boolean`);
    }
  }
  options.nodeDimensions = normalizeNodeDimensionOverrides(
    options.nodeDimensions,
    `${label}.nodeDimensions`,
  );
  options.elkOptions = normalizeElkOptions(
    options.elkOptions,
    `${label}.elkOptions`,
  );
  return options;
};

const decodeData = (data, label) => {
  if (typeof data !== "string" || !BASE64_PATTERN.test(data)) {
    throw new Error(`${label} must be base64-encoded JSON`);
  }
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    throw new Error(`${label} must be base64-encoded JSON`);
  }
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
    const decoded = decodeData(node.data, `graph.nodes[${index}].data`);
    if (!decoded?.leaf || typeof decoded.leaf !== "object" || Array.isArray(decoded.leaf)) {
      throw new Error(`graph.nodes[${index}].data must contain a leaf object`);
    }
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
    for (const [index, edge] of record.node.out_edges.entries()) {
      const label = `node ${record.node.uuid}.out_edges[${index}]`;
      if (typeof edge?.uuid !== "string" || edge.uuid.length === 0) {
        throw new Error(`${label}.uuid must be a non-empty string`);
      }
      if (edgeIds.has(edge.uuid)) throw new Error(`graph has duplicate edge UUID ${edge.uuid}`);
      edgeIds.add(edge.uuid);
      const source = typeof edge.source === "string" ? edge.source : edge.source?.uuid;
      const target = typeof edge.target === "string" ? edge.target : edge.target?.uuid;
      if (source !== record.node.uuid) {
        throw new Error(`edge ${edge.uuid} must be nested under its source node`);
      }
      if (!nodeIds.has(target)) throw new Error(`edge ${edge.uuid} targets missing node ${target}`);
      const decoded = decodeData(edge.data, `${label}.data`);
      const type = decoded?.leaf?.logic?.type;
      if (typeof type !== "string" || type.length === 0) {
        throw new Error(`${label}.data must contain leaf.logic.type`);
      }
      edges.push({ uuid: edge.uuid, source, target, type });
    }
  }
  edges.sort((left, right) => left.uuid.localeCompare(right.uuid));
  return { records, edges };
};

const cyclicEdgeIds = (nodeIds, edges) => {
  const outgoing = new Map([...nodeIds].map((uuid) => [uuid, []]));
  for (const edge of edges) outgoing.get(edge.source).push(edge.target);
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const componentByNode = new Map();
  const componentSizes = new Map();

  const visit = (uuid) => {
    indices.set(uuid, nextIndex);
    lowLinks.set(uuid, nextIndex);
    nextIndex += 1;
    stack.push(uuid);
    onStack.add(uuid);
    for (const target of outgoing.get(uuid)) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(uuid, Math.min(lowLinks.get(uuid), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(uuid, Math.min(lowLinks.get(uuid), indices.get(target)));
      }
    }
    if (lowLinks.get(uuid) !== indices.get(uuid)) return;
    const component = uuid;
    let size = 0;
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      componentByNode.set(member, component);
      size += 1;
      if (member === uuid) break;
    }
    componentSizes.set(component, size);
  };
  for (const uuid of [...nodeIds].sort((left, right) => left.localeCompare(right))) {
    if (!indices.has(uuid)) visit(uuid);
  }
  return new Set(
    edges
      .filter((edge) => {
        const component = componentByNode.get(edge.source);
        return (
          component === componentByNode.get(edge.target) &&
          (componentSizes.get(component) > 1 || edge.source === edge.target)
        );
      })
      .map((edge) => edge.uuid),
  );
};

const dataProjection = (sourceGraph, dataEdgeIds) => {
  const graph = structuredClone(sourceGraph);
  for (const node of graph.nodes) {
    node.out_edges = node.out_edges.filter((edge) => dataEdgeIds.has(edge.uuid));
  }
  return graph;
};

const decodePosition = (node) => {
  const decoded = decodeData(node.data, `node ${node.uuid}.data`);
  const position = decoded?.leaf?.appdata?.position;
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
    throw new Error(`ELK data layout did not return coordinates for node ${node.uuid}`);
  }
  return position;
};

const hashUnit = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
};

const pairDirection = (leftUuid, rightUuid, axis) => {
  const value = hashUnit(`${leftUuid}\u0000${rightUuid}:${axis}`);
  return value < 0.5 ? -1 : 1;
};

const buildGraphBoundaries = (records, edges) => {
  const adjacency = new Map(
    records.map((record) => [record.node.uuid, new Set()]),
  );
  for (const edge of edges) {
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }
  const boundaries = [];
  const boundaryByNode = new Map();
  const visited = new Set();
  for (const uuid of [...adjacency.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (visited.has(uuid)) continue;
    const pending = [uuid];
    const nodeUuids = [];
    visited.add(uuid);
    while (pending.length > 0) {
      const current = pending.pop();
      nodeUuids.push(current);
      for (const adjacent of [...adjacency.get(current)].sort((left, right) =>
        right.localeCompare(left),
      )) {
        if (visited.has(adjacent)) continue;
        visited.add(adjacent);
        pending.push(adjacent);
      }
    }
    nodeUuids.sort((left, right) => left.localeCompare(right));
    const boundary = { id: nodeUuids[0], nodeUuids };
    boundaries.push(boundary);
    for (const member of nodeUuids) boundaryByNode.set(member, boundary);
  }
  for (const boundary of boundaries) boundary.edgeUuids = [];
  for (const edge of edges) {
    const boundary = boundaryByNode.get(edge.source);
    if (boundary !== boundaryByNode.get(edge.target)) {
      throw new Error(`edge ${edge.uuid} crosses connected graph boundaries`);
    }
    boundary.edgeUuids.push(edge.uuid);
  }
  for (const boundary of boundaries) {
    boundary.edgeUuids.sort((left, right) => left.localeCompare(right));
  }
  return boundaries;
};

const edgeRouteGeometry = (edge, recordsByUuid, positions) => {
  const sourceRecord = recordsByUuid.get(edge.source);
  const targetRecord = recordsByUuid.get(edge.target);
  const source = positions.get(edge.source);
  const target = positions.get(edge.target);
  if (edge.type === DATA_EDGE) {
    const startPoint = {
      x: source.x + sourceRecord.dimensions.width / 2,
      y: source.y,
    };
    const endPoint = {
      x: target.x - targetRecord.dimensions.width / 2,
      y: target.y,
    };
    const middleX = (startPoint.x + endPoint.x) / 2;
    return {
      startPoint,
      bendPoints:
        Math.abs(startPoint.y - endPoint.y) < 1e-6
          ? []
          : [
              { x: middleX, y: startPoint.y },
              { x: middleX, y: endPoint.y },
            ],
      endPoint,
    };
  }
  if (edge.type === LAMBDA_EDGE || edge.type === ANCHOR_EDGE) {
    const startPoint = {
      x: source.x,
      y: source.y + sourceRecord.dimensions.height / 2,
    };
    const endPoint = {
      x: target.x,
      y: target.y - targetRecord.dimensions.height / 2,
    };
    const middleY = (startPoint.y + endPoint.y) / 2;
    return {
      startPoint,
      bendPoints:
        Math.abs(startPoint.x - endPoint.x) < 1e-6
          ? []
          : [
              { x: startPoint.x, y: middleY },
              { x: endPoint.x, y: middleY },
            ],
      endPoint,
    };
  }
  return {
    startPoint: { ...source },
    bendPoints: [],
    endPoint: { ...target },
  };
};

const graphBoundaryBounds = (
  boundary,
  positions,
  recordsByUuid,
  edgesByUuid,
) => {
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (const uuid of boundary.nodeUuids) {
    const position = positions.get(uuid);
    const dimensions = recordsByUuid.get(uuid).dimensions;
    minimumX = Math.min(minimumX, position.x - dimensions.width / 2);
    maximumX = Math.max(maximumX, position.x + dimensions.width / 2);
    minimumY = Math.min(minimumY, position.y - dimensions.height / 2);
    maximumY = Math.max(maximumY, position.y + dimensions.height / 2);
  }
  for (const uuid of boundary.edgeUuids) {
    const geometry = edgeRouteGeometry(
      edgesByUuid.get(uuid),
      recordsByUuid,
      positions,
    );
    for (const point of [
      geometry.startPoint,
      ...geometry.bendPoints,
      geometry.endPoint,
    ]) {
      minimumX = Math.min(minimumX, point.x);
      maximumX = Math.max(maximumX, point.x);
      minimumY = Math.min(minimumY, point.y);
      maximumY = Math.max(maximumY, point.y);
    }
  }
  return {
    id: boundary.id,
    minimumX,
    maximumX,
    minimumY,
    maximumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
    centerX: (minimumX + maximumX) / 2,
    centerY: (minimumY + maximumY) / 2,
  };
};

const squared = (value) => value * value;

const pointSegmentDistanceSquared = (point, start, end) => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = squared(deltaX) + squared(deltaY);
  if (lengthSquared <= 1e-12) {
    return squared(point.x - start.x) + squared(point.y - start.y);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        lengthSquared,
    ),
  );
  return (
    squared(point.x - (start.x + projection * deltaX)) +
    squared(point.y - (start.y + projection * deltaY))
  );
};

const geometryOrientation = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const pointOnSegment = (point, start, end) =>
  Math.abs(geometryOrientation(start, end, point)) <= 1e-9 &&
  point.x >= Math.min(start.x, end.x) - 1e-9 &&
  point.x <= Math.max(start.x, end.x) + 1e-9 &&
  point.y >= Math.min(start.y, end.y) - 1e-9 &&
  point.y <= Math.max(start.y, end.y) + 1e-9;

const segmentsIntersect = (leftStart, leftEnd, rightStart, rightEnd) => {
  const values = [
    geometryOrientation(leftStart, leftEnd, rightStart),
    geometryOrientation(leftStart, leftEnd, rightEnd),
    geometryOrientation(rightStart, rightEnd, leftStart),
    geometryOrientation(rightStart, rightEnd, leftEnd),
  ];
  if (
    ((values[0] > 1e-9 && values[1] < -1e-9) ||
      (values[0] < -1e-9 && values[1] > 1e-9)) &&
    ((values[2] > 1e-9 && values[3] < -1e-9) ||
      (values[2] < -1e-9 && values[3] > 1e-9))
  ) {
    return true;
  }
  return (
    (Math.abs(values[0]) <= 1e-9 &&
      pointOnSegment(rightStart, leftStart, leftEnd)) ||
    (Math.abs(values[1]) <= 1e-9 &&
      pointOnSegment(rightEnd, leftStart, leftEnd)) ||
    (Math.abs(values[2]) <= 1e-9 &&
      pointOnSegment(leftStart, rightStart, rightEnd)) ||
    (Math.abs(values[3]) <= 1e-9 &&
      pointOnSegment(leftEnd, rightStart, rightEnd))
  );
};

const segmentDistanceSquared = (left, right) => {
  if (segmentsIntersect(left.start, left.end, right.start, right.end)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(left.start, right.start, right.end),
    pointSegmentDistanceSquared(left.end, right.start, right.end),
    pointSegmentDistanceSquared(right.start, left.start, left.end),
    pointSegmentDistanceSquared(right.end, left.start, left.end),
  );
};

const rectangleDistanceSquared = (left, right) => {
  const deltaX = Math.max(
    0,
    left.minimumX - right.maximumX,
    right.minimumX - left.maximumX,
  );
  const deltaY = Math.max(
    0,
    left.minimumY - right.maximumY,
    right.minimumY - left.maximumY,
  );
  return squared(deltaX) + squared(deltaY);
};

const pointRectangleDistanceSquared = (point, rectangle) => {
  const nearestX = Math.max(
    rectangle.minimumX,
    Math.min(rectangle.maximumX, point.x),
  );
  const nearestY = Math.max(
    rectangle.minimumY,
    Math.min(rectangle.maximumY, point.y),
  );
  return squared(point.x - nearestX) + squared(point.y - nearestY);
};

const segmentRectangleDistanceSquared = (segment, rectangle) => {
  const corners = [
    { x: rectangle.minimumX, y: rectangle.minimumY },
    { x: rectangle.maximumX, y: rectangle.minimumY },
    { x: rectangle.maximumX, y: rectangle.maximumY },
    { x: rectangle.minimumX, y: rectangle.maximumY },
  ];
  const sides = corners.map((start, index) => ({
    start,
    end: corners[(index + 1) % corners.length],
  }));
  return Math.min(
    pointRectangleDistanceSquared(segment.start, rectangle),
    pointRectangleDistanceSquared(segment.end, rectangle),
    ...corners.map((corner) =>
      pointSegmentDistanceSquared(corner, segment.start, segment.end),
    ),
    ...sides.map((side) => segmentDistanceSquared(segment, side)),
  );
};

const primitiveBounds = (primitive) => {
  if (primitive.minimumX != null) return primitive;
  return {
    minimumX: Math.min(primitive.start.x, primitive.end.x),
    maximumX: Math.max(primitive.start.x, primitive.end.x),
    minimumY: Math.min(primitive.start.y, primitive.end.y),
    maximumY: Math.max(primitive.start.y, primitive.end.y),
  };
};

const buildBoundaryGeometry = (
  boundary,
  positions,
  recordsByUuid,
  edgesByUuid,
) => {
  const rectangles = boundary.nodeUuids.map((uuid) => {
    const position = positions.get(uuid);
    const dimensions = recordsByUuid.get(uuid).dimensions;
    return {
      uuid,
      minimumX: position.x - dimensions.width / 2,
      maximumX: position.x + dimensions.width / 2,
      minimumY: position.y - dimensions.height / 2,
      maximumY: position.y + dimensions.height / 2,
    };
  });
  const segments = [];
  for (const uuid of boundary.edgeUuids) {
    const route = edgeRouteGeometry(
      edgesByUuid.get(uuid),
      recordsByUuid,
      positions,
    );
    const points = [route.startPoint, ...route.bendPoints, route.endPoint];
    for (let index = 1; index < points.length; index += 1) {
      const segment = {
        uuid,
        start: points[index - 1],
        end: points[index],
      };
      segments.push({ ...segment, ...primitiveBounds(segment) });
    }
  }
  return {
    id: boundary.id,
    rectangles,
    segments,
    members: [...rectangles, ...segments].map(primitiveBounds),
    bounds: graphBoundaryBounds(
      boundary,
      positions,
      recordsByUuid,
      edgesByUuid,
    ),
  };
};

const translateGeometry = (geometry, x, y) => ({
  ...geometry,
  rectangles: geometry.rectangles.map((rectangle) => ({
    ...rectangle,
    minimumX: rectangle.minimumX + x,
    maximumX: rectangle.maximumX + x,
    minimumY: rectangle.minimumY + y,
    maximumY: rectangle.maximumY + y,
  })),
  segments: geometry.segments.map((segment) => ({
    ...segment,
    start: { x: segment.start.x + x, y: segment.start.y + y },
    end: { x: segment.end.x + x, y: segment.end.y + y },
    minimumX: segment.minimumX + x,
    maximumX: segment.maximumX + x,
    minimumY: segment.minimumY + y,
    maximumY: segment.maximumY + y,
  })),
  members: geometry.members.map((member) => ({
    minimumX: member.minimumX + x,
    maximumX: member.maximumX + x,
    minimumY: member.minimumY + y,
    maximumY: member.maximumY + y,
  })),
  bounds: {
    ...geometry.bounds,
    minimumX: geometry.bounds.minimumX + x,
    maximumX: geometry.bounds.maximumX + x,
    minimumY: geometry.bounds.minimumY + y,
    maximumY: geometry.bounds.maximumY + y,
    centerX: geometry.bounds.centerX + x,
    centerY: geometry.bounds.centerY + y,
  },
});

const belowClearance = (distanceSquared, padding) =>
  padding <= 1e-7
    ? distanceSquared <= 1e-12
    : distanceSquared < squared(padding - 1e-7);

const boundaryMembersOverlap = (left, right, padding) => {
  const broadPhase = boundaryOverlap(left.bounds, right.bounds, padding);
  if (broadPhase.x <= 1e-9 || broadPhase.y <= 1e-9) return false;
  for (const leftRectangle of left.rectangles) {
    for (const rightRectangle of right.rectangles) {
      if (
        belowClearance(
          rectangleDistanceSquared(leftRectangle, rightRectangle),
          padding,
        )
      ) {
        return true;
      }
    }
    for (const rightSegment of right.segments) {
      if (
        !belowClearance(
          rectangleDistanceSquared(leftRectangle, rightSegment),
          padding,
        )
      ) {
        continue;
      }
      if (
        belowClearance(
          segmentRectangleDistanceSquared(rightSegment, leftRectangle),
          padding,
        )
      ) {
        return true;
      }
    }
  }
  for (const leftSegment of left.segments) {
    for (const rightRectangle of right.rectangles) {
      if (
        !belowClearance(
          rectangleDistanceSquared(leftSegment, rightRectangle),
          padding,
        )
      ) {
        continue;
      }
      if (
        belowClearance(
          segmentRectangleDistanceSquared(leftSegment, rightRectangle),
          padding,
        )
      ) {
        return true;
      }
    }
    for (const rightSegment of right.segments) {
      if (
        !belowClearance(
          rectangleDistanceSquared(leftSegment, rightSegment),
          padding,
        )
      ) {
        continue;
      }
      if (
        belowClearance(
          segmentDistanceSquared(leftSegment, rightSegment),
          padding,
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

const translateBoundary = (boundary, positions, x, y) => {
  for (const uuid of boundary.nodeUuids) {
    const position = positions.get(uuid);
    position.x += x;
    position.y += y;
  }
};

const boundaryOverlap = (left, right, padding) => ({
  x:
    (left.width + right.width) / 2 +
    padding -
    Math.abs(left.centerX - right.centerX),
  y:
    (left.height + right.height) / 2 +
    padding -
    Math.abs(left.centerY - right.centerY),
});

const separateBoundarySweep = (
  boundaries,
  positions,
  recordsByUuid,
  edgesByUuid,
  padding,
) => {
  let found = false;
  for (let leftIndex = 0; leftIndex < boundaries.length; leftIndex += 1) {
    const leftBoundary = boundaries[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < boundaries.length;
      rightIndex += 1
    ) {
      const rightBoundary = boundaries[rightIndex];
      const left = graphBoundaryBounds(
        leftBoundary,
        positions,
        recordsByUuid,
        edgesByUuid,
      );
      const right = graphBoundaryBounds(
        rightBoundary,
        positions,
        recordsByUuid,
        edgesByUuid,
      );
      const overlap = boundaryOverlap(left, right, padding);
      if (overlap.x <= 1e-9 || overlap.y <= 1e-9) continue;
      found = true;
      const axis = overlap.x <= overlap.y ? "x" : "y";
      const delta =
        axis === "x"
          ? left.centerX - right.centerX
          : left.centerY - right.centerY;
      const direction =
        Math.abs(delta) > 1e-9
          ? Math.sign(delta)
          : pairDirection(leftBoundary.id, rightBoundary.id, axis);
      const movement = overlap[axis] / 2;
      translateBoundary(
        leftBoundary,
        positions,
        axis === "x" ? direction * movement : 0,
        axis === "y" ? direction * movement : 0,
      );
      translateBoundary(
        rightBoundary,
        positions,
        axis === "x" ? -direction * movement : 0,
        axis === "y" ? -direction * movement : 0,
      );
    }
  }
  return found;
};

const countBoundaryAabbOverlaps = (
  boundaries,
  positions,
  recordsByUuid,
  edgesByUuid,
  padding,
) => {
  const bounds = boundaries.map((boundary) =>
    graphBoundaryBounds(boundary, positions, recordsByUuid, edgesByUuid),
  );
  let count = 0;
  for (let left = 0; left < bounds.length; left += 1) {
    for (let right = left + 1; right < bounds.length; right += 1) {
      const overlap = boundaryOverlap(bounds[left], bounds[right], padding);
      if (overlap.x > 1e-6 && overlap.y > 1e-6) count += 1;
    }
  }
  return count;
};

const enforceBoundarySeparation = (
  boundaries,
  positions,
  recordsByUuid,
  edgesByUuid,
  padding,
) => {
  const sweepLimit = Math.max(1, boundaries.length * boundaries.length * 4);
  for (let iteration = 0; iteration < sweepLimit; iteration += 1) {
    if (
      !separateBoundarySweep(
        boundaries,
        positions,
        recordsByUuid,
        edgesByUuid,
        padding,
      )
    ) {
      return;
    }
  }
  if (
    countBoundaryAabbOverlaps(
      boundaries,
      positions,
      recordsByUuid,
      edgesByUuid,
      padding,
    ) === 0
  ) {
    return;
  }

  const ordered = [...boundaries].sort((leftBoundary, rightBoundary) => {
    const left = graphBoundaryBounds(
      leftBoundary,
      positions,
      recordsByUuid,
      edgesByUuid,
    );
    const right = graphBoundaryBounds(
      rightBoundary,
      positions,
      recordsByUuid,
      edgesByUuid,
    );
    return (
      left.minimumX - right.minimumX ||
      leftBoundary.id.localeCompare(rightBoundary.id)
    );
  });
  let maximumX = -Infinity;
  for (const boundary of ordered) {
    let bounds = graphBoundaryBounds(
      boundary,
      positions,
      recordsByUuid,
      edgesByUuid,
    );
    if (Number.isFinite(maximumX)) {
      translateBoundary(
        boundary,
        positions,
        maximumX + padding - bounds.minimumX,
        0,
      );
      bounds = graphBoundaryBounds(
        boundary,
        positions,
        recordsByUuid,
        edgesByUuid,
      );
    }
    maximumX = bounds.maximumX;
  }
};

const compareScores = (left, right) => {
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > 1e-7) {
      return left[index] - right[index];
    }
  }
  return 0;
};

const geometryEnvelope = (geometries) => {
  const minimumX = Math.min(...geometries.map(({ bounds }) => bounds.minimumX));
  const maximumX = Math.max(...geometries.map(({ bounds }) => bounds.maximumX));
  const minimumY = Math.min(...geometries.map(({ bounds }) => bounds.minimumY));
  const maximumY = Math.max(...geometries.map(({ bounds }) => bounds.maximumY));
  return {
    minimumX,
    maximumX,
    minimumY,
    maximumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
    centerX: (minimumX + maximumX) / 2,
    centerY: (minimumY + maximumY) / 2,
  };
};

const componentLayoutScore = (geometries) => {
  const envelope = geometryEnvelope(geometries);
  const centerDistance = geometries.reduce(
    (total, geometry) =>
      total +
      squared(geometry.bounds.centerX - envelope.centerX) +
      squared(geometry.bounds.centerY - envelope.centerY),
    0,
  );
  return [
    envelope.width * envelope.height,
    envelope.width + envelope.height,
    centerDistance,
  ];
};

const selectAxisCandidates = (
  values,
  movingBounds,
  fixedEnvelope,
  axis,
  limit = 24,
) => {
  const minimum = axis === "x" ? "minimumX" : "minimumY";
  const maximum = axis === "x" ? "maximumX" : "maximumY";
  const center = axis === "x" ? "centerX" : "centerY";
  const ranked = [...values].sort((left, right) => {
    const leftSpan =
      Math.max(fixedEnvelope[maximum], movingBounds[maximum] + left) -
      Math.min(fixedEnvelope[minimum], movingBounds[minimum] + left);
    const rightSpan =
      Math.max(fixedEnvelope[maximum], movingBounds[maximum] + right) -
      Math.min(fixedEnvelope[minimum], movingBounds[minimum] + right);
    return (
      leftSpan - rightSpan ||
      Math.abs(movingBounds[center] + left - fixedEnvelope[center]) -
        Math.abs(movingBounds[center] + right - fixedEnvelope[center]) ||
      Math.abs(left) - Math.abs(right) ||
      left - right
    );
  });
  const selected = ranked.slice(0, limit);
  if (!selected.some((value) => Math.abs(value) <= 1e-9)) selected.push(0);
  return selected;
};

const componentContactCandidates = (moving, fixed, padding) => {
  const xValues = new Set([0]);
  const yValues = new Set([0]);
  for (const movingMember of moving.members) {
    for (const fixedGeometry of fixed) {
      for (const fixedMember of fixedGeometry.members) {
        xValues.add(
          fixedMember.minimumX - padding - movingMember.maximumX,
        );
        xValues.add(
          fixedMember.maximumX + padding - movingMember.minimumX,
        );
        yValues.add(
          fixedMember.minimumY - padding - movingMember.maximumY,
        );
        yValues.add(
          fixedMember.maximumY + padding - movingMember.minimumY,
        );
      }
    }
  }
  const fixedEnvelope = geometryEnvelope(fixed);
  return {
    xValues: selectAxisCandidates(
      xValues,
      moving.bounds,
      fixedEnvelope,
      "x",
    ),
    yValues: selectAxisCandidates(
      yValues,
      moving.bounds,
      fixedEnvelope,
      "y",
    ),
  };
};

const compactBoundaryMembers = (
  boundaries,
  positions,
  recordsByUuid,
  edgesByUuid,
  padding,
  iterations,
) => {
  if (boundaries.length < 2) return;
  const ordered = [...boundaries].sort((left, right) => {
    const leftBounds = graphBoundaryBounds(
      left,
      positions,
      recordsByUuid,
      edgesByUuid,
    );
    const rightBounds = graphBoundaryBounds(
      right,
      positions,
      recordsByUuid,
      edgesByUuid,
    );
    return (
      rightBounds.width * rightBounds.height -
        leftBounds.width * leftBounds.height || left.id.localeCompare(right.id)
    );
  });
  const geometryById = new Map(
    ordered.map((boundary) => [
      boundary.id,
      buildBoundaryGeometry(
        boundary,
        positions,
        recordsByUuid,
        edgesByUuid,
      ),
    ]),
  );

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let changed = false;
    for (const boundary of ordered.slice(1)) {
      const moving = geometryById.get(boundary.id);
      const fixed = ordered
        .filter((candidate) => candidate.id !== boundary.id)
        .map((candidate) => geometryById.get(candidate.id));
      const { xValues, yValues } = componentContactCandidates(
        moving,
        fixed,
        padding,
      );
      let bestGeometry = moving;
      let bestMovement = { x: 0, y: 0 };
      let bestScore = [
        ...componentLayoutScore([...fixed, moving]),
        0,
        0,
        0,
      ];
      for (const x of xValues) {
        for (const y of yValues) {
          if (Math.abs(x) <= 1e-9 && Math.abs(y) <= 1e-9) continue;
          const candidate = translateGeometry(moving, x, y);
          if (
            fixed.some((geometry) =>
              boundaryMembersOverlap(candidate, geometry, padding),
            )
          ) {
            continue;
          }
          const score = [
            ...componentLayoutScore([...fixed, candidate]),
            squared(x) + squared(y),
            x,
            y,
          ];
          if (compareScores(score, bestScore) < 0) {
            bestGeometry = candidate;
            bestMovement = { x, y };
            bestScore = score;
          }
        }
      }
      if (
        Math.abs(bestMovement.x) <= 1e-9 &&
        Math.abs(bestMovement.y) <= 1e-9
      ) {
        continue;
      }
      translateBoundary(
        boundary,
        positions,
        bestMovement.x,
        bestMovement.y,
      );
      geometryById.set(boundary.id, bestGeometry);
      changed = true;
    }
    if (!changed) break;
  }
};

const countBoundaryMemberOverlaps = (
  boundaries,
  positions,
  recordsByUuid,
  edgesByUuid,
  padding,
) => {
  const geometries = boundaries.map((boundary) =>
    buildBoundaryGeometry(boundary, positions, recordsByUuid, edgesByUuid),
  );
  let count = 0;
  for (let left = 0; left < geometries.length; left += 1) {
    for (let right = left + 1; right < geometries.length; right += 1) {
      if (boundaryMembersOverlap(geometries[left], geometries[right], padding)) {
        count += 1;
      }
    }
  }
  return count;
};

const directionalClearance = (leftRecord, rightRecord, unitX, unitY, padding) =>
  (Math.abs(unitX) *
    (leftRecord.dimensions.width + rightRecord.dimensions.width)) /
    2 +
  (Math.abs(unitY) *
    (leftRecord.dimensions.height + rightRecord.dimensions.height)) /
    2 +
  padding;

const addDisplacement = (displacement, uuid, x, y) => {
  const movement = displacement.get(uuid);
  movement.x += x;
  movement.y += y;
};

const applySemanticForces = (
  records,
  recordsByUuid,
  edges,
  edgesByUuid,
  boundaries,
  positions,
  forceConstant,
  temperature,
  options,
) => {
  if (temperature <= 0 || records.length === 0) return;
  const displacement = new Map(
    records.map((record) => [record.node.uuid, { x: 0, y: 0 }]),
  );
  for (const boundary of boundaries) {
    for (let leftIndex = 0; leftIndex < boundary.nodeUuids.length; leftIndex += 1) {
      const leftUuid = boundary.nodeUuids[leftIndex];
      const leftRecord = recordsByUuid.get(leftUuid);
      const left = positions.get(leftUuid);
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < boundary.nodeUuids.length;
        rightIndex += 1
      ) {
        const rightUuid = boundary.nodeUuids[rightIndex];
        const rightRecord = recordsByUuid.get(rightUuid);
        const right = positions.get(rightUuid);
        let deltaX = left.x - right.x;
        let deltaY = left.y - right.y;
        let distance = Math.hypot(deltaX, deltaY);
        if (distance < 1e-9) {
          deltaX = pairDirection(leftUuid, rightUuid, "x");
          deltaY = pairDirection(leftUuid, rightUuid, "y");
          distance = Math.hypot(deltaX, deltaY);
        }
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        const clearance = directionalClearance(
          leftRecord,
          rightRecord,
          unitX,
          unitY,
          options.collisionPadding,
        );
        const surfaceDistance = Math.max(1, distance - clearance);
        const force =
          (options.repulsion * forceConstant * forceConstant) / surfaceDistance;
        addDisplacement(displacement, leftUuid, unitX * force, unitY * force);
        addDisplacement(displacement, rightUuid, -unitX * force, -unitY * force);
      }
    }
  }
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const sourceRecord = recordsByUuid.get(edge.source);
    const targetRecord = recordsByUuid.get(edge.target);
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    let deltaX = source.x - target.x;
    let deltaY = source.y - target.y;
    let distance = Math.hypot(deltaX, deltaY);
    if (distance < 1e-9) {
      deltaX = pairDirection(edge.source, edge.target, "x");
      deltaY = pairDirection(edge.source, edge.target, "y");
      distance = Math.hypot(deltaX, deltaY);
    }
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const clearance = directionalClearance(
      sourceRecord,
      targetRecord,
      unitX,
      unitY,
      options.collisionPadding,
    );
    const surfaceDistance = Math.max(0, distance - clearance);
    const force =
      (options.attraction * surfaceDistance * surfaceDistance) / forceConstant;
    addDisplacement(displacement, edge.source, -unitX * force, -unitY * force);
    addDisplacement(displacement, edge.target, unitX * force, unitY * force);
  }
  applyLeafEdgeGeometryForces(
    records,
    edges,
    positions,
    displacement,
    forceConstant,
    options,
  );

  const boundaryBounds = new Map(
    boundaries.map((boundary) => [
      boundary.id,
      graphBoundaryBounds(boundary, positions, recordsByUuid, edgesByUuid),
    ]),
  );
  const overallCenter = records.reduce(
    (center, record) => {
      const position = positions.get(record.node.uuid);
      center.x += position.x / records.length;
      center.y += position.y / records.length;
      return center;
    },
    { x: 0, y: 0 },
  );
  const boundaryDisplacement = new Map(
    boundaries.map((boundary) => [boundary.id, { x: 0, y: 0 }]),
  );
  for (let leftIndex = 0; leftIndex < boundaries.length; leftIndex += 1) {
    const leftBoundary = boundaries[leftIndex];
    const left = boundaryBounds.get(leftBoundary.id);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < boundaries.length;
      rightIndex += 1
    ) {
      const rightBoundary = boundaries[rightIndex];
      const right = boundaryBounds.get(rightBoundary.id);
      let deltaX = left.centerX - right.centerX;
      let deltaY = left.centerY - right.centerY;
      let distance = Math.hypot(deltaX, deltaY);
      if (distance < 1e-9) {
        deltaX = pairDirection(leftBoundary.id, rightBoundary.id, "x");
        deltaY = pairDirection(leftBoundary.id, rightBoundary.id, "y");
        distance = Math.hypot(deltaX, deltaY);
      }
      const unitX = deltaX / distance;
      const unitY = deltaY / distance;
      const clearance =
        (Math.abs(unitX) * (left.width + right.width)) / 2 +
        (Math.abs(unitY) * (left.height + right.height)) / 2 +
        options.boundaryPadding;
      const surfaceDistance = Math.max(1, distance - clearance);
      const force =
        (options.boundaryRepulsion * forceConstant * forceConstant) /
        surfaceDistance;
      const leftMovement = boundaryDisplacement.get(leftBoundary.id);
      const rightMovement = boundaryDisplacement.get(rightBoundary.id);
      leftMovement.x += unitX * force;
      leftMovement.y += unitY * force;
      rightMovement.x -= unitX * force;
      rightMovement.y -= unitY * force;
    }
  }
  for (const boundary of boundaries) {
    const bounds = boundaryBounds.get(boundary.id);
    const groupMovement = boundaryDisplacement.get(boundary.id);
    groupMovement.x +=
      (overallCenter.x - bounds.centerX) * options.boundaryGravity;
    groupMovement.y +=
      (overallCenter.y - bounds.centerY) * options.boundaryGravity;
    const massScale = 1 / Math.sqrt(boundary.nodeUuids.length);
    for (const uuid of boundary.nodeUuids) {
      const position = positions.get(uuid);
      addDisplacement(
        displacement,
        uuid,
        groupMovement.x * massScale +
          (bounds.centerX - position.x) * options.gravity,
        groupMovement.y * massScale +
          (bounds.centerY - position.y) * options.gravity,
      );
    }
  }
  for (const record of records) {
    const uuid = record.node.uuid;
    const movement = displacement.get(uuid);
    const magnitude = Math.hypot(movement.x, movement.y);
    if (magnitude <= 0) continue;
    const step = Math.min(magnitude, temperature);
    const position = positions.get(uuid);
    position.x += (movement.x / magnitude) * step;
    position.y += (movement.y / magnitude) * step;
  }
};

const applyConstraints = (
  positions,
  recordsByUuid,
  dataEdges,
  verticalEdges,
  cycleEdges,
  options,
  alignmentScale,
) => {
  for (const edge of dataEdges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const sourceRecord = recordsByUuid.get(edge.source);
    const targetRecord = recordsByUuid.get(edge.target);
    const alignment =
      (target.y - source.y) * options.dataAlignmentStrength * alignmentScale * 0.5;
    source.y += alignment;
    target.y -= alignment;
    if (cycleEdges.has(edge.uuid)) continue;
    const minimumDistance =
      (sourceRecord.dimensions.width + targetRecord.dimensions.width) / 2 +
      options.dataSpacing;
    const violation = minimumDistance - (target.x - source.x);
    if (violation > 0) {
      source.x -= violation / 2;
      target.x += violation / 2;
    }
  }
  for (const edge of verticalEdges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const sourceRecord = recordsByUuid.get(edge.source);
    const targetRecord = recordsByUuid.get(edge.target);
    const alignmentStrength =
      edge.type === ANCHOR_EDGE
        ? options.anchorAlignmentStrength
        : options.lambdaAlignmentStrength;
    const alignment =
      (target.x - source.x) * alignmentStrength * alignmentScale * 0.5;
    source.x += alignment;
    target.x -= alignment;
    if (cycleEdges.has(edge.uuid)) continue;
    const spacing =
      edge.type === ANCHOR_EDGE ? options.anchorSpacing : options.lambdaSpacing;
    const minimumDistance =
      (sourceRecord.dimensions.height + targetRecord.dimensions.height) / 2 +
      spacing;
    const violation = minimumDistance - (target.y - source.y);
    if (violation > 0) {
      source.y -= violation / 2;
      target.y += violation / 2;
    }
  }
};

const separateCollisionSweep = (records, positions, padding) => {
  let found = false;
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const leftRecord = records[leftIndex];
    const left = positions.get(leftRecord.node.uuid);
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const rightRecord = records[rightIndex];
      const right = positions.get(rightRecord.node.uuid);
      const overlapX =
        (leftRecord.dimensions.width + rightRecord.dimensions.width) / 2 +
        padding -
        Math.abs(left.x - right.x);
      const overlapY =
        (leftRecord.dimensions.height + rightRecord.dimensions.height) / 2 +
        padding -
        Math.abs(left.y - right.y);
      if (overlapX <= 1e-9 || overlapY <= 1e-9) continue;
      found = true;
      const axis = overlapX <= overlapY ? "x" : "y";
      const overlap = axis === "x" ? overlapX : overlapY;
      const delta = left[axis] - right[axis];
      const direction =
        Math.abs(delta) > 1e-9
          ? Math.sign(delta)
          : pairDirection(leftRecord.node.uuid, rightRecord.node.uuid, axis);
      left[axis] += direction * overlap * 0.5;
      right[axis] -= direction * overlap * 0.5;
    }
  }
  return found;
};

const round = (value, precision) => {
  const factor = 10 ** precision;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
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

const segmentIntersectsRectInterior = (start, end, rect) => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  for (const [origin, delta, low, high] of [
    [start.x, deltaX, rect.x, rect.x + rect.width],
    [start.y, deltaY, rect.y, rect.y + rect.height],
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
  const x = start.x + deltaX * middle;
  const y = start.y + deltaY * middle;
  return (
    x > rect.x + 1e-6 &&
    x < rect.x + rect.width - 1e-6 &&
    y > rect.y + 1e-6 &&
    y < rect.y + rect.height - 1e-6
  );
};

const calculateMetrics = (records, edges, positions, options) => {
  const boxes = records.map((record) => {
    const center = positions.get(record.node.uuid);
    return {
      uuid: record.node.uuid,
      x: center.x - record.dimensions.width / 2,
      y: center.y - record.dimensions.height / 2,
      width: record.dimensions.width,
      height: record.dimensions.height,
      center,
    };
  });
  const boxesByUuid = new Map(boxes.map((box) => [box.uuid, box]));
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

  let dataDirectionViolationCount = 0;
  let lambdaDirectionViolationCount = 0;
  let anchorDirectionViolationCount = 0;
  let dataAlignmentTotal = 0;
  let lambdaAlignmentTotal = 0;
  let anchorAlignmentTotal = 0;
  for (const edge of edges) {
    const source = boxesByUuid.get(edge.source);
    const target = boxesByUuid.get(edge.target);
    if (edge.type === DATA_EDGE) {
      if (target.x - (source.x + source.width) < options.dataSpacing - 1e-6) {
        dataDirectionViolationCount += 1;
      }
      dataAlignmentTotal += Math.abs(source.center.y - target.center.y);
    } else if (edge.type === LAMBDA_EDGE) {
      if (target.y - (source.y + source.height) < options.lambdaSpacing - 1e-6) {
        lambdaDirectionViolationCount += 1;
      }
      lambdaAlignmentTotal += Math.abs(source.center.x - target.center.x);
    } else if (edge.type === ANCHOR_EDGE) {
      if (target.y - (source.y + source.height) < options.anchorSpacing - 1e-6) {
        anchorDirectionViolationCount += 1;
      }
      anchorAlignmentTotal += Math.abs(source.center.x - target.center.x);
    }
  }

  let edgeCrossingCount = 0;
  let dataDataCrossingCount = 0;
  let lambdaLambdaCrossingCount = 0;
  let anchorAnchorCrossingCount = 0;
  let mixedEdgeCrossingCount = 0;
  for (let left = 0; left < edges.length; left += 1) {
    const a = edges[left];
    for (let right = left + 1; right < edges.length; right += 1) {
      const b = edges[right];
      if ([a.source, a.target].some((uuid) => uuid === b.source || uuid === b.target)) {
        continue;
      }
      if (
        !strictlyCrosses(
          boxesByUuid.get(a.source).center,
          boxesByUuid.get(a.target).center,
          boxesByUuid.get(b.source).center,
          boxesByUuid.get(b.target).center,
        )
      ) {
        continue;
      }
      edgeCrossingCount += 1;
      if (a.type === DATA_EDGE && b.type === DATA_EDGE) dataDataCrossingCount += 1;
      else if (a.type === LAMBDA_EDGE && b.type === LAMBDA_EDGE) {
        lambdaLambdaCrossingCount += 1;
      } else if (a.type === ANCHOR_EDGE && b.type === ANCHOR_EDGE) {
        anchorAnchorCrossingCount += 1;
      } else mixedEdgeCrossingCount += 1;
    }
  }

  let edgeNodeIntersectionCount = 0;
  for (const edge of edges) {
    const source = boxesByUuid.get(edge.source).center;
    const target = boxesByUuid.get(edge.target).center;
    for (const box of boxes) {
      if (box.uuid === edge.source || box.uuid === edge.target) continue;
      if (segmentIntersectsRectInterior(source, target, box)) {
        edgeNodeIntersectionCount += 1;
      }
    }
  }
  const dataEdges = edges.filter((edge) => edge.type === DATA_EDGE);
  const lambdaEdges = edges.filter((edge) => edge.type === LAMBDA_EDGE);
  const anchorEdges = edges.filter((edge) => edge.type === ANCHOR_EDGE);
  return {
    overlapCount,
    dataDirectionViolationCount,
    lambdaDirectionViolationCount,
    anchorDirectionViolationCount,
    averageDataVerticalDeviation:
      dataEdges.length === 0
        ? 0
        : round(dataAlignmentTotal / dataEdges.length, options.precision),
    averageLambdaHorizontalDeviation:
      lambdaEdges.length === 0
        ? 0
        : round(lambdaAlignmentTotal / lambdaEdges.length, options.precision),
    averageAnchorHorizontalDeviation:
      anchorEdges.length === 0
        ? 0
        : round(anchorAlignmentTotal / anchorEdges.length, options.precision),
    edgeCrossingCount,
    dataDataCrossingCount,
    lambdaLambdaCrossingCount,
    anchorAnchorCrossingCount,
    mixedEdgeCrossingCount,
    edgeNodeIntersectionCount,
  };
};

const routeEdges = (edges, recordsByUuid, positions, precision) =>
  edges.map((edge) => {
    const { startPoint, bendPoints, endPoint } = edgeRouteGeometry(
      edge,
      recordsByUuid,
      positions,
    );
    const point = ({ x, y }) => ({
      x: round(x, precision),
      y: round(y, precision),
    });
    return {
      uuid: edge.uuid,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      sections: [
        {
          startPoint: point(startPoint),
          bendPoints: bendPoints.map(point),
          endPoint: point(endPoint),
        },
      ],
    };
  });

/**
 * Lay out LEAF data edges from left to right and lambda/anchor edges from top
 * to bottom. ELK seeds the data-only backbone; deterministic constraints
 * preserve the semantic edge planes while resolving node collisions. Whole
 * disconnected components are then compacted using their exact node/route
 * geometry rather than their enclosing rectangles.
 */
export const layoutLeafSemanticGraph = async (
  sourceGraph,
  layoutOptions = {},
  runtime = {},
) => {
  const options = normalizeLeafSemanticLayoutOptions(layoutOptions);
  const graph = structuredClone(sourceGraph);
  const { records, edges } = flattenGraph(graph, options);
  const recordsByUuid = new Map(records.map((record) => [record.node.uuid, record]));
  const edgesByUuid = new Map(edges.map((edge) => [edge.uuid, edge]));
  const nodeIds = new Set(recordsByUuid.keys());
  const dataEdges = edges.filter((edge) => edge.type === DATA_EDGE);
  const lambdaEdges = edges.filter((edge) => edge.type === LAMBDA_EDGE);
  const anchorEdges = edges.filter((edge) => edge.type === ANCHOR_EDGE);
  const verticalEdges = [...lambdaEdges, ...anchorEdges].sort((left, right) =>
    left.uuid.localeCompare(right.uuid),
  );
  const otherEdges = edges.filter(
    (edge) => !new Set([DATA_EDGE, LAMBDA_EDGE, ANCHOR_EDGE]).has(edge.type),
  );
  const dataCycleEdges = cyclicEdgeIds(nodeIds, dataEdges);
  const lambdaCycleEdges = cyclicEdgeIds(nodeIds, lambdaEdges);
  const anchorCycleEdges = cyclicEdgeIds(nodeIds, anchorEdges);
  if (
    options.failOnDirectionViolation &&
    (dataCycleEdges.size > 0 ||
      lambdaCycleEdges.size > 0 ||
      anchorCycleEdges.size > 0)
  ) {
    throw new Error(
      `semantic direction constraints are impossible for ${dataCycleEdges.size} cyclic data edge(s), ${lambdaCycleEdges.size} cyclic lambda edge(s), and ${anchorCycleEdges.size} cyclic anchor edge(s); remove the cycle or set failOnDirectionViolation to false`,
    );
  }
  const cycleEdges = new Set([
    ...dataCycleEdges,
    ...lambdaCycleEdges,
    ...anchorCycleEdges,
  ]);
  const projected = dataProjection(
    sourceGraph,
    new Set(dataEdges.map((edge) => edge.uuid)),
  );
  const dataLayout = await layoutLeafTopology(
    projected,
    {
      direction: "RIGHT",
      edgeRouting: "ORTHOGONAL",
      crossingMinimization: "LAYER_SWEEP",
      nodePlacement: "NETWORK_SIMPLEX",
      nodeSpacing: options.nodeSpacing,
      layerSpacing: options.dataSpacing,
      edgeNodeSpacing: options.collisionPadding,
      edgeEdgeSpacing: options.collisionPadding,
      collisionPadding: options.collisionPadding,
      padding: options.padding,
      precision: options.precision,
      randomSeed: options.randomSeed,
      failOnOverlap: true,
      nodeDimensions: options.nodeDimensions,
      elkOptions: options.elkOptions,
    },
    runtime,
  );
  const seedByUuid = new Map(dataLayout.graph.nodes.map((node) => [node.uuid, node]));
  const positions = new Map(
    records.map((record) => {
      const position = decodePosition(seedByUuid.get(record.node.uuid));
      return [
        record.node.uuid,
        {
          x: position.x + record.dimensions.width / 2,
          y: position.y + record.dimensions.height / 2,
        },
      ];
    }),
  );
  const boundaries = buildGraphBoundaries(records, edges);
  const seedArea = Math.max(
    1,
    (dataLayout.width ?? 0) * (dataLayout.height ?? 0),
    records.reduce(
      (area, record) =>
        area + record.dimensions.width * record.dimensions.height * 4,
      0,
    ),
  );
  const forceConstant = Math.sqrt(seedArea / Math.max(1, records.length));

  for (let iteration = 0; iteration < options.constraintIterations; iteration += 1) {
    const alignmentScale = 1 - iteration / options.constraintIterations;
    const temperature = options.initialTemperature * alignmentScale;
    applySemanticForces(
      records,
      recordsByUuid,
      edges,
      edgesByUuid,
      boundaries,
      positions,
      forceConstant,
      temperature,
      options,
    );
    applyConstraints(
      positions,
      recordsByUuid,
      dataEdges,
      verticalEdges,
      cycleEdges,
      options,
      alignmentScale,
    );
    separateCollisionSweep(records, positions, options.collisionPadding);
    applyConstraints(
      positions,
      recordsByUuid,
      dataEdges,
      verticalEdges,
      cycleEdges,
      options,
      0,
    );
    separateBoundarySweep(
      boundaries,
      positions,
      recordsByUuid,
      edgesByUuid,
      options.boundaryPadding,
    );
  }
  for (let iteration = 0; iteration < options.collisionIterations; iteration += 1) {
    applyConstraints(
      positions,
      recordsByUuid,
      dataEdges,
      verticalEdges,
      cycleEdges,
      options,
      0,
    );
    const nodeCollision = separateCollisionSweep(
      records,
      positions,
      options.collisionPadding,
    );
    const boundaryCollision = separateBoundarySweep(
      boundaries,
      positions,
      recordsByUuid,
      edgesByUuid,
      options.boundaryPadding,
    );
    if (!nodeCollision && !boundaryCollision) break;
  }
  applyConstraints(
    positions,
    recordsByUuid,
    dataEdges,
    verticalEdges,
    cycleEdges,
    options,
    0,
  );
  const roundingSafety = 10 ** -options.precision;
  enforceBoundarySeparation(
    boundaries,
    positions,
    recordsByUuid,
    edgesByUuid,
    options.boundaryPadding + roundingSafety * 2,
  );
  if (options.componentCompaction) {
    compactBoundaryMembers(
      boundaries,
      positions,
      recordsByUuid,
      edgesByUuid,
      options.boundaryPadding + roundingSafety * 2,
      options.componentCompactionIterations,
    );
  }

  let minimumX = Infinity;
  let minimumY = Infinity;
  for (const record of records) {
    const position = positions.get(record.node.uuid);
    minimumX = Math.min(minimumX, position.x - record.dimensions.width / 2);
    minimumY = Math.min(minimumY, position.y - record.dimensions.height / 2);
  }
  const translationX = records.length === 0 ? 0 : options.padding - minimumX;
  const translationY = records.length === 0 ? 0 : options.padding - minimumY;
  for (const position of positions.values()) {
    position.x += translationX;
    position.y += translationY;
  }

  const finalCoordinates = new Map();
  for (const record of records) {
    const position = positions.get(record.node.uuid);
    const x = round(position.x - record.dimensions.width / 2, options.precision);
    const y = round(position.y - record.dimensions.height / 2, options.precision);
    finalCoordinates.set(record.node.uuid, { x, y });
    position.x = x + record.dimensions.width / 2;
    position.y = y + record.dimensions.height / 2;
  }
  const metrics = calculateMetrics(records, edges, positions, {
    ...options,
    dataSpacing: Math.max(0, options.dataSpacing - roundingSafety),
    lambdaSpacing: Math.max(0, options.lambdaSpacing - roundingSafety),
    anchorSpacing: Math.max(0, options.anchorSpacing - roundingSafety),
  });
  const graphBoundaryOverlapCount = countBoundaryMemberOverlaps(
    boundaries,
    positions,
    recordsByUuid,
    edgesByUuid,
    options.boundaryPadding,
  );
  const graphBoundaryAabbOverlapCount = countBoundaryAabbOverlaps(
    boundaries,
    positions,
    recordsByUuid,
    edgesByUuid,
    options.boundaryPadding,
  );
  if (metrics.overlapCount > 0 && options.failOnOverlap) {
    throw new Error(
      `semantic layout left ${metrics.overlapCount} overlapping node pair(s); increase iterations or reduce collisionPadding`,
    );
  }
  if (graphBoundaryOverlapCount > 0) {
    throw new Error(
      `semantic layout invariant failed with ${graphBoundaryOverlapCount} overlapping graph boundary pair(s)`,
    );
  }
  if (
    options.failOnDirectionViolation &&
    (metrics.dataDirectionViolationCount > 0 ||
      metrics.lambdaDirectionViolationCount > 0 ||
      metrics.anchorDirectionViolationCount > 0)
  ) {
    throw new Error(
      `semantic layout left ${metrics.dataDirectionViolationCount} data direction violation(s), ${metrics.lambdaDirectionViolationCount} lambda direction violation(s), and ${metrics.anchorDirectionViolationCount} anchor direction violation(s)`,
    );
  }

  const changedNodeUuids = [];
  for (const record of records) {
    const { x, y } = finalCoordinates.get(record.node.uuid);
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

  let maximumX = options.padding;
  let maximumY = options.padding;
  for (const record of records) {
    const coordinate = finalCoordinates.get(record.node.uuid);
    maximumX = Math.max(maximumX, coordinate.x + record.dimensions.width);
    maximumY = Math.max(maximumY, coordinate.y + record.dimensions.height);
  }
  return {
    graph,
    routedEdges: routeEdges(edges, recordsByUuid, positions, options.precision),
    changedNodeUuids,
    nodeCount: records.length,
    edgeCount: edges.length,
    dataEdgeCount: dataEdges.length,
    lambdaEdgeCount: lambdaEdges.length,
    anchorEdgeCount: anchorEdges.length,
    otherEdgeCount: otherEdges.length,
    dataCycleEdgeCount: dataCycleEdges.size,
    lambdaCycleEdgeCount: lambdaCycleEdges.size,
    anchorCycleEdgeCount: anchorCycleEdges.size,
    graphBoundaryCount: boundaries.length,
    graphBoundaryOverlapCount,
    graphBoundaryAabbOverlapCount,
    graphBoundaries: boundaries.map((boundary) => {
      const bounds = graphBoundaryBounds(
        boundary,
        positions,
        recordsByUuid,
        edgesByUuid,
      );
      return {
        id: boundary.id,
        nodeCount: boundary.nodeUuids.length,
        nodeUuids: [...boundary.nodeUuids],
        edgeCount: boundary.edgeUuids.length,
        edgeUuids: [...boundary.edgeUuids],
        x: round(bounds.minimumX, options.precision),
        y: round(bounds.minimumY, options.precision),
        width: round(bounds.width, options.precision),
        height: round(bounds.height, options.precision),
      };
    }),
    width: round(maximumX + options.padding, options.precision),
    height: round(maximumY + options.padding, options.precision),
    dataLayout: {
      width: dataLayout.width,
      height: dataLayout.height,
      overlapCount: dataLayout.overlapCount,
      straightEdgeCrossingCount: dataLayout.straightEdgeCrossingCount,
      routedEdgeCrossingCount: dataLayout.routedEdgeCrossingCount,
      routedEdgeOverlapCount: dataLayout.routedEdgeOverlapCount,
      edgeNodeIntersectionCount: dataLayout.edgeNodeIntersectionCount,
    },
    ...metrics,
    options,
  };
};
