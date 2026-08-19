import assert from "node:assert/strict";
import test from "node:test";

import {
  layoutLeafSemanticGraph,
  normalizeLeafSemanticLayoutOptions,
} from "../lib/leaf-semantic-layout.mjs";
import { resolvePiperLeafNodeDimensions } from "../lib/piper-node-dimensions.mjs";

const encode = (value) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const decode = (value) =>
  JSON.parse(Buffer.from(value, "base64").toString("utf8"));

const makeNode = (uuid) => ({
  uuid,
  leafnodetype: "leaflabel",
  data: encode({
    leaf: {
      logic: { type: "leaflabel", args: { labelstr: uuid } },
      appdata: { position: { x: 0, y: 0, z: 9 }, preserved: true },
    },
  }),
  out_edges: [],
});

const edgeData = (type) =>
  encode({ leaf: { logic: { type } } });

const addEdge = (nodesByUuid, uuid, source, target, type) => {
  nodesByUuid.get(source).out_edges.push({
    uuid,
    source: { uuid: source },
    target: { uuid: target },
    data: edgeData(type),
  });
};

const makeMixedGraph = () => {
  const nodes = [
    makeNode("target"),
    makeNode("lambda-source"),
    makeNode("data-source"),
    makeNode("anchor"),
  ];
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  addEdge(nodesByUuid, "data-edge", "data-source", "target", "leafdataedge");
  addEdge(
    nodesByUuid,
    "lambda-edge",
    "lambda-source",
    "target",
    "leaflambdaedge",
  );
  addEdge(nodesByUuid, "anchor-edge", "anchor", "target", "leafanchoredge");
  return { domain: "example", appid: "semantic", nodes };
};

const makeMixedCrossingGraph = () => {
  const nodes = [
    makeNode("data-left"),
    makeNode("data-right"),
    makeNode("lambda-top"),
    makeNode("lambda-bottom"),
  ];
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  addEdge(nodesByUuid, "data", "data-left", "data-right", "leafdataedge");
  addEdge(
    nodesByUuid,
    "lambda",
    "lambda-top",
    "lambda-bottom",
    "leaflambdaedge",
  );
  addEdge(
    nodesByUuid,
    "anchor-join",
    "lambda-top",
    "data-left",
    "leafanchoredge",
  );
  return { domain: "example", appid: "mixed-crossing", nodes };
};

const fakeElk = (calls) => ({
  async layout(input) {
    calls.push(input);
    const positions = new Map([
      ["anchor", { x: 800, y: 500 }],
      ["data-source", { x: 80, y: 300 }],
      ["lambda-source", { x: 650, y: 80 }],
      ["target", { x: 300, y: 80 }],
    ]);
    return {
      id: input.id,
      width: 957,
      height: 657,
      children: input.children.map((child) => ({
        ...child,
        ...positions.get(child.id),
      })),
      edges: input.edges.map((edge) => {
        const source = positions.get(edge.sources[0]);
        const target = positions.get(edge.targets[0]);
        return {
          ...edge,
          sections: [
            {
              startPoint: { x: source.x + 77, y: source.y + 38.5 },
              bendPoints: [],
              endPoint: { x: target.x, y: target.y + 38.5 },
            },
          ],
        };
      }),
    };
  },
});

const fakeElkAt = (positions) => ({
  async layout(input) {
    return {
      id: input.id,
      width: 1000,
      height: 800,
      children: input.children.map((child) => ({
        ...child,
        ...positions.get(child.id),
      })),
      edges: input.edges.map((edge) => ({ ...edge, sections: [] })),
    };
  },
});

const boxesByUuid = (graph) =>
  new Map(
    graph.nodes.map((node) => {
      const decoded = decode(node.data);
      const dimensions = resolvePiperLeafNodeDimensions(decoded);
      return [
        node.uuid,
        {
          ...decoded.leaf.appdata.position,
          width: dimensions.width,
          height: dimensions.height,
        },
      ];
    }),
  );

