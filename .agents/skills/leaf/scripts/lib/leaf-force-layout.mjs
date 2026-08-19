import {
  normalizeNodeDimensionOverrides,
  resolvePiperLeafNodeDimensions,
} from "./piper-node-dimensions.mjs";
import { performance } from "node:perf_hooks";

/**
 * Deterministic, synchronous 2D Fruchterman-Reingold layout for a LEAF
 * transport graph. This adapts Piper's renderer-oriented force layout to
 * nodes[].out_edges and encoded leaf.appdata.position metadata.
 */
const DEFAULT_OPTIONS = Object.freeze({
  algorithm: "force-directed",
  width: 1600,
  height: 900,
  padding: 80,
  iterations: 300,
  attraction: 1,
  repulsion: 1,
  proximityRepulsionExponent: 0,
  enforceSemanticConstraints: false,
  semanticDataSpacing: 40,
  semanticLambdaSpacing: 40,
  semanticAnchorSpacing: 40,
  semanticRankGap: 8,
  semanticProjectionPasses: 2,
  semanticEarlyStopPatience: 12,
  semanticCrossingPolicy: "auto",
  maxSemanticDrift: 0,
  failOnSemanticViolation: false,
  adaptiveCanvasByNodeCount: false,
  adaptiveCompressionMin: 0.68,
  adaptiveCompressionMax: 0.92,
  adaptiveAspectMin: 0.6,
  adaptiveAspectMax: 1.6,
  maxRuntimeMs: 0,
  edgeRepulsion: 0.5,
  edgeNodeRepulsion: 1,
  crossingPenalty: 2,
  sharedSegmentPenalty: 1,
  edgeClearance: 24,
  sharedSegmentTolerance: 8,
  gravity: 0.05,
  collisionPadding: 16,
  collisionIterations: 100,
  failOnOverlap: true,
  nodeDimensions: Object.freeze({}),
  precision: 2,
});

const OPTION_NAMES = new Set([
  ...Object.keys(DEFAULT_OPTIONS),
  "initialTemperature",
]);
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const TOPOLOGY_OPERATIONS = new Set([
  "addNode",
  "deleteNode",
  "addEdge",
  "deleteEdge",
]);
const DATA_EDGE_TYPE = "leafdataedge";
const LAMBDA_EDGE_TYPE = "leaflambdaedge";
const ANCHOR_EDGE_TYPE = "leafanchoredge";
const SEMANTIC_CROSSING_POLICIES = new Set([
  "allow",
  "auto",
  "forbid-edge-node",
  "forbid-all",
]);

const requireFiniteNumber = (
  value,
  label,
  { minimum = -Infinity, exclusiveMinimum = false } = {},
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (exclusiveMinimum ? value <= minimum : value < minimum) {
    const comparison = exclusiveMinimum ? "greater than" : "at least";
    throw new Error(`${label} must be ${comparison} ${minimum}`);
  }
  return value;
};

export const normalizeLeafForceLayoutOptions = (
  value = {},
  label = "layout",
) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!OPTION_NAMES.has(key))
      throw new Error(`${label}.${key} is unsupported`);
  }
  const options = { ...DEFAULT_OPTIONS, ...value };
  if (options.algorithm !== "force-directed") {
    throw new Error(`${label}.algorithm must be force-directed`);
  }
  requireFiniteNumber(options.width, `${label}.width`, {
    minimum: 0,
    exclusiveMinimum: true,
  });
  requireFiniteNumber(options.height, `${label}.height`, {
    minimum: 0,
    exclusiveMinimum: true,
  });
  requireFiniteNumber(options.padding, `${label}.padding`, { minimum: 0 });
  if (
    options.padding * 2 >= options.width ||
    options.padding * 2 >= options.height
  ) {
    throw new Error(
      `${label}.padding must leave positive canvas width and height`,
    );
  }
  if (
    !Number.isInteger(options.iterations) ||
    options.iterations < 1 ||
    options.iterations > 10_000
  ) {
    throw new Error(
      `${label}.iterations must be an integer between 1 and 10000`,
    );
  }
  requireFiniteNumber(options.attraction, `${label}.attraction`, {
    minimum: 0,
  });
  requireFiniteNumber(options.repulsion, `${label}.repulsion`, { minimum: 0 });
  requireFiniteNumber(
    options.proximityRepulsionExponent,
    `${label}.proximityRepulsionExponent`,
    {
      minimum: 0,
    },
  );
  if (typeof options.enforceSemanticConstraints !== "boolean") {
    throw new Error(`${label}.enforceSemanticConstraints must be a boolean`);
  }
  for (const [name, minimum] of [
    ["semanticDataSpacing", 0],
    ["semanticLambdaSpacing", 0],
    ["semanticAnchorSpacing", 0],
    ["semanticRankGap", 0],
    ["maxSemanticDrift", 0],
    ["maxRuntimeMs", 0],
    ["adaptiveCompressionMin", 0],
    ["adaptiveCompressionMax", 0],
    ["adaptiveAspectMin", 0],
    ["adaptiveAspectMax", 0],
  ]) {
    requireFiniteNumber(options[name], `${label}.${name}`, { minimum });
  }
  for (const name of [
    "semanticProjectionPasses",
    "semanticEarlyStopPatience",
  ]) {
    if (
      !Number.isInteger(options[name]) ||
      options[name] < 1 ||
      options[name] > 10_000
    ) {
      throw new Error(`${label}.${name} must be an integer between 1 and 10000`);
    }
  }
  if (
    typeof options.semanticCrossingPolicy !== "string" ||
    !SEMANTIC_CROSSING_POLICIES.has(options.semanticCrossingPolicy)
  ) {
    throw new Error(
      `${label}.semanticCrossingPolicy must be one of allow, auto, forbid-edge-node, forbid-all`,
    );
  }
  if (typeof options.failOnSemanticViolation !== "boolean") {
    throw new Error(`${label}.failOnSemanticViolation must be a boolean`);
  }
  if (typeof options.adaptiveCanvasByNodeCount !== "boolean") {
    throw new Error(`${label}.adaptiveCanvasByNodeCount must be a boolean`);
  }
  if (options.adaptiveCompressionMin > options.adaptiveCompressionMax) {
    throw new Error(
      `${label}.adaptiveCompressionMin must be at most adaptiveCompressionMax`,
    );
  }
  if (options.adaptiveAspectMin > options.adaptiveAspectMax) {
    throw new Error(
      `${label}.adaptiveAspectMin must be at most adaptiveAspectMax`,
    );
  }
  requireFiniteNumber(options.edgeRepulsion, `${label}.edgeRepulsion`, {
    minimum: 0,
  });
  requireFiniteNumber(options.edgeNodeRepulsion, `${label}.edgeNodeRepulsion`, {
    minimum: 0,
  });
  requireFiniteNumber(options.crossingPenalty, `${label}.crossingPenalty`, {
    minimum: 0,
  });
  requireFiniteNumber(
    options.sharedSegmentPenalty,
    `${label}.sharedSegmentPenalty`,
    { minimum: 0 },
  );
  requireFiniteNumber(options.edgeClearance, `${label}.edgeClearance`, {
    minimum: 0,
  });
  requireFiniteNumber(
    options.sharedSegmentTolerance,
    `${label}.sharedSegmentTolerance`,
    { minimum: 0 },
  );
  requireFiniteNumber(options.gravity, `${label}.gravity`, { minimum: 0 });
  requireFiniteNumber(options.collisionPadding, `${label}.collisionPadding`, {
    minimum: 0,
  });
  if (
    !Number.isInteger(options.collisionIterations) ||
    options.collisionIterations < 1 ||
    options.collisionIterations > 10_000
  ) {
    throw new Error(
      `${label}.collisionIterations must be an integer between 1 and 10000`,
    );
  }
  if (typeof options.failOnOverlap !== "boolean") {
    throw new Error(`${label}.failOnOverlap must be a boolean`);
  }
  options.nodeDimensions = normalizeNodeDimensionOverrides(
    options.nodeDimensions,
    `${label}.nodeDimensions`,
  );
  if (
    !Number.isInteger(options.precision) ||
    options.precision < 0 ||
    options.precision > 6
  ) {
    throw new Error(`${label}.precision must be an integer between 0 and 6`);
  }
  if (Object.hasOwn(options, "initialTemperature")) {
    requireFiniteNumber(
      options.initialTemperature,
      `${label}.initialTemperature`,
      {
        minimum: 0,
        exclusiveMinimum: true,
      },
    );
  }
  return options;
};

