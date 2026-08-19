import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { layoutLeafGraph } from "../lib/leaf-force-layout.mjs";
import {
  PIPER_EDITOR_DIMENSIONS,
  resolvePiperLeafNodeDimensions,
} from "../lib/piper-node-dimensions.mjs";

const skillDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const batchScript = join(skillDirectory, "scripts", "leaf-graph-batch.mjs");

const encode = (value) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const decode = (value) =>
  JSON.parse(Buffer.from(value, "base64").toString("utf8"));

const makeNode = (uuid, position) => ({
  uuid,
  leafnodetype: "leaflabel",
  data: encode({
    leaf: {
      api: "breezyforest",
      logic: { type: "leaflabel", args: { labelstr: uuid } },
      appdata: { position: { ...position, z: 7 }, preserved: true },
    },
  }),
  out_edges: [],
});

const edgeData = encode({
  leaf: { api: "breezyforest", logic: { type: "leafdataedge" } },
});

const makeTypedNode = (uuid, leafType, args, position) => ({
  uuid,
  leafnodetype: leafType,
  data: encode({
    leaf: {
      api: "breezyforest",
      logic: { type: leafType, args },
      appdata: { position },
    },
  }),
  out_edges: [],
});

const nodeBox = (node, overrides = {}) => {
  const decoded = decode(node.data);
  const dimensions = resolvePiperLeafNodeDimensions(decoded, overrides);
  return {
    ...decoded.leaf.appdata.position,
    width: dimensions.width,
    height: dimensions.height,
  };
};

const assertNoOverlaps = (nodes, collisionPadding = 16, overrides = {}) => {
  const boxes = nodes.map((node) => nodeBox(node, overrides));
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    const left = boxes[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < boxes.length;
      rightIndex += 1
    ) {
      const right = boxes[rightIndex];
      const separated =
        left.x + left.width + collisionPadding <= right.x ||
        right.x + right.width + collisionPadding <= left.x ||
        left.y + left.height + collisionPadding <= right.y ||
        right.y + right.height + collisionPadding <= left.y;
      assert.ok(separated, `node boxes ${leftIndex} and ${rightIndex} overlap`);
    }
  }
};

const makeGraph = (positions, edges) => {
  const nodes = Object.entries(positions).map(([uuid, position]) =>
    makeNode(uuid, position),
  );
  const nodesByUuid = new Map(nodes.map((node) => [node.uuid, node]));
  for (const [uuid, source, target] of edges) {
    nodesByUuid.get(source).out_edges.push({
      uuid,
      source: { uuid: source },
      target: { uuid: target },
      data: edgeData,
    });
  }
  return { domain: "example", appid: "edge-forces", nodes };
};

const edgeFixtureOptions = Object.freeze({
  width: 900,
  height: 700,
  padding: 20,
  iterations: 40,
  attraction: 0,
  repulsion: 0,
  edgeRepulsion: 0,
  edgeNodeRepulsion: 0,
  crossingPenalty: 0,
  sharedSegmentPenalty: 0,
  gravity: 0,
  collisionPadding: 0,
  collisionIterations: 10,
  failOnOverlap: false,
  precision: 3,
});

test("Piper dimensions resolve editor categories, spell-name width, and overrides", () => {
  const dimensionsFor = (leafType, args = {}, overrides = {}) =>
    resolvePiperLeafNodeDimensions(
      { leaf: { logic: { type: leafType, args } } },
      overrides,
    );

  assert.deepEqual(dimensionsFor("leafscreenio"), {
    ...PIPER_EDITOR_DIMENSIONS.circularnode,
    source: "circularnode",
  });
  assert.deepEqual(dimensionsFor("leafconfig"), {
    ...PIPER_EDITOR_DIMENSIONS.rectangularnode,
    source: "rectangularnode",
  });
  assert.deepEqual(dimensionsFor("leafoutflowport"), {
    ...PIPER_EDITOR_DIMENSIONS.tinynode,
    source: "tinynode",
  });
  assert.deepEqual(dimensionsFor("leafspelldef", { spellname: "short" }), {
    width: 120,
    height: 57,
    source: "rectangularnamednode",
  });
  assert.deepEqual(
    dimensionsFor("leafspelldef", { spellname: "a-name-over-14-chars" }),
    { width: 145, height: 57, source: "rectangularnamednodeLong" },
  );
  assert.deepEqual(dimensionsFor("customtype"), {
    width: 75,
    height: 75,
    source: "fallback",
  });
  assert.deepEqual(
    dimensionsFor("customtype", {}, { customtype: { width: 201, height: 99 } }),
    { width: 201, height: 99, source: "override" },
  );
});