test("semantic layout defaults use the compact profile", () => {
  const options = normalizeLeafSemanticLayoutOptions();
  assert.deepEqual(
    {
      dataSpacing: options.dataSpacing,
      lambdaSpacing: options.lambdaSpacing,
      anchorSpacing: options.anchorSpacing,
      nodeSpacing: options.nodeSpacing,
      collisionPadding: options.collisionPadding,
      boundaryPadding: options.boundaryPadding,
      componentCompaction: options.componentCompaction,
      componentCompactionIterations: options.componentCompactionIterations,
      attraction: options.attraction,
      repulsion: options.repulsion,
      edgeRepulsion: options.edgeRepulsion,
      crossingPenalty: options.crossingPenalty,
      edgeClearance: options.edgeClearance,
      gravity: options.gravity,
      boundaryRepulsion: options.boundaryRepulsion,
      boundaryGravity: options.boundaryGravity,
      initialTemperature: options.initialTemperature,
      padding: options.padding,
    },
    {
      dataSpacing: 40,
      lambdaSpacing: 40,
      anchorSpacing: 40,
      nodeSpacing: 24,
      collisionPadding: 10,
      boundaryPadding: 24,
      componentCompaction: true,
      componentCompactionIterations: 12,
      attraction: 0.35,
      repulsion: 0.18,
      edgeRepulsion: 0.1,
      crossingPenalty: 0.5,
      edgeClearance: 12,
      gravity: 0.06,
      boundaryRepulsion: 0.15,
      boundaryGravity: 0.08,
      initialTemperature: 12,
      padding: 32,
    },
  );
});

test("semantic layout keeps data left-to-right and lambda/anchor top-to-bottom", async () => {
  const graph = makeMixedGraph();
  const original = structuredClone(graph);
  const calls = [];
  const options = {
    dataSpacing: 60,
    lambdaSpacing: 50,
    anchorSpacing: 55,
    constraintIterations: 160,
    precision: 3,
  };

  const first = await layoutLeafSemanticGraph(graph, options, {
    elk: fakeElk(calls),
  });
  const second = await layoutLeafSemanticGraph(graph, options, {
    elk: fakeElk([]),
  });

  assert.deepEqual(graph, original, "the source graph must not be mutated");
  assert.deepEqual(first.graph, second.graph, "the layout must be deterministic");
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].edges.map((edge) => edge.id),
    ["data-edge"],
    "only data edges may influence the ELK horizontal backbone",
  );
  assert.equal(calls[0].layoutOptions["elk.direction"], "RIGHT");

  const boxes = boxesByUuid(first.graph);
  const dataSource = boxes.get("data-source");
  const lambdaSource = boxes.get("lambda-source");
  const anchor = boxes.get("anchor");
  const target = boxes.get("target");
  assert.ok(
    dataSource.x + dataSource.width + options.dataSpacing <= target.x + 1e-6,
    "the data source must be left of its target",
  );
  assert.ok(
    lambdaSource.y + lambdaSource.height + options.lambdaSpacing <=
      target.y + 1e-6,
    "the lambda source must be above its target",
  );
  assert.ok(
    anchor.y + anchor.height + options.anchorSpacing <= target.y + 1e-6,
    "the anchor source must be above its target",
  );
  assert.equal(first.overlapCount, 0);
  assert.equal(first.dataDirectionViolationCount, 0);
  assert.equal(first.lambdaDirectionViolationCount, 0);
  assert.equal(first.anchorDirectionViolationCount, 0);
  assert.equal(first.dataEdgeCount, 1);
  assert.equal(first.lambdaEdgeCount, 1);
  assert.equal(first.anchorEdgeCount, 1);
  assert.equal(first.otherEdgeCount, 0);
  assert.equal(first.dataCycleEdgeCount, 0);
  assert.equal(first.lambdaCycleEdgeCount, 0);
  assert.equal(first.anchorCycleEdgeCount, 0);
  assert.equal(first.graphBoundaryCount, 1);
  assert.equal(first.graphBoundaryOverlapCount, 0);
  assert.deepEqual(first.graphBoundaries[0].edgeUuids, [
    "anchor-edge",
    "data-edge",
    "lambda-edge",
  ]);
  assert.equal(
    first.routedEdges.find((edge) => edge.uuid === "data-edge").type,
    "leafdataedge",
  );
  assert.equal(
    first.routedEdges.find((edge) => edge.uuid === "lambda-edge").type,
    "leaflambdaedge",
  );
  assert.equal(
    first.routedEdges.find((edge) => edge.uuid === "anchor-edge").type,
    "leafanchoredge",
  );
  for (const node of first.graph.nodes) {
    const decoded = decode(node.data);
    assert.equal(decoded.leaf.appdata.position.z, 9);
    assert.equal(decoded.leaf.appdata.preserved, true);
  }
});