export const leafOperationChangesTopology = (operation) =>
  TOPOLOGY_OPERATIONS.has(
    typeof operation === "string" ? operation : operation?.op,
  );

const decodeNodeData = (node, label) => {
  if (typeof node.data !== "string" || !BASE64_PATTERN.test(node.data)) {
    throw new Error(`${label}.data must be base64-encoded JSON`);
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(node.data, "base64").toString("utf8"));
  } catch {
    throw new Error(`${label}.data must be base64-encoded JSON`);
  }
  if (
    !decoded?.leaf ||
    typeof decoded.leaf !== "object" ||
    Array.isArray(decoded.leaf)
  ) {
    throw new Error(`${label}.data must contain a leaf object`);
  }
  return decoded;
};

const decodeEdgeType = (edge) => {
  if (typeof edge?.data !== "string" || !BASE64_PATTERN.test(edge.data)) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(Buffer.from(edge.data, "base64").toString("utf8"));
    const edgeType = decoded?.leaf?.logic?.type;
    return typeof edgeType === "string" ? edgeType : undefined;
  } catch {
    return undefined;
  }
};

const encodeNodeData = (decoded) =>
  Buffer.from(JSON.stringify(decoded), "utf8").toString("base64");

const hashUnit = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
};

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const round = (value, precision) => {
  const factor = 10 ** precision;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
};

const pairDirection = (leftUuid, rightUuid) => {
  const angle = 2 * Math.PI * hashUnit(`${leftUuid}\u0000${rightUuid}`);
  return { x: Math.cos(angle), y: Math.sin(angle) };
};

const crossProduct = (left, right) => left.x * right.y - left.y * right.x;
const dotProduct = (left, right) => left.x * right.x + left.y * right.y;

const closestPointOnSegment = (point, start, end) => {
  const vector = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = dotProduct(vector, vector);
  const parameter =
    lengthSquared < 1e-12
      ? 0
      : clamp(
          dotProduct(
            { x: point.x - start.x, y: point.y - start.y },
            vector,
          ) / lengthSquared,
          0,
          1,
        );
  const closest = {
    x: start.x + vector.x * parameter,
    y: start.y + vector.y * parameter,
  };
  return {
    point: closest,
    parameter,
    distance: Math.hypot(point.x - closest.x, point.y - closest.y),
  };
};

const segmentIntersection = (leftStart, leftEnd, rightStart, rightEnd) => {
  const leftVector = {
    x: leftEnd.x - leftStart.x,
    y: leftEnd.y - leftStart.y,
  };
  const rightVector = {
    x: rightEnd.x - rightStart.x,
    y: rightEnd.y - rightStart.y,
  };
  const denominator = crossProduct(leftVector, rightVector);
  if (Math.abs(denominator) < 1e-9) return null;
  const offset = {
    x: rightStart.x - leftStart.x,
    y: rightStart.y - leftStart.y,
  };
  const leftParameter = crossProduct(offset, rightVector) / denominator;
  const rightParameter = crossProduct(offset, leftVector) / denominator;
  if (
    leftParameter < -1e-9 ||
    leftParameter > 1 + 1e-9 ||
    rightParameter < -1e-9 ||
    rightParameter > 1 + 1e-9
  ) {
    return null;
  }
  return {
    leftParameter: clamp(leftParameter, 0, 1),
    rightParameter: clamp(rightParameter, 0, 1),
    point: {
      x: leftStart.x + leftVector.x * leftParameter,
      y: leftStart.y + leftVector.y * leftParameter,
    },
    strict:
      leftParameter > 1e-6 &&
      leftParameter < 1 - 1e-6 &&
      rightParameter > 1e-6 &&
      rightParameter < 1 - 1e-6,
  };
};

const closestSegmentPoints = (
  leftStart,
  leftEnd,
  rightStart,
  rightEnd,
) => {
  const intersection = segmentIntersection(
    leftStart,
    leftEnd,
    rightStart,
    rightEnd,
  );
  if (intersection) {
    return {
      leftPoint: intersection.point,
      rightPoint: intersection.point,
      leftParameter: intersection.leftParameter,
      rightParameter: intersection.rightParameter,
      distance: 0,
      strictCrossing: intersection.strict,
    };
  }
  const leftStartToRight = closestPointOnSegment(
    leftStart,
    rightStart,
    rightEnd,
  );
  const leftEndToRight = closestPointOnSegment(
    leftEnd,
    rightStart,
    rightEnd,
  );
  const rightStartToLeft = closestPointOnSegment(
    rightStart,
    leftStart,
    leftEnd,
  );
  const rightEndToLeft = closestPointOnSegment(
    rightEnd,
    leftStart,
    leftEnd,
  );
  return [
    {
      leftPoint: leftStart,
      rightPoint: leftStartToRight.point,
      leftParameter: 0,
      rightParameter: leftStartToRight.parameter,
      distance: leftStartToRight.distance,
    },
    {
      leftPoint: leftEnd,
      rightPoint: leftEndToRight.point,
      leftParameter: 1,
      rightParameter: leftEndToRight.parameter,
      distance: leftEndToRight.distance,
    },
    {
      leftPoint: rightStartToLeft.point,
      rightPoint: rightStart,
      leftParameter: rightStartToLeft.parameter,
      rightParameter: 0,
      distance: rightStartToLeft.distance,
    },
    {
      leftPoint: rightEndToLeft.point,
      rightPoint: rightEnd,
      leftParameter: rightEndToLeft.parameter,
      rightParameter: 1,
      distance: rightEndToLeft.distance,
    },
  ].sort((left, right) => left.distance - right.distance)[0];
};

