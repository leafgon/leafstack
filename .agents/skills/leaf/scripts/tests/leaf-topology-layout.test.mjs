import assert from "node:assert/strict";
import test from "node:test";

import { layoutLeafTopology } from "../lib/leaf-topology-layout.mjs";

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

const makeGraph = () => {
  const nodes = [makeNode("node-c"), makeNode("node-a"), makeNode("node-b")];
  nodes[1].out_edges.push({
    uuid: "edge-z",
    source: { uuid: "node-a" },
    target: { uuid: "node-b" },
    data: "",
  });
  nodes[2].out_edges.push({
    uuid: "edge-a",
    source: { uuid: "node-b" },
    target: { uuid: "node-c" },
    data: "",
  });
  return { domain: "example", appid: "topology", nodes };
};

const fakeElk = (calls) => ({
  async layout(input) {
    calls.push(input);
    const positions = new Map([
      ["node-a", { x: 80, y: 80 }],
      ["node-b", { x: 237, y: 80 }],
      ["node-c", { x: 394, y: 80 }],
    ]);
    return {
      id: input.id,
      width: 551,
      height: 237,
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

test("layoutLeafTopology preserves LEAF data and returns deterministic routes", async () => {
  const graph = makeGraph();
  const original = structuredClone(graph);
  const calls = [];
  const result = await layoutLeafTopology(
    graph,
    { precision: 2 },
    { elk: fakeElk(calls) },
  );

  assert.deepEqual(graph, original, "the source graph must not be mutated");
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].children.map((child) => child.id),
    ["node-a", "node-b", "node-c"],
  );
  assert.deepEqual(
    calls[0].edges.map((edge) => edge.id),
    ["edge-a", "edge-z"],
  );
  assert.equal(calls[0].layoutOptions["elk.algorithm"], "layered");
  assert.equal(calls[0].layoutOptions["elk.edgeRouting"], "ORTHOGONAL");
  assert.equal(calls[0].children[0].width, 77);
  assert.equal(calls[0].children[0].height, 77);

  assert.deepEqual(result.changedNodeUuids, ["node-a", "node-b", "node-c"]);
  assert.equal(result.nodeCount, 3);
  assert.equal(result.edgeCount, 2);
  assert.equal(result.width, 551);
  assert.equal(result.height, 237);
  assert.equal(result.overlapCount, 0);
  assert.equal(result.straightEdgeCrossingCount, 0);
  assert.equal(result.routedEdgeCrossingCount, 0);
  assert.equal(result.routedEdgeOverlapCount, 0);
  assert.equal(result.edgeNodeIntersectionCount, 0);
  assert.equal(result.routedEdges.length, 2);

  const positions = new Map(
    result.graph.nodes.map((node) => [
      node.uuid,
      decode(node.data).leaf.appdata.position,
    ]),
  );
  assert.deepEqual(positions.get("node-a"), { x: 80, y: 80, z: 9 });
  assert.deepEqual(positions.get("node-b"), { x: 237, y: 80, z: 9 });
  assert.deepEqual(positions.get("node-c"), { x: 394, y: 80, z: 9 });
  for (const node of result.graph.nodes) {
    assert.equal(decode(node.data).leaf.appdata.preserved, true);
  }
});

test("layoutLeafTopology rejects overlapping ELK output by default", async () => {
  const graph = makeGraph();
  const elk = {
    async layout(input) {
      return {
        children: input.children.map((child) => ({ ...child, x: 80, y: 80 })),
        edges: input.edges.map((edge) => ({ ...edge, sections: [] })),
      };
    },
  };
  await assert.rejects(
    layoutLeafTopology(graph, {}, { elk }),
    /left 3 overlapping node pair/,
  );
});

test("layoutLeafTopology rejects dangling LEAF edges before calling ELK", async () => {
  const graph = makeGraph();
  graph.nodes[1].out_edges[0].target.uuid = "missing";
  let called = false;
  await assert.rejects(
    layoutLeafTopology(graph, {}, {
      elk: { async layout() { called = true; } },
    }),
    /targets missing node missing/,
  );
  assert.equal(called, false);
});