test("layoutLeafGraph deterministically separates nodes and preserves LEAF data", () => {
  const graph = {
    domain: "example",
    appid: "layout",
    nodes: [
      makeNode("node-c", { x: 400, y: 300 }),
      makeNode("node-a", { x: 400, y: 300 }),
      makeNode("node-b", { x: 400, y: 300 }),
    ],
  };
  graph.nodes[1].out_edges.push({
    uuid: "edge-a-b",
    source: { uuid: "node-a" },
    target: { uuid: "node-b" },
    data: edgeData,
  });
  const original = structuredClone(graph);
  const options = {
    width: 800,
    height: 600,
    padding: 40,
    iterations: 120,
    precision: 3,
  };

  const first = layoutLeafGraph(graph, options);
  const second = layoutLeafGraph(graph, options);

  assert.deepEqual(first.graph, second.graph);
  assert.deepEqual(graph, original, "the source graph must not be mutated");
  assert.equal(first.nodeCount, 3);
  assert.equal(first.edgeCount, 1);
  assert.equal(first.overlapCount, 0);
  assert.equal(first.changedNodeUuids.length, 3);

  const positions = first.graph.nodes.map(
    (node) => decode(node.data).leaf.appdata.position,
  );
  assert.equal(new Set(positions.map(({ x, y }) => `${x},${y}`)).size, 3);
  for (const position of positions) {
    assert.ok(position.x >= 40 && position.x + 77 <= 760);
    assert.ok(position.y >= 40 && position.y + 77 <= 560);
    assert.equal(position.z, 7);
  }
  assertNoOverlaps(first.graph.nodes);
  for (const node of first.graph.nodes) {
    const decoded = decode(node.data);
    assert.equal(decoded.leaf.logic.type, "leaflabel");
    assert.equal(decoded.leaf.appdata.preserved, true);
  }
});

test("layoutLeafGraph rejects dangling LEAF edges", () => {
  const graph = {
    domain: "example",
    appid: "invalid",
    nodes: [makeNode("node-a", { x: 0, y: 0 })],
  };
  graph.nodes[0].out_edges.push({
    uuid: "dangling",
    source: { uuid: "node-a" },
    target: { uuid: "missing" },
    data: edgeData,
  });
  assert.throws(() => layoutLeafGraph(graph), /targets missing node missing/);
});

test("layoutLeafGraph rejects negative edge geometry options", () => {
  const graph = {
    domain: "example",
    appid: "invalid-edge-options",
    nodes: [makeNode("node-a", { x: 0, y: 0 })],
  };
  for (const option of [
    "edgeRepulsion",
    "edgeNodeRepulsion",
    "crossingPenalty",
    "sharedSegmentPenalty",
    "edgeClearance",
    "sharedSegmentTolerance",
  ]) {
    assert.throws(
      () => layoutLeafGraph(graph, { [option]: -1 }),
      new RegExp(`layout\\.${option} must be at least 0`),
    );
  }
});

test("layoutLeafGraph rejects unsupported semantic crossing policy", () => {
  const graph = {
    domain: "example",
    appid: "invalid-semantic-crossing-policy",
    nodes: [makeNode("node-a", { x: 0, y: 0 })],
  };
  assert.throws(
    () => layoutLeafGraph(graph, { semanticCrossingPolicy: "never-cross" }),
    /semanticCrossingPolicy must be one of allow, auto, forbid-edge-node, forbid-all/,
  );
});

test("layoutLeafGraph creates missing canvas metadata", () => {
  const graph = {
    domain: "example",
    appid: "missing-position",
    nodes: [
      {
        uuid: "node-a",
        leafnodetype: "leaflabel",
        data: encode({
          leaf: { api: "breezyforest", logic: { type: "leaflabel", args: {} } },
        }),
        out_edges: [],
      },
    ],
  };
  const result = layoutLeafGraph(graph, { width: 800, height: 600 });
  assert.deepEqual(decode(result.graph.nodes[0].data).leaf.appdata.position, {
    x: 361.5,
    y: 261.5,
  });
});