const stableSegmentNormal = (edgeUuid, salt, start, end) => {
  const vector = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(vector.x, vector.y);
  let normal =
    length < 1e-9
      ? pairDirection(edgeUuid, salt)
      : { x: -vector.y / length, y: vector.x / length };
  const preferred = pairDirection(edgeUuid, salt);
  if (dotProduct(normal, preferred) < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  return normal;
};

const sharedSegmentInfo = (
  leftEdge,
  rightEdge,
  leftStart,
  leftEnd,
  rightStart,
  rightEnd,
  tolerance,
) => {
  const leftVector = {
    x: leftEnd.x - leftStart.x,
    y: leftEnd.y - leftStart.y,
  };
  const rightVector = {
    x: rightEnd.x - rightStart.x,
    y: rightEnd.y - rightStart.y,
  };
  const leftLength = Math.hypot(leftVector.x, leftVector.y);
  const rightLength = Math.hypot(rightVector.x, rightVector.y);
  if (leftLength < 1e-9 || rightLength < 1e-9) return null;
  const leftUnit = {
    x: leftVector.x / leftLength,
    y: leftVector.y / leftLength,
  };
  const rightUnit = {
    x: rightVector.x / rightLength,
    y: rightVector.y / rightLength,
  };
  if (Math.abs(crossProduct(leftUnit, rightUnit)) > 0.05) return null;
  const normal = { x: -leftUnit.y, y: leftUnit.x };
  const rightOffset = {
    x: rightStart.x - leftStart.x,
    y: rightStart.y - leftStart.y,
  };
  const lineDistance = Math.abs(dotProduct(rightOffset, normal));
  if (lineDistance > tolerance) return null;
  const rightStartProjection = dotProduct(rightOffset, leftUnit);
  const rightEndProjection = dotProduct(
    { x: rightEnd.x - leftStart.x, y: rightEnd.y - leftStart.y },
    leftUnit,
  );
  const overlapStart = Math.max(
    0,
    Math.min(rightStartProjection, rightEndProjection),
  );
  const overlapEnd = Math.min(
    leftLength,
    Math.max(rightStartProjection, rightEndProjection),
  );
  const overlapLength = overlapEnd - overlapStart;
  if (overlapLength <= 1e-6) return null;
  const overlapMiddle = (overlapStart + overlapEnd) / 2;
  const leftPoint = {
    x: leftStart.x + leftUnit.x * overlapMiddle,
    y: leftStart.y + leftUnit.y * overlapMiddle,
  };
  const rightClosest = closestPointOnSegment(
    leftPoint,
    rightStart,
    rightEnd,
  );
  let direction = normal;
  const midpointDelta = {
    x: (leftStart.x + leftEnd.x - rightStart.x - rightEnd.x) / 2,
    y: (leftStart.y + leftEnd.y - rightStart.y - rightEnd.y) / 2,
  };
  if (Math.abs(dotProduct(midpointDelta, direction)) < 1e-9) {
    const preferred = pairDirection(leftEdge.uuid, rightEdge.uuid);
    if (dotProduct(direction, preferred) < 0) {
      direction = { x: -direction.x, y: -direction.y };
    }
  } else if (dotProduct(midpointDelta, direction) < 0) {
    direction = { x: -direction.x, y: -direction.y };
  }
  return {
    direction,
    leftParameter: overlapMiddle / leftLength,
    rightParameter: rightClosest.parameter,
    overlapLength,
    lineDistance,
  };
};

const addDisplacement = (displacement, uuid, x, y) => {
  const movement = displacement.get(uuid);
  movement.x += x;
  movement.y += y;
};

const applyForceAtEdgePoint = (
  displacement,
  edge,
  parameter,
  x,
  y,
) => {
  addDisplacement(
    displacement,
    edge.source,
    x * (1 - parameter),
    y * (1 - parameter),
  );
  addDisplacement(displacement, edge.target, x * parameter, y * parameter);
};

const applyOpposingEdgeForce = (
  displacement,
  leftEdge,
  leftParameter,
  rightEdge,
  rightParameter,
  direction,
  magnitude,
) => {
  const x = direction.x * magnitude;
  const y = direction.y * magnitude;
  applyForceAtEdgePoint(
    displacement,
    leftEdge,
    leftParameter,
    x,
    y,
  );
  applyForceAtEdgePoint(
    displacement,
    rightEdge,
    rightParameter,
    -x,
    -y,
  );
};

const centerBounds = (record, bounds) => {
  const halfWidth = record.dimensions.width / 2;
  const halfHeight = record.dimensions.height / 2;
  const limits = {
    minimumX: bounds.minimumX + halfWidth,
    maximumX: bounds.maximumX - halfWidth,
    minimumY: bounds.minimumY + halfHeight,
    maximumY: bounds.maximumY - halfHeight,
  };
  if (limits.minimumX > limits.maximumX || limits.minimumY > limits.maximumY) {
    throw new Error(
      `node ${record.node.uuid} (${record.dimensions.width}x${record.dimensions.height}) does not fit the layout canvas`,
    );
  }
  return limits;
};

const clampCenter = (record, position, bounds) => {
  const limits = centerBounds(record, bounds);
  position.x = clamp(position.x, limits.minimumX, limits.maximumX);
  position.y = clamp(position.y, limits.minimumY, limits.maximumY);
  return position;
};

const initialPosition = (record, index, count, bounds) => {
  const position = record.decoded.leaf?.appdata?.position;
  if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
    return clampCenter(
      record,
      {
        x: position.x + record.dimensions.width / 2,
        y: position.y + record.dimensions.height / 2,
      },
      bounds,
    );
  }
  const angle =
    2 * Math.PI * ((index + hashUnit(record.node.uuid)) / Math.max(1, count));
  const radius =
    Math.min(bounds.width, bounds.height) *
    (0.2 + hashUnit(`${record.node.uuid}:radius`) * 0.2);
  return clampCenter(
    record,
    {
      x: bounds.centerX + Math.cos(angle) * radius,
      y: bounds.centerY + Math.sin(angle) * radius,
    },
    bounds,
  );
};

const directionalClearance = (leftRecord, rightRecord, unitX, unitY, padding) =>
  (Math.abs(unitX) *
    (leftRecord.dimensions.width + rightRecord.dimensions.width)) /
    2 +
  (Math.abs(unitY) *
    (leftRecord.dimensions.height + rightRecord.dimensions.height)) /
    2 +
  padding;

const collisionOverlap = (leftRecord, rightRecord, left, right, padding) => ({
  x:
    (leftRecord.dimensions.width + rightRecord.dimensions.width) / 2 +
    padding -
    Math.abs(left.x - right.x),
  y:
    (leftRecord.dimensions.height + rightRecord.dimensions.height) / 2 +
    padding -
    Math.abs(left.y - right.y),
});

const axisDirections = (leftRecord, rightRecord, left, right, axis) => {
  const delta = left[axis] - right[axis];
  if (Math.abs(delta) > 1e-9) {
    return delta < 0 ? { left: -1, right: 1 } : { left: 1, right: -1 };
  }
  const direction = pairDirection(leftRecord.node.uuid, rightRecord.node.uuid)[
    axis
  ];
  return direction < 0 ? { left: -1, right: 1 } : { left: 1, right: -1 };
};

const movementCapacity = (record, position, bounds, axis, direction) => {
  const limits = centerBounds(record, bounds);
  if (axis === "x") {
    return direction < 0
      ? position.x - limits.minimumX
      : limits.maximumX - position.x;
  }
  return direction < 0
    ? position.y - limits.minimumY
    : limits.maximumY - position.y;
};