test("semantic layout rejects directional data cycles before invoking ELK", async () => {
  const nodes = [makeNode("node-a"), makeNode("node-b")];
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  addEdge(nodesByUuid, "edge-a-b", "node-a", "node-b", "leafdataedge");
  addEdge(nodesByUuid, "edge-b-a", "node-b", "node-a", "leafdataedge");
  const calls = [];

  await assert.rejects(
    layoutLeafSemanticGraph(
      { domain: "example", appid: "cycle", nodes },
      {},
      { elk: fakeElk(calls) },
    ),
    /impossible for 2 cyclic data edge\(s\)/,
  );
  assert.equal(calls.length, 0);
});

test("semantic layout can report a cyclic best effort when explicitly allowed", async () => {
  const nodes = [makeNode("node-a"), makeNode("node-b")];
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  addEdge(nodesByUuid, "edge-a-b", "node-a", "node-b", "leafdataedge");
  addEdge(nodesByUuid, "edge-b-a", "node-b", "node-a", "leafdataedge");
  const positions = new Map([
    ["node-a", { x: 80, y: 80 }],
    ["node-b", { x: 237, y: 80 }],
  ]);
  const elk = {
    async layout(input) {
      return {
        width: 394,
        height: 237,
        children: input.children.map((child) => ({
          ...child,
          ...positions.get(child.id),
        })),
        edges: input.edges.map((edge) => ({ ...edge, sections: [] })),
      };
    },
  };

  const result = await layoutLeafSemanticGraph(
    { domain: "example", appid: "cycle", nodes },
    { failOnDirectionViolation: false },
    { elk },
  );

  assert.equal(result.dataCycleEdgeCount, 2);
  assert.ok(result.dataDirectionViolationCount >= 1);
});

test("semantic layout validates directional option values", async () => {
  const graph = makeMixedGraph();
  await assert.rejects(
    layoutLeafSemanticGraph(graph, { dataAlignmentStrength: 1.1 }),
    /dataAlignmentStrength must be a finite number of at least 0 and at most 1/,
  );
  await assert.rejects(
    layoutLeafSemanticGraph(graph, { algorithm: "force-directed" }),
    /algorithm must be semantic/,
  );
  await assert.rejects(
    layoutLeafSemanticGraph(graph, { componentCompaction: "yes" }),
    /componentCompaction must be a boolean/,
  );
  await assert.rejects(
    layoutLeafSemanticGraph(graph, { componentCompactionIterations: 0 }),
    /componentCompactionIterations must be an integer between 1 and 10000/,
  );
  await assert.rejects(
    layoutLeafSemanticGraph(graph, { failOnMixedEdgeCrossing: "yes" }),
    /failOnMixedEdgeCrossing must be a boolean/,
  );
});