test("semantic projection preserves data-edge direction with minimum spacing", () => {
  const graph = makeGraph(
    {
      source: { x: 420, y: 260 },
      target: { x: 200, y: 260 },
    },
    [["edge-source-target", "source", "target"]],
  );
  const result = layoutLeafGraph(graph, {
    width: 800,
    height: 600,
    padding: 20,
    iterations: 4,
    attraction: 0,
    repulsion: 0,
    edgeRepulsion: 0,
    edgeNodeRepulsion: 0,
    crossingPenalty: 0,
    sharedSegmentPenalty: 0,
    gravity: 0,
    collisionPadding: 0,
    collisionIterations: 5,
    failOnOverlap: false,
    enforceSemanticConstraints: true,
    semanticDataSpacing: 80,
    semanticRankGap: 0,
    semanticProjectionPasses: 5,
    precision: 3,
  });
  const positions = new Map(
    result.graph.nodes.map((node) => [
      node.uuid,
      decode(node.data).leaf.appdata.position,
    ]),
  );
  assert.ok(positions.get("target").x - positions.get("source").x >= 80 - 1e-6);
  assert.equal(result.semanticViolationCount, 0);
});

test("semantic violation can fail fast when constraints are impossible", () => {
  const graph = makeGraph(
    {
      source: { x: 40, y: 200 },
      target: { x: 60, y: 200 },
    },
    [["edge-source-target", "source", "target"]],
  );
  assert.throws(
    () =>
      layoutLeafGraph(graph, {
        width: 220,
        height: 300,
        padding: 40,
        iterations: 3,
        attraction: 0,
        repulsion: 0,
        edgeRepulsion: 0,
        edgeNodeRepulsion: 0,
        crossingPenalty: 0,
        sharedSegmentPenalty: 0,
        gravity: 0,
        collisionPadding: 0,
        collisionIterations: 5,
        failOnOverlap: false,
        enforceSemanticConstraints: true,
        failOnSemanticViolation: true,
        semanticDataSpacing: 200,
        semanticRankGap: 0,
      }),
    /semantic constraint violation/,
  );
});

test("adaptive canvas can shrink runtime footprint and expose metrics", () => {
  const graph = makeGraph(
    {
      nodeA: { x: 80, y: 80 },
      nodeB: { x: 360, y: 90 },
      nodeC: { x: 90, y: 420 },
      nodeD: { x: 370, y: 430 },
    },
    [
      ["edge-a-b", "nodeA", "nodeB"],
      ["edge-c-d", "nodeC", "nodeD"],
    ],
  );
  const result = layoutLeafGraph(graph, {
    width: 4000,
    height: 3000,
    padding: 40,
    iterations: 6,
    maxRuntimeMs: 500,
    adaptiveCanvasByNodeCount: true,
  });

  assert.ok(result.effectiveCanvas.width < 4000);
  assert.ok(result.effectiveCanvas.height < 3000);
  assert.ok(result.effectiveCanvas.adaptive);
  assert.ok(result.elapsedMs >= 0);
});

test("layoutLeafGraph separates coincident mixed-size Piper node boxes", () => {
  const graph = {
    domain: "example",
    appid: "mixed-node-sizes",
    nodes: [
      makeTypedNode("circle", "leafscreenio", {}, { x: 300, y: 250 }),
      makeTypedNode("rectangle", "leafconfig", {}, { x: 300, y: 250 }),
      makeTypedNode(
        "spell",
        "leafspelldef",
        { spellname: "a-name-over-14-chars" },
        { x: 300, y: 250 },
      ),
      makeTypedNode("tiny", "leafoutflowport", {}, { x: 300, y: 250 }),
      makeTypedNode("custom", "customtype", {}, { x: 300, y: 250 }),
    ],
  };
  const options = {
    width: 1200,
    height: 800,
    padding: 40,
    iterations: 160,
    collisionPadding: 18,
    precision: 3,
    nodeDimensions: { customtype: { width: 190, height: 90 } },
  };

  const result = layoutLeafGraph(graph, options);

  assert.equal(result.overlapCount, 0);
  assertNoOverlaps(
    result.graph.nodes,
    options.collisionPadding,
    options.nodeDimensions,
  );
  for (const node of result.graph.nodes) {
    const box = nodeBox(node, options.nodeDimensions);
    assert.ok(box.x >= options.padding);
    assert.ok(box.y >= options.padding);
    assert.ok(box.x + box.width <= options.width - options.padding);
    assert.ok(box.y + box.height <= options.height - options.padding);
  }
});

test("crossing penalty separates independent crossing edges", () => {
  const graph = makeGraph(
    {
      northwest: { x: 100, y: 100 },
      southeast: { x: 700, y: 500 },
      southwest: { x: 100, y: 500 },
      northeast: { x: 700, y: 100 },
    },
    [
      ["edge-down", "northwest", "southeast"],
      ["edge-up", "southwest", "northeast"],
    ],
  );

  const baseline = layoutLeafGraph(graph, edgeFixtureOptions);
  const separated = layoutLeafGraph(graph, {
    ...edgeFixtureOptions,
    crossingPenalty: 2,
  });

  assert.equal(baseline.edgeCrossingCount, 1);
  assert.equal(separated.edgeCrossingCount, 0);
});