const collisionAxis = (
  leftRecord,
  rightRecord,
  left,
  right,
  bounds,
  overlap,
) => {
  const candidates = ["x", "y"].map((axis) => {
    const directions = axisDirections(
      leftRecord,
      rightRecord,
      left,
      right,
      axis,
    );
    const capacity =
      movementCapacity(leftRecord, left, bounds, axis, directions.left) +
      movementCapacity(rightRecord, right, bounds, axis, directions.right);
    return { axis, directions, capacity, overlap: overlap[axis] };
  });
  const feasible = candidates.filter(
    (candidate) => candidate.capacity + 1e-9 >= candidate.overlap,
  );
  return (feasible.length > 0 ? feasible : candidates).sort(
    (leftCandidate, rightCandidate) =>
      leftCandidate.overlap - rightCandidate.overlap,
  )[0];
};

const separateCollisionPair = (
  leftRecord,
  rightRecord,
  left,
  right,
  bounds,
  padding,
) => {
  const overlap = collisionOverlap(
    leftRecord,
    rightRecord,
    left,
    right,
    padding,
  );
  if (overlap.x <= 1e-9 || overlap.y <= 1e-9) return false;
  const candidate = collisionAxis(
    leftRecord,
    rightRecord,
    left,
    right,
    bounds,
    overlap,
  );
  const { axis, directions } = candidate;
  const leftCapacity = movementCapacity(
    leftRecord,
    left,
    bounds,
    axis,
    directions.left,
  );
  const rightCapacity = movementCapacity(
    rightRecord,
    right,
    bounds,
    axis,
    directions.right,
  );
  let leftMovement = Math.min(candidate.overlap / 2, leftCapacity);
  let rightMovement = Math.min(candidate.overlap - leftMovement, rightCapacity);
  leftMovement += Math.min(
    candidate.overlap - leftMovement - rightMovement,
    leftCapacity - leftMovement,
  );
  rightMovement += Math.min(
    candidate.overlap - leftMovement - rightMovement,
    rightCapacity - rightMovement,
  );
  left[axis] += directions.left * leftMovement;
  right[axis] += directions.right * rightMovement;
  return true;
};

const resolveCollisionSweep = (records, positions, bounds, padding) => {
  let collisionFound = false;
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const leftRecord = records[leftIndex];
    const left = positions.get(leftRecord.node.uuid);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < records.length;
      rightIndex += 1
    ) {
      const rightRecord = records[rightIndex];
      const right = positions.get(rightRecord.node.uuid);
      collisionFound =
        separateCollisionPair(
          leftRecord,
          rightRecord,
          left,
          right,
          bounds,
          padding,
        ) || collisionFound;
    }
  }
  return collisionFound;
};

const countCollisions = (records, positions, padding) => {
  let count = 0;
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const leftRecord = records[leftIndex];
    const left = positions.get(leftRecord.node.uuid);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < records.length;
      rightIndex += 1
    ) {
      const rightRecord = records[rightIndex];
      const right = positions.get(rightRecord.node.uuid);
      const overlap = collisionOverlap(
        leftRecord,
        rightRecord,
        left,
        right,
        padding,
      );
      if (overlap.x > 1e-6 && overlap.y > 1e-6) count += 1;
    }
  }
  return count;
};

const recenterPositions = (records, positions, bounds) => {
  const center = records.reduce(
    (sum, record) => {
      const position = positions.get(record.node.uuid);
      return { x: sum.x + position.x, y: sum.y + position.y };
    },
    { x: 0, y: 0 },
  );
  center.x /= records.length;
  center.y /= records.length;

  let minimumTranslationX = -Infinity;
  let maximumTranslationX = Infinity;
  let minimumTranslationY = -Infinity;
  let maximumTranslationY = Infinity;
  for (const record of records) {
    const position = positions.get(record.node.uuid);
    const limits = centerBounds(record, bounds);
    minimumTranslationX = Math.max(
      minimumTranslationX,
      limits.minimumX - position.x,
    );
    maximumTranslationX = Math.min(
      maximumTranslationX,
      limits.maximumX - position.x,
    );
    minimumTranslationY = Math.max(
      minimumTranslationY,
      limits.minimumY - position.y,
    );
    maximumTranslationY = Math.min(
      maximumTranslationY,
      limits.maximumY - position.y,
    );
  }
  const translationX = clamp(
    bounds.centerX - center.x,
    minimumTranslationX,
    maximumTranslationX,
  );
  const translationY = clamp(
    bounds.centerY - center.y,
    minimumTranslationY,
    maximumTranslationY,
  );
  for (const position of positions.values()) {
    position.x += translationX;
    position.y += translationY;
  }
};

const flattenEdges = (graph, nodeIds) => {
  const edges = [];
  const edgeIds = new Set();
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    if (!Array.isArray(node.out_edges)) {
      throw new Error(`graph.nodes[${nodeIndex}].out_edges must be an array`);
    }
    for (const [edgeIndex, edge] of node.out_edges.entries()) {
      const label = `graph.nodes[${nodeIndex}].out_edges[${edgeIndex}]`;
      if (typeof edge?.uuid !== "string" || edge.uuid.length === 0) {
        throw new Error(`${label}.uuid must be a non-empty string`);
      }
      if (edgeIds.has(edge.uuid))
        throw new Error(`graph has duplicate edge UUID ${edge.uuid}`);
      edgeIds.add(edge.uuid);
      const source =
        typeof edge.source === "string" ? edge.source : edge.source?.uuid;
      const target =
        typeof edge.target === "string" ? edge.target : edge.target?.uuid;
      if (source !== node.uuid)
        throw new Error(`${label} must be nested under its source node`);
      if (!nodeIds.has(target))
        throw new Error(`${label} targets missing node ${target}`);
      edges.push({
        uuid: edge.uuid,
        source,
        target,
        type: decodeEdgeType(edge),
      });
    }
  }
  return edges.sort((left, right) => left.uuid.localeCompare(right.uuid));
};

const decodedNodeEnvelope = (records) => {
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  let totalNodeArea = 0;
  for (const record of records) {
    const position = record.decoded?.leaf?.appdata?.position;
    const topLeftX = Number.isFinite(position?.x) ? position.x : 0;
    const topLeftY = Number.isFinite(position?.y) ? position.y : 0;
    minimumX = Math.min(minimumX, topLeftX);
    minimumY = Math.min(minimumY, topLeftY);
    maximumX = Math.max(maximumX, topLeftX + record.dimensions.width);
    maximumY = Math.max(maximumY, topLeftY + record.dimensions.height);
    totalNodeArea += record.dimensions.width * record.dimensions.height;
  }
  return {
    width: Math.max(1, maximumX - minimumX),
    height: Math.max(1, maximumY - minimumY),
    area: Math.max(1, (maximumX - minimumX) * (maximumY - minimumY)),
    totalNodeArea,
  };
};