test("semantic layout can fail when data and lambda edges still cross", async () => {
  const graph = makeMixedCrossingGraph();
  const positions = new Map([
    ["data-left", { x: 80, y: 300 }],
    ["data-right", { x: 760, y: 300 }],
    ["lambda-top", { x: 420, y: 60 }],
    ["lambda-bottom", { x: 420, y: 560 }],
  ]);

  const bestEffort = await layoutLeafSemanticGraph(
    graph,
    {
      initialTemperature: 0,
      constraintIterations: 1,
      collisionIterations: 1,
      failOnOverlap: false,
      failOnDirectionViolation: false,
      failOnMixedEdgeCrossing: false,
    },
    { elk: fakeElkAt(positions) },
  );

  assert.equal(bestEffort.dataLambdaCrossingCount, 1);

  await assert.rejects(
    layoutLeafSemanticGraph(
      graph,
      {
        initialTemperature: 0,
        constraintIterations: 1,
        collisionIterations: 1,
        failOnOverlap: false,
        failOnDirectionViolation: false,
        failOnMixedEdgeCrossing: true,
      },
      { elk: fakeElkAt(positions) },
    ),
    /data-lambda crossing\(s\)/,
  );
});

const pointSegmentDistanceSquared = (point, start, end) => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const amount =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * deltaX +
              (point.y - start.y) * deltaY) /
              lengthSquared,
          ),
        );
  return (
    (point.x - start.x - amount * deltaX) ** 2 +
    (point.y - start.y - amount * deltaY) ** 2
  );
};

const orientation = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const segmentsIntersect = (a, b, c, d) => {
  const values = [
    orientation(a, b, c),
    orientation(a, b, d),
    orientation(c, d, a),
    orientation(c, d, b),
  ];
  const onSegment = (point, start, end) =>
    Math.abs(orientation(start, end, point)) <= 1e-6 &&
    point.x >= Math.min(start.x, end.x) - 1e-6 &&
    point.x <= Math.max(start.x, end.x) + 1e-6 &&
    point.y >= Math.min(start.y, end.y) - 1e-6 &&
    point.y <= Math.max(start.y, end.y) + 1e-6;
  const properlyCrosses =
    ((values[0] > 1e-6 && values[1] < -1e-6) ||
      (values[0] < -1e-6 && values[1] > 1e-6)) &&
    ((values[2] > 1e-6 && values[3] < -1e-6) ||
      (values[2] < -1e-6 && values[3] > 1e-6));
  return (
    properlyCrosses ||
    (Math.abs(values[0]) <= 1e-6 && onSegment(c, a, b)) ||
    (Math.abs(values[1]) <= 1e-6 && onSegment(d, a, b)) ||
    (Math.abs(values[2]) <= 1e-6 && onSegment(a, c, d)) ||
    (Math.abs(values[3]) <= 1e-6 && onSegment(b, c, d))
  );
};

const segmentDistanceSquared = (left, right) =>
  segmentsIntersect(left.start, left.end, right.start, right.end)
    ? 0
    : Math.min(
        pointSegmentDistanceSquared(left.start, right.start, right.end),
        pointSegmentDistanceSquared(left.end, right.start, right.end),
        pointSegmentDistanceSquared(right.start, left.start, left.end),
        pointSegmentDistanceSquared(right.end, left.start, left.end),
      );

const rectangleDistanceSquared = (left, right) => {
  const deltaX = Math.max(0, left.x - right.maximumX, right.x - left.maximumX);
  const deltaY = Math.max(0, left.y - right.maximumY, right.y - left.maximumY);
  return deltaX ** 2 + deltaY ** 2;
};

const segmentRectangleDistanceSquared = (segment, rectangle) => {
  const corners = [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.maximumX, y: rectangle.y },
    { x: rectangle.maximumX, y: rectangle.maximumY },
    { x: rectangle.x, y: rectangle.maximumY },
  ];
  const sides = corners.map((start, index) => ({
    start,
    end: corners[(index + 1) % corners.length],
  }));
  const pointRectangleDistanceSquared = (point) => {
    const x = Math.max(rectangle.x, Math.min(rectangle.maximumX, point.x));
    const y = Math.max(rectangle.y, Math.min(rectangle.maximumY, point.y));
    return (point.x - x) ** 2 + (point.y - y) ** 2;
  };
  return Math.min(
    pointRectangleDistanceSquared(segment.start),
    pointRectangleDistanceSquared(segment.end),
    ...corners.map((corner) =>
      pointSegmentDistanceSquared(corner, segment.start, segment.end),
    ),
    ...sides.map((side) => segmentDistanceSquared(segment, side)),
  );
};