test("edge-to-node repulsion clears a nonincident node from an edge", () => {
  const graph = makeGraph(
    {
      source: { x: 100, y: 300 },
      target: { x: 700, y: 300 },
      obstructing: { x: 400, y: 300 },
    },
    [["edge", "source", "target"]],
  );

  const baseline = layoutLeafGraph(graph, edgeFixtureOptions);
  const separated = layoutLeafGraph(graph, {
    ...edgeFixtureOptions,
    edgeNodeRepulsion: 1,
  });

  assert.equal(baseline.edgeNodeIntersectionCount, 1);
  assert.equal(separated.edgeNodeIntersectionCount, 0);
  assert.ok(
    separated.edgeNodeProximityCount < baseline.edgeNodeProximityCount,
  );
});

test("edge-to-edge repulsion separates nearby independent edges", () => {
  const graph = makeGraph(
    {
      longStart: { x: 100, y: 300 },
      longEnd: { x: 700, y: 300 },
      shortStart: { x: 250, y: 320 },
      shortEnd: { x: 550, y: 320 },
    },
    [
      ["long-edge", "longStart", "longEnd"],
      ["short-edge", "shortStart", "shortEnd"],
    ],
  );
  const options = {
    ...edgeFixtureOptions,
    edgeClearance: 80,
    sharedSegmentTolerance: 0,
  };

  const baseline = layoutLeafGraph(graph, options);
  const separated = layoutLeafGraph(graph, {
    ...options,
    edgeRepulsion: 1,
  });

  assert.equal(baseline.edgeEdgeProximityCount, 1);
  assert.equal(separated.edgeEdgeProximityCount, 0);
  assert.ok(separated.minimumEdgeDistance > baseline.minimumEdgeDistance);
});

test("shared-segment penalty separates collinear edge paths", () => {
  const graph = makeGraph(
    {
      longStart: { x: 100, y: 300 },
      longEnd: { x: 700, y: 300 },
      shortStart: { x: 250, y: 300 },
      shortEnd: { x: 550, y: 300 },
    },
    [
      ["long-edge", "longStart", "longEnd"],
      ["short-edge", "shortStart", "shortEnd"],
    ],
  );

  const baseline = layoutLeafGraph(graph, edgeFixtureOptions);
  const separated = layoutLeafGraph(graph, {
    ...edgeFixtureOptions,
    sharedSegmentPenalty: 1,
  });

  assert.equal(baseline.sharedSegmentCount, 1);
  assert.equal(separated.sharedSegmentCount, 0);
});

test("semantic crossing policy allow can rule-in edge crossings", () => {
  const graph = makeGraph(
    {
      northwest: { x: 100, y: 100 },
      southeast: { x: 700, y: 500 },
      southwest: { x: 100, y: 500 },
      northeast: { x: 700, y: 100 },
    },
    [
      ["edge-down", "northwest", "southeast"],
      ["edge-up", "southwest", "northeast"],
    ],
  );

  const result = layoutLeafGraph(graph, {
    ...edgeFixtureOptions,
    edgeRepulsion: 1,
    crossingPenalty: 3,
    semanticCrossingPolicy: "allow",
  });

  assert.equal(result.edgeCrossingCount, 1);
  assert.equal(result.options.edgeRepulsion, 0);
  assert.equal(result.options.crossingPenalty, 0);
});

test("semantic crossing policy forbid-edge-node fails when intersections remain", () => {
  const graph = makeGraph(
    {
      source: { x: 100, y: 300 },
      target: { x: 700, y: 300 },
      obstructing: { x: 400, y: 300 },
    },
    [["edge", "source", "target"]],
  );

  assert.throws(
    () =>
      layoutLeafGraph(graph, {
        ...edgeFixtureOptions,
        semanticCrossingPolicy: "forbid-edge-node",
      }),
    /semantic crossing policy forbids edge-node intersections/,
  );
});

test("semantic crossing policy forbid-all fails when crossings remain", () => {
  const graph = makeGraph(
    {
      northwest: { x: 100, y: 100 },
      southeast: { x: 700, y: 500 },
      southwest: { x: 100, y: 500 },
      northeast: { x: 700, y: 100 },
    },
    [
      ["edge-down", "northwest", "southeast"],
      ["edge-up", "southwest", "northeast"],
    ],
  );

  assert.throws(
    () =>
      layoutLeafGraph(graph, {
        ...edgeFixtureOptions,
        semanticCrossingPolicy: "forbid-all",
      }),
    /semantic crossing policy forbids edge crossings\/intersections/,
  );
});