const resolveAdaptiveCanvas = (records, options) => {
  const defaults = {
    width: options.width,
    height: options.height,
    meta: null,
  };
  if (!options.adaptiveCanvasByNodeCount || records.length === 0) return defaults;

  const envelope = decodedNodeEnvelope(records);
  const nodeCount = records.length;
  const compression = clamp(
    0.95 - 10 / (nodeCount + 12),
    options.adaptiveCompressionMin,
    options.adaptiveCompressionMax,
  );
  const targetArea = Math.max(
    envelope.totalNodeArea * 1.8,
    envelope.area * compression,
  );
  const ratio = clamp(
    envelope.width / Math.max(1, envelope.height),
    options.adaptiveAspectMin,
    options.adaptiveAspectMax,
  );
  const maxNodeWidth = records.reduce(
    (maximum, record) => Math.max(maximum, record.dimensions.width),
    1,
  );
  const maxNodeHeight = records.reduce(
    (maximum, record) => Math.max(maximum, record.dimensions.height),
    1,
  );
  const desiredInnerWidth = Math.max(
    maxNodeWidth + options.collisionPadding * 2 + 1,
    Math.round(Math.sqrt(targetArea * ratio)),
  );
  const desiredInnerHeight = Math.max(
    maxNodeHeight + options.collisionPadding * 2 + 1,
    Math.round(targetArea / Math.max(1, desiredInnerWidth)),
  );
  const width = Math.max(
    maxNodeWidth + options.padding * 2 + 1,
    desiredInnerWidth + options.padding * 2,
  );
  const height = Math.max(
    maxNodeHeight + options.padding * 2 + 1,
    desiredInnerHeight + options.padding * 2,
  );
  return {
    width,
    height,
    meta: {
      nodeCount,
      compression: round(compression, 4),
      targetArea: round(targetArea, options.precision),
      ratio: round(ratio, 4),
      sourceArea: round(envelope.area, options.precision),
      sourceWidth: round(envelope.width, options.precision),
      sourceHeight: round(envelope.height, options.precision),
    },
  };
};

const buildRankLocks = (nodeIds, axis, minDistance, seedPositions) => {
  if (minDistance <= 0) return [];
  const sorted = [...nodeIds].sort((left, right) => {
    const leftPosition = seedPositions.get(left);
    const rightPosition = seedPositions.get(right);
    return leftPosition[axis] - rightPosition[axis] || left.localeCompare(right);
  });
  const locks = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const source = sorted[index];
    const target = sorted[index + 1];
    if (source === target) continue;
    locks.push({ source, target, axis, minDistance });
  }
  return locks;
};

const cyclicEdgeIds = (nodeIds, edges) => {
  const adjacency = new Map([...nodeIds].map((uuid) => [uuid, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source).push(edge.target);
  }

  const indexByNode = new Map();
  const lowLinkByNode = new Map();
  const onStack = new Set();
  const stack = [];
  const componentByNode = new Map();
  const componentSizes = new Map();
  let index = 0;
  let component = 0;

  const visit = (uuid) => {
    indexByNode.set(uuid, index);
    lowLinkByNode.set(uuid, index);
    index += 1;
    stack.push(uuid);
    onStack.add(uuid);

    for (const target of adjacency.get(uuid)) {
      if (!indexByNode.has(target)) {
        visit(target);
        lowLinkByNode.set(
          uuid,
          Math.min(lowLinkByNode.get(uuid), lowLinkByNode.get(target)),
        );
      } else if (onStack.has(target)) {
        lowLinkByNode.set(
          uuid,
          Math.min(lowLinkByNode.get(uuid), indexByNode.get(target)),
        );
      }
    }

    if (lowLinkByNode.get(uuid) === indexByNode.get(uuid)) {
      let size = 0;
      while (stack.length > 0) {
        const member = stack.pop();
        onStack.delete(member);
        componentByNode.set(member, component);
        size += 1;
        if (member === uuid) break;
      }
      componentSizes.set(component, size);
      component += 1;
    }
  };

  for (const uuid of nodeIds) {
    if (!indexByNode.has(uuid)) visit(uuid);
  }

  return new Set(
    edges
      .filter((edge) => {
        const edgeComponent = componentByNode.get(edge.source);
        return (
          edgeComponent === componentByNode.get(edge.target) &&
          (componentSizes.get(edgeComponent) > 1 || edge.source === edge.target)
        );
      })
      .map((edge) => edge.uuid),
  );
};

const buildSemanticConstraints = (records, edges, positions, options) => {
  if (!options.enforceSemanticConstraints) return null;
  const seedPositions = new Map(
    records.map((record) => {
      const position = positions.get(record.node.uuid);
      return [record.node.uuid, { x: position.x, y: position.y }];
    }),
  );
  const dataNodes = new Set();
  const verticalNodes = new Set();
  const nodeIds = new Set(records.map((record) => record.node.uuid));
  const dataEdges = edges.filter((edge) => edge.type === DATA_EDGE_TYPE);
  const lambdaEdges = edges.filter((edge) => edge.type === LAMBDA_EDGE_TYPE);
  const anchorEdges = edges.filter((edge) => edge.type === ANCHOR_EDGE_TYPE);
  const skippedCycleEdgeIds = new Set([
    ...cyclicEdgeIds(nodeIds, dataEdges),
    ...cyclicEdgeIds(nodeIds, lambdaEdges),
    ...cyclicEdgeIds(nodeIds, anchorEdges),
  ]);

  const edgeConstraints = [];
  for (const edge of edges) {
    if (edge.source === edge.target || skippedCycleEdgeIds.has(edge.uuid)) continue;
    if (edge.type === DATA_EDGE_TYPE) {
      edgeConstraints.push({
        source: edge.source,
        target: edge.target,
        axis: "x",
        minDistance: options.semanticDataSpacing,
      });
      dataNodes.add(edge.source);
      dataNodes.add(edge.target);
    } else if (edge.type === LAMBDA_EDGE_TYPE) {
      edgeConstraints.push({
        source: edge.source,
        target: edge.target,
        axis: "y",
        minDistance: options.semanticLambdaSpacing,
      });
      verticalNodes.add(edge.source);
      verticalNodes.add(edge.target);
    } else if (edge.type === ANCHOR_EDGE_TYPE) {
      edgeConstraints.push({
        source: edge.source,
        target: edge.target,
        axis: "y",
        minDistance: options.semanticAnchorSpacing,
      });
      verticalNodes.add(edge.source);
      verticalNodes.add(edge.target);
    }
  }

  const rankLocks = [
    ...buildRankLocks(dataNodes, "x", options.semanticRankGap, seedPositions),
    ...buildRankLocks(verticalNodes, "y", options.semanticRankGap, seedPositions),
  ];

  return {
    edgeConstraints,
    rankLocks,
    seedPositions,
    skippedCycleEdgeCount: skippedCycleEdgeIds.size,
  };
};

const enforceAxisGapBetween = (
  constraint,
  positions,
  recordsByUuid,
  bounds,
) => {
  const leftRecord = recordsByUuid.get(constraint.source);
  const rightRecord = recordsByUuid.get(constraint.target);
  if (!leftRecord || !rightRecord) return false;
  const left = positions.get(constraint.source);
  const right = positions.get(constraint.target);
  const delta = right[constraint.axis] - left[constraint.axis];
  if (delta + 1e-9 >= constraint.minDistance) return false;

  const deficit = constraint.minDistance - delta;
  const leftCapacity = movementCapacity(
    leftRecord,
    left,
    bounds,
    constraint.axis,
    -1,
  );
  const rightCapacity = movementCapacity(
    rightRecord,
    right,
    bounds,
    constraint.axis,
    1,
  );

  let leftMove = Math.min(deficit / 2, leftCapacity);
  let rightMove = Math.min(deficit - leftMove, rightCapacity);
  leftMove += Math.min(
    deficit - leftMove - rightMove,
    leftCapacity - leftMove,
  );
  rightMove += Math.min(
    deficit - leftMove - rightMove,
    rightCapacity - rightMove,
  );
  if (leftMove <= 1e-9 && rightMove <= 1e-9) return false;

  left[constraint.axis] -= leftMove;
  right[constraint.axis] += rightMove;
  clampCenter(leftRecord, left, bounds);
  clampCenter(rightRecord, right, bounds);
  return true;
};

const applySemanticDriftCap = (
  constraints,
  records,
  positions,
  bounds,
  options,
) => {
  if (!constraints || options.maxSemanticDrift <= 0) return false;
  let changed = false;
  for (const record of records) {
    const seed = constraints.seedPositions.get(record.node.uuid);
    const position = positions.get(record.node.uuid);
    const deltaX = position.x - seed.x;
    const deltaY = position.y - seed.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= options.maxSemanticDrift + 1e-9) continue;
    const ratio = options.maxSemanticDrift / Math.max(1e-9, distance);
    position.x = seed.x + deltaX * ratio;
    position.y = seed.y + deltaY * ratio;
    clampCenter(record, position, bounds);
    changed = true;
  }
  return changed;
};