const assertBoundaryMembersSeparated = (result, padding) => {
  const boxes = boxesByUuid(result.graph);
  for (const box of boxes.values()) {
    box.maximumX = box.x + box.width;
    box.maximumY = box.y + box.height;
  }
  const routedByUuid = new Map(
    result.routedEdges.map((edge) => [edge.uuid, edge]),
  );
  const geometry = result.graphBoundaries.map((boundary) => {
    const segments = [];
    for (const uuid of boundary.edgeUuids) {
      for (const section of routedByUuid.get(uuid).sections) {
        const points = [
          section.startPoint,
          ...section.bendPoints,
          section.endPoint,
        ];
        for (let index = 1; index < points.length; index += 1) {
          segments.push({ start: points[index - 1], end: points[index] });
        }
      }
    }
    return {
      rectangles: boundary.nodeUuids.map((uuid) => boxes.get(uuid)),
      segments,
    };
  });
  const minimumDistanceSquared = (padding - 0.02) ** 2;
  for (let left = 0; left < geometry.length; left += 1) {
    for (let right = left + 1; right < geometry.length; right += 1) {
      for (const a of geometry[left].rectangles) {
        for (const b of geometry[right].rectangles) {
          assert.ok(rectangleDistanceSquared(a, b) >= minimumDistanceSquared);
        }
        for (const segment of geometry[right].segments) {
          assert.ok(
            segmentRectangleDistanceSquared(segment, a) >=
              minimumDistanceSquared,
          );
        }
      }
      for (const segment of geometry[left].segments) {
        for (const rectangle of geometry[right].rectangles) {
          assert.ok(
            segmentRectangleDistanceSquared(segment, rectangle) >=
              minimumDistanceSquared,
          );
        }
        for (const other of geometry[right].segments) {
          assert.ok(
            segmentDistanceSquared(segment, other) >= minimumDistanceSquared,
          );
        }
      }
    }
  }
};

test("semantic layout separates actual members of disconnected graphs", async () => {
  const nodes = [
    makeNode("a-left"),
    makeNode("a-right"),
    makeNode("b-top"),
    makeNode("b-bottom"),
  ];
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  addEdge(nodesByUuid, "a-edge", "a-left", "a-right", "leafdataedge");
  addEdge(nodesByUuid, "b-edge", "b-top", "b-bottom", "leaflambdaedge");
  const positions = new Map([
    ["a-left", { x: 80, y: 300 }],
    ["a-right", { x: 600, y: 300 }],
    ["b-top", { x: 340, y: 80 }],
    ["b-bottom", { x: 340, y: 520 }],
  ]);
  const boundaryPadding = 60;

  const result = await layoutLeafSemanticGraph(
    { domain: "example", appid: "disconnected", nodes },
    {
      boundaryPadding,
      constraintIterations: 4,
      collisionIterations: 4,
      initialTemperature: 0,
      precision: 3,
    },
    { elk: fakeElkAt(positions) },
  );

  assert.equal(result.graphBoundaryCount, 2);
  assert.equal(result.graphBoundaryOverlapCount, 0);
  assertBoundaryMembersSeparated(result, boundaryPadding);
  const [first, second] = result.graphBoundaries;
  assert.deepEqual(first.nodeUuids, ["a-left", "a-right"]);
  assert.deepEqual(first.edgeUuids, ["a-edge"]);
  assert.deepEqual(second.nodeUuids, ["b-bottom", "b-top"]);
  assert.deepEqual(second.edgeUuids, ["b-edge"]);

  for (const edge of result.routedEdges) {
    const boundary = result.graphBoundaries.find((candidate) =>
      candidate.edgeUuids.includes(edge.uuid),
    );
    for (const section of edge.sections) {
      for (const point of [
        section.startPoint,
        ...section.bendPoints,
        section.endPoint,
      ]) {
        assert.ok(point.x >= boundary.x - 1e-6);
        assert.ok(point.x <= boundary.x + boundary.width + 1e-6);
        assert.ok(point.y >= boundary.y - 1e-6);
        assert.ok(point.y <= boundary.y + boundary.height + 1e-6);
      }
    }
  }
  assert.equal(result.dataDirectionViolationCount, 0);
  assert.equal(result.lambdaDirectionViolationCount, 0);
});