test("disabling edge geometry forces preserves legacy force-layout output", () => {
  const graph = makeGraph(
    {
      nodeA: { x: 120, y: 120 },
      nodeB: { x: 620, y: 420 },
      nodeC: { x: 120, y: 420 },
      nodeD: { x: 620, y: 120 },
    },
    [
      ["edge-a", "nodeA", "nodeB"],
      ["edge-b", "nodeC", "nodeD"],
    ],
  );
  const disabled = layoutLeafGraph(graph, {
    ...edgeFixtureOptions,
    edgeClearance: 500,
    sharedSegmentTolerance: 500,
  });
  const control = layoutLeafGraph(graph, edgeFixtureOptions);

  assert.deepEqual(disabled.graph, control.graph);
  assert.deepEqual(
    {
      edgeCrossingCount: disabled.edgeCrossingCount,
      sharedSegmentCount: disabled.sharedSegmentCount,
      edgeEdgeProximityCount: disabled.edgeEdgeProximityCount,
      edgeNodeIntersectionCount: disabled.edgeNodeIntersectionCount,
      edgeNodeProximityCount: disabled.edgeNodeProximityCount,
      minimumEdgeDistance: disabled.minimumEdgeDistance,
    },
    {
      edgeCrossingCount: 1,
      sharedSegmentCount: 0,
      edgeEdgeProximityCount: 1,
      edgeNodeIntersectionCount: 0,
      edgeNodeProximityCount: 4,
      minimumEdgeDistance: 0,
    },
  );
});

test("local batch layout runs after a topology operation", async () => {
  const temporaryDirectory = await mkdtemp(
    join(skillDirectory, ".layout-test-"),
  );
  try {
    const graphPath = join(temporaryDirectory, "graph.json");
    const manifestPath = join(temporaryDirectory, "batch.json");
    await writeFile(
      graphPath,
      `${JSON.stringify(
        {
          domain: "example",
          appid: "batch-layout",
          nodes: [
            makeNode("node-a", { x: 200, y: 200 }),
            makeNode("node-b", { x: 200, y: 200 }),
          ],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          format: "leaf.graph-batch.v1",
          graphs: [
            {
              domain: "example",
              appid: "batch-layout",
              file: "graph.json",
              layout: {
                algorithm: "force-directed",
                width: 800,
                height: 600,
                iterations: 80,
              },
            },
          ],
          operations: [
            {
              op: "addEdge",
              domain: "example",
              appid: "batch-layout",
              edge: {
                uuid: "edge-a-b",
                source: "node-a",
                target: "node-b",
                data: edgeData,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const plan = spawnSync(process.execPath, [batchScript, manifestPath], {
      cwd: skillDirectory,
      encoding: "utf8",
    });
    assert.equal(plan.status, 0, plan.stderr);
    const planResult = JSON.parse(plan.stdout);
    assert.equal(planResult.layouts.length, 1);
    assert.equal(planResult.layouts[0].operation, 0);
    assert.equal(planResult.layouts[0].overlapCount, 0);
    assert.equal(planResult.layouts[0].edgeCrossingCount, 0);
    assert.equal(planResult.layouts[0].sharedSegmentCount, 0);
    assert.equal(planResult.layouts[0].edgeEdgeProximityCount, 0);
    assert.equal(planResult.layouts[0].edgeNodeIntersectionCount, 0);
    assert.equal(planResult.layouts[0].edgeNodeProximityCount, 0);
    assert.equal(planResult.layouts[0].minimumEdgeDistance, null);

    const remote = spawnSync(
      process.execPath,
      [batchScript, manifestPath, "--apply"],
      {
        cwd: skillDirectory,
        encoding: "utf8",
      },
    );
    assert.notEqual(remote.status, 0);
    assert.match(remote.stderr, /local layout simulation is local-only/);

    const write = spawnSync(
      process.execPath,
      [
        batchScript,
        manifestPath,
        "--write-local",
        "--confirm",
        planResult.confirmation,
      ],
      { cwd: skillDirectory, encoding: "utf8" },
    );
    assert.equal(write.status, 0, write.stderr);

    const written = JSON.parse(await readFile(graphPath, "utf8"));
    const positions = written.nodes.map(
      (node) => decode(node.data).leaf.appdata.position,
    );
    assert.notDeepEqual(positions[0], positions[1]);
    assert.equal(written.nodes[0].out_edges.length, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