const countSemanticViolations = (constraints, positions) => {
  if (!constraints) return 0;
  let count = 0;
  for (const constraint of [...constraints.edgeConstraints, ...constraints.rankLocks]) {
    const source = positions.get(constraint.source);
    const target = positions.get(constraint.target);
    if (!source || !target) continue;
    if (target[constraint.axis] - source[constraint.axis] < constraint.minDistance - 1e-6) {
      count += 1;
    }
  }
  return count;
};

const projectSemanticConstraints = (
  constraints,
  records,
  recordsByUuid,
  positions,
  bounds,
  options,
) => {
  if (!constraints) return { changed: false, violationCount: 0 };
  let changed = false;
  for (let pass = 0; pass < options.semanticProjectionPasses; pass += 1) {
    let passChanged = false;
    for (const constraint of constraints.edgeConstraints) {
      passChanged =
        enforceAxisGapBetween(constraint, positions, recordsByUuid, bounds) ||
        passChanged;
    }
    for (const lock of constraints.rankLocks) {
      passChanged =
        enforceAxisGapBetween(lock, positions, recordsByUuid, bounds) ||
        passChanged;
    }
    passChanged =
      applySemanticDriftCap(constraints, records, positions, bounds, options) ||
      passChanged;
    changed = changed || passChanged;
    if (!passChanged) break;
  }
  return {
    changed,
    violationCount: countSemanticViolations(constraints, positions),
  };
};

const edgesShareEndpoint = (left, right) =>
  left.source === right.source ||
  left.source === right.target ||
  left.target === right.source ||
  left.target === right.target;

export const applyLeafEdgeGeometryForces = (
  records,
  edges,
  positions,
  displacement,
  forceConstant,
  options,
) => {
  if (options.edgeNodeRepulsion > 0) {
    for (const edge of edges) {
      if (edge.source === edge.target) continue;
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      for (const record of records) {
        const uuid = record.node.uuid;
        if (uuid === edge.source || uuid === edge.target) continue;
        const nodePosition = positions.get(uuid);
        const closest = closestPointOnSegment(nodePosition, source, target);
        let direction;
        if (closest.distance < 1e-9) {
          direction = stableSegmentNormal(
            edge.uuid,
            uuid,
            source,
            target,
          );
        } else {
          direction = {
            x: (nodePosition.x - closest.point.x) / closest.distance,
            y: (nodePosition.y - closest.point.y) / closest.distance,
          };
        }
        const nodeRadius =
          (Math.abs(direction.x) * record.dimensions.width) / 2 +
          (Math.abs(direction.y) * record.dimensions.height) / 2;
        const desiredDistance = nodeRadius + options.edgeClearance;
        if (closest.distance >= desiredDistance) continue;
        const magnitude =
          options.edgeNodeRepulsion *
          forceConstant *
          ((desiredDistance - closest.distance) /
            Math.max(1, desiredDistance));
        const x = direction.x * magnitude;
        const y = direction.y * magnitude;
        addDisplacement(displacement, uuid, x, y);
        applyForceAtEdgePoint(
          displacement,
          edge,
          closest.parameter,
          -x,
          -y,
        );
      }
    }
  }

  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    const leftEdge = edges[leftIndex];
    if (leftEdge.source === leftEdge.target) continue;
    const leftStart = positions.get(leftEdge.source);
    const leftEnd = positions.get(leftEdge.target);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < edges.length;
      rightIndex += 1
    ) {
      const rightEdge = edges[rightIndex];
      if (rightEdge.source === rightEdge.target) continue;
      const rightStart = positions.get(rightEdge.source);
      const rightEnd = positions.get(rightEdge.target);
      const shareEndpoint = edgesShareEndpoint(leftEdge, rightEdge);
      const closest = closestSegmentPoints(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
      );
      if (
        !shareEndpoint &&
        options.edgeRepulsion > 0 &&
        closest.distance < options.edgeClearance
      ) {
        const direction =
          closest.distance < 1e-9
            ? stableSegmentNormal(
                leftEdge.uuid,
                rightEdge.uuid,
                leftStart,
                leftEnd,
              )
            : {
                x:
                  (closest.leftPoint.x - closest.rightPoint.x) /
                  closest.distance,
                y:
                  (closest.leftPoint.y - closest.rightPoint.y) /
                  closest.distance,
              };
        const magnitude =
          options.edgeRepulsion *
          forceConstant *
          ((options.edgeClearance - closest.distance) /
            Math.max(1, options.edgeClearance));
        applyOpposingEdgeForce(
          displacement,
          leftEdge,
          closest.leftParameter,
          rightEdge,
          closest.rightParameter,
          direction,
          magnitude,
        );
      }
      if (
        !shareEndpoint &&
        closest.strictCrossing &&
        options.crossingPenalty > 0
      ) {
        const direction = stableSegmentNormal(
          leftEdge.uuid,
          `${rightEdge.uuid}:crossing`,
          leftStart,
          leftEnd,
        );
        applyOpposingEdgeForce(
          displacement,
          leftEdge,
          closest.leftParameter,
          rightEdge,
          closest.rightParameter,
          direction,
          options.crossingPenalty * forceConstant,
        );
      }
      if (options.sharedSegmentPenalty > 0) {
        const shared = sharedSegmentInfo(
          leftEdge,
          rightEdge,
          leftStart,
          leftEnd,
          rightStart,
          rightEnd,
          options.sharedSegmentTolerance,
        );
        if (shared) {
          const magnitude =
            options.sharedSegmentPenalty *
            forceConstant *
            Math.min(
              1,
              shared.overlapLength / Math.max(1, options.edgeClearance),
            );
          applyOpposingEdgeForce(
            displacement,
            leftEdge,
            shared.leftParameter,
            rightEdge,
            shared.rightParameter,
            shared.direction,
            magnitude,
          );
        }
      }
    }
  }
};