test("semantic layout interleaves L-shaped component envelopes deterministically", async () => {
  const nodes = [
    makeNode("a-top"),
    makeNode("a-corner"),
    makeNode("a-right"),
    makeNode("b-left"),
    makeNode("b-right"),
  ];
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  addEdge(nodesByUuid, "a-down", "a-top", "a-corner", "leaflambdaedge");
  addEdge(nodesByUuid, "a-across", "a-corner", "a-right", "leafdataedge");
  addEdge(nodesByUuid, "b-across", "b-left", "b-right", "leafdataedge");
  const positions = new Map([
    ["a-top", { x: 80, y: 80 }],
    ["a-corner", { x: 80, y: 400 }],
    ["a-right", { x: 600, y: 400 }],
    ["b-left", { x: 340, y: 80 }],
    ["b-right", { x: 700, y: 80 }],
  ]);
  const graph = { domain: "example", appid: "interleaving", nodes };
  const options = {
    boundaryPadding: 40,
    constraintIterations: 4,
    collisionIterations: 4,
    initialTemperature: 0,
    precision: 3,
  };

  const compact = await layoutLeafSemanticGraph(graph, options, {
    elk: fakeElkAt(positions),
  });
  const repeated = await layoutLeafSemanticGraph(graph, options, {
    elk: fakeElkAt(positions),
  });
  const aabbOnly = await layoutLeafSemanticGraph(
    graph,
    { ...options, componentCompaction: false },
    { elk: fakeElkAt(positions) },
  );

  assert.deepEqual(compact.graph, repeated.graph);
  assert.equal(compact.graphBoundaryOverlapCount, 0);
  assert.ok(compact.graphBoundaryAabbOverlapCount > 0);
  assert.equal(aabbOnly.graphBoundaryAabbOverlapCount, 0);
  assertBoundaryMembersSeparated(compact, options.boundaryPadding);
  assert.ok(
    compact.width * compact.height < aabbOnly.width * aabbOnly.height,
    "member-level packing should use less canvas area than AABB-only packing",
  );
  assert.equal(compact.dataDirectionViolationCount, 0);
  assert.equal(compact.lambdaDirectionViolationCount, 0);
  assert.equal(compact.anchorDirectionViolationCount, 0);
});

test("all edge types contribute to weak connected-graph membership", async () => {
  const nodes = [makeNode("unknown-a"), makeNode("unknown-b")];
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  addEdge(
    nodesByUuid,
    "unknown-edge",
    "unknown-a",
    "unknown-b",
    "leafcustomedge",
  );

  const result = await layoutLeafSemanticGraph(
    { domain: "example", appid: "unknown-edge", nodes },
    { constraintIterations: 4, collisionIterations: 4, initialTemperature: 0 },
    {
      elk: fakeElkAt(
        new Map([
          ["unknown-a", { x: 80, y: 80 }],
          ["unknown-b", { x: 400, y: 80 }],
        ]),
      ),
    },
  );

  assert.equal(result.otherEdgeCount, 1);
  assert.equal(result.graphBoundaryCount, 1);
  assert.equal(result.graphBoundaries[0].edgeCount, 1);
  assert.deepEqual(result.graphBoundaries[0].edgeUuids, ["unknown-edge"]);
});