const measureEdgeGeometry = (records, edges, positions, options) => {
  let edgeCrossingCount = 0;
  let sharedSegmentCount = 0;
  let edgeEdgeProximityCount = 0;
  let edgeNodeIntersectionCount = 0;
  let edgeNodeProximityCount = 0;
  let minimumEdgeDistance = Infinity;

  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    for (const record of records) {
      const uuid = record.node.uuid;
      if (uuid === edge.source || uuid === edge.target) continue;
      const nodePosition = positions.get(uuid);
      const closest = closestPointOnSegment(nodePosition, source, target);
      const direction =
        closest.distance < 1e-9
          ? stableSegmentNormal(edge.uuid, uuid, source, target)
          : {
              x: (nodePosition.x - closest.point.x) / closest.distance,
              y: (nodePosition.y - closest.point.y) / closest.distance,
            };
      const nodeRadius =
        (Math.abs(direction.x) * record.dimensions.width) / 2 +
        (Math.abs(direction.y) * record.dimensions.height) / 2;
      if (closest.distance < nodeRadius - 1e-6) {
        edgeNodeIntersectionCount += 1;
      }
      if (closest.distance < nodeRadius + options.edgeClearance - 1e-6) {
        edgeNodeProximityCount += 1;
      }
    }
  }

  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    const leftEdge = edges[leftIndex];
    if (leftEdge.source === leftEdge.target) continue;
    const leftStart = positions.get(leftEdge.source);
    const leftEnd = positions.get(leftEdge.target);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < edges.length;
      rightIndex += 1
    ) {
      const rightEdge = edges[rightIndex];
      if (rightEdge.source === rightEdge.target) continue;
      const rightStart = positions.get(rightEdge.source);
      const rightEnd = positions.get(rightEdge.target);
      const shareEndpoint = edgesShareEndpoint(leftEdge, rightEdge);
      const closest = closestSegmentPoints(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
      );
      if (!shareEndpoint) {
        minimumEdgeDistance = Math.min(minimumEdgeDistance, closest.distance);
        if (closest.strictCrossing) edgeCrossingCount += 1;
        if (closest.distance < options.edgeClearance - 1e-6) {
          edgeEdgeProximityCount += 1;
        }
      }
      if (
        sharedSegmentInfo(
          leftEdge,
          rightEdge,
          leftStart,
          leftEnd,
          rightStart,
          rightEnd,
          options.sharedSegmentTolerance,
        )
      ) {
        sharedSegmentCount += 1;
      }
    }
  }

  return {
    edgeCrossingCount,
    sharedSegmentCount,
    edgeEdgeProximityCount,
    edgeNodeIntersectionCount,
    edgeNodeProximityCount,
    minimumEdgeDistance:
      minimumEdgeDistance === Infinity
        ? null
        : round(minimumEdgeDistance, options.precision),
  };
};

export const layoutLeafGraph = (sourceGraph, layoutOptions = {}) => {
  if (
    !sourceGraph ||
    typeof sourceGraph !== "object" ||
    Array.isArray(sourceGraph)
  ) {
    throw new Error("graph must be an object");
  }
  if (!Array.isArray(sourceGraph.nodes))
    throw new Error("graph.nodes must be an array");
  const layoutStart = performance.now();
  const options = normalizeLeafForceLayoutOptions(layoutOptions);
  if (options.semanticCrossingPolicy === "allow") {
    options.edgeRepulsion = 0;
    options.edgeNodeRepulsion = 0;
    options.crossingPenalty = 0;
    options.sharedSegmentPenalty = 0;
  }
  const graph = structuredClone(sourceGraph);
  const records = graph.nodes.map((node, index) => {
    if (typeof node?.uuid !== "string" || node.uuid.length === 0) {
      throw new Error(`graph.nodes[${index}].uuid must be a non-empty string`);
    }
    const decoded = decodeNodeData(node, `graph.nodes[${index}]`);
    return {
      node,
      decoded,
      dimensions: resolvePiperLeafNodeDimensions(
        decoded,
        options.nodeDimensions,
      ),
    };
  });
  records.sort((left, right) => left.node.uuid.localeCompare(right.node.uuid));
  const nodeIds = new Set(records.map((record) => record.node.uuid));
  if (nodeIds.size !== records.length)
    throw new Error("graph has duplicate node UUIDs");
  const recordsByUuid = new Map(
    records.map((record) => [record.node.uuid, record]),
  );
  const edges = flattenEdges(graph, nodeIds);

  const adaptiveCanvas = resolveAdaptiveCanvas(records, options);
  const effectiveCanvasWidth = adaptiveCanvas.width;
  const effectiveCanvasHeight = adaptiveCanvas.height;

  const bounds = {
    minimumX: options.padding,
    maximumX: effectiveCanvasWidth - options.padding,
    minimumY: options.padding,
    maximumY: effectiveCanvasHeight - options.padding,
  };
  bounds.width = bounds.maximumX - bounds.minimumX;
  bounds.height = bounds.maximumY - bounds.minimumY;
  bounds.centerX = effectiveCanvasWidth / 2;
  bounds.centerY = effectiveCanvasHeight / 2;

  const positions = new Map(
    records.map((record, index) => [
      record.node.uuid,
      initialPosition(record, index, records.length, bounds),
    ]),
  );
  const semanticConstraints = buildSemanticConstraints(
    records,
    edges,
    positions,
    options,
  );
  let semanticViolationCount = countSemanticViolations(
    semanticConstraints,
    positions,
  );
  let iterationsExecuted = 0;
  let semanticSatisfiedStreak = semanticViolationCount === 0 ? 1 : 0;
  if (records.length === 1) {
    positions.set(records[0].node.uuid, {
      x: bounds.centerX,
      y: bounds.centerY,
    });
  } else if (records.length > 1) {
    const area = bounds.width * bounds.height;
    const forceConstant = Math.sqrt(area / records.length);
    const initialTemperature =
      options.initialTemperature ?? Math.min(bounds.width, bounds.height) / 10;

    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
      if (
        options.maxRuntimeMs > 0 &&
        performance.now() - layoutStart >= options.maxRuntimeMs
      ) {
        break;
      }
      iterationsExecuted = iteration + 1;
      const displacement = new Map(
        records.map((record) => [record.node.uuid, { x: 0, y: 0 }]),
      );

      for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
        const leftRecord = records[leftIndex];
        const leftUuid = leftRecord.node.uuid;
        const left = positions.get(leftUuid);
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < records.length;
          rightIndex += 1
        ) {
          const rightRecord = records[rightIndex];
          const rightUuid = rightRecord.node.uuid;
          const right = positions.get(rightUuid);
          let deltaX = left.x - right.x;
          let deltaY = left.y - right.y;
          let distance = Math.hypot(deltaX, deltaY);
          if (distance < 1e-9) {
            const direction = pairDirection(leftUuid, rightUuid);
            deltaX = direction.x;
            deltaY = direction.y;
            distance = 1;
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
          const proximity =
            1 - Math.min(1, surfaceDistance / Math.max(1, forceConstant));
          const proximityMultiplier =
            options.proximityRepulsionExponent > 0
              ? Math.exp(
                  Math.min(
                    6,
                    options.proximityRepulsionExponent * Math.max(0, proximity),
                  ),
                )
              : 1;
          const force =
            ((options.repulsion * forceConstant * forceConstant) /
              surfaceDistance) *
            proximityMultiplier;
          const changeX = unitX * force;
          const changeY = unitY * force;
          displacement.get(leftUuid).x += changeX;
          displacement.get(leftUuid).y += changeY;
          displacement.get(rightUuid).x -= changeX;
          displacement.get(rightUuid).y -= changeY;
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
          const direction = pairDirection(edge.source, edge.target);
          deltaX = direction.x;
          deltaY = direction.y;
          distance = 1;
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
          (options.attraction * surfaceDistance * surfaceDistance) /
          forceConstant;
        const changeX = unitX * force;
        const changeY = unitY * force;
        displacement.get(edge.source).x -= changeX;
        displacement.get(edge.source).y -= changeY;
        displacement.get(edge.target).x += changeX;
        displacement.get(edge.target).y += changeY;
      }

      applyLeafEdgeGeometryForces(
        records,
        edges,
        positions,
        displacement,
        forceConstant,
        options,
      );

      const temperature =
        initialTemperature * (1 - iteration / options.iterations);
      for (const record of records) {
        const uuid = record.node.uuid;
        const position = positions.get(uuid);
        const movement = displacement.get(uuid);
        movement.x += (bounds.centerX - position.x) * options.gravity;
        movement.y += (bounds.centerY - position.y) * options.gravity;
        const magnitude = Math.hypot(movement.x, movement.y);
        if (magnitude > 0) {
          const step = Math.min(magnitude, temperature);
          position.x += (movement.x / magnitude) * step;
          position.y += (movement.y / magnitude) * step;
          clampCenter(record, position, bounds);
        }
      }
      resolveCollisionSweep(
        records,
        positions,
        bounds,
        options.collisionPadding,
      );

      const projection = projectSemanticConstraints(
        semanticConstraints,
        records,
        recordsByUuid,
        positions,
        bounds,
        options,
      );
      semanticViolationCount = projection.violationCount;
      if (semanticViolationCount === 0) {
        semanticSatisfiedStreak += 1;
      } else {
        semanticSatisfiedStreak = 0;
      }
      if (
        semanticConstraints &&
        semanticSatisfiedStreak >= options.semanticEarlyStopPatience
      ) {
        break;
      }
    }
    recenterPositions(records, positions, bounds);
    semanticViolationCount = projectSemanticConstraints(
      semanticConstraints,
      records,
      recordsByUuid,
      positions,
      bounds,
      options,
    ).violationCount;
  }

  const roundingSafety = 10 ** -options.precision;
  for (
    let iteration = 0;
    iteration < options.collisionIterations;
    iteration += 1
  ) {
    if (
      !resolveCollisionSweep(
        records,
        positions,
        bounds,
        options.collisionPadding + roundingSafety,
      )
    ) {
      break;
    }
  }

  const finalCoordinates = new Map();
  for (const record of records) {
    const position = positions.get(record.node.uuid);
    const topLeftX = clamp(
      round(position.x - record.dimensions.width / 2, options.precision),
      bounds.minimumX,
      bounds.maximumX - record.dimensions.width,
    );
    const topLeftY = clamp(
      round(position.y - record.dimensions.height / 2, options.precision),
      bounds.minimumY,
      bounds.maximumY - record.dimensions.height,
    );
    finalCoordinates.set(record.node.uuid, { x: topLeftX, y: topLeftY });
    position.x = topLeftX + record.dimensions.width / 2;
    position.y = topLeftY + record.dimensions.height / 2;
  }
  const overlapCount = countCollisions(
    records,
    positions,
    options.collisionPadding,
  );
  const edgeGeometry = measureEdgeGeometry(
    records,
    edges,
    positions,
    options,
  );
  if (overlapCount > 0 && options.failOnOverlap) {
    throw new Error(
      `force-directed layout left ${overlapCount} overlapping node pair(s); enlarge the canvas, reduce collisionPadding, or set failOnOverlap to false`,
    );
  }
  if (
    options.semanticCrossingPolicy === "forbid-edge-node" &&
    edgeGeometry.edgeNodeIntersectionCount > 0
  ) {
    throw new Error(
      `semantic crossing policy forbids edge-node intersections; ${edgeGeometry.edgeNodeIntersectionCount} remain`,
    );
  }
  if (options.semanticCrossingPolicy === "forbid-all") {
    const forbiddenCount =
      edgeGeometry.edgeCrossingCount +
      edgeGeometry.edgeNodeIntersectionCount +
      edgeGeometry.sharedSegmentCount;
    if (forbiddenCount > 0) {
      throw new Error(
        `semantic crossing policy forbids edge crossings/intersections; ${forbiddenCount} remain`,
      );
    }
  }
  if (semanticViolationCount > 0 && options.failOnSemanticViolation) {
    throw new Error(
      `force-directed layout left ${semanticViolationCount} semantic constraint violation(s); increase semantic spacing, projection passes, or canvas size`,
    );
  }

  const changedNodeUuids = [];
  for (const record of records) {
    const { x, y } = finalCoordinates.get(record.node.uuid);
    if (
      record.decoded.leaf.appdata === undefined ||
      record.decoded.leaf.appdata === null
    ) {
      record.decoded.leaf.appdata = {};
    } else if (
      typeof record.decoded.leaf.appdata !== "object" ||
      Array.isArray(record.decoded.leaf.appdata)
    ) {
      throw new Error(
        `node ${record.node.uuid} leaf.appdata must be an object`,
      );
    }
    const rawPrevious = record.decoded.leaf.appdata.position;
    if (
      rawPrevious !== undefined &&
      rawPrevious !== null &&
      (typeof rawPrevious !== "object" || Array.isArray(rawPrevious))
    ) {
      throw new Error(
        `node ${record.node.uuid} leaf.appdata.position must be an object`,
      );
    }
    const previous = rawPrevious ?? {};
    if (previous.x === x && previous.y === y) continue;
    changedNodeUuids.push(record.node.uuid);
    record.decoded.leaf.appdata.position = { ...previous, x, y };
    record.node.data = encodeNodeData(record.decoded);
  }

  return {
    graph,
    changedNodeUuids: changedNodeUuids.sort((left, right) =>
      left.localeCompare(right),
    ),
    nodeCount: records.length,
    edgeCount: edges.length,
    overlapCount,
    semanticViolationCount,
    semanticSkippedCycleEdgeCount: semanticConstraints?.skippedCycleEdgeCount ?? 0,
    iterationsExecuted,
    elapsedMs: round(performance.now() - layoutStart, options.precision),
    effectiveCanvas: {
      width: round(effectiveCanvasWidth, options.precision),
      height: round(effectiveCanvasHeight, options.precision),
      adaptive: adaptiveCanvas.meta,
    },
    ...edgeGeometry,
    options,
  };
};
