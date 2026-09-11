import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildGraphFromJsonld,
  exportGraphToJsonld,
} from "../lib/leaf-jsonld.mjs";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const buildScript = join(skillDirectory, "scripts", "leaf-jsonld-build.mjs");
const exportScript = join(skillDirectory, "scripts", "leaf-jsonld-export.mjs");

const run = (scriptPath, args) =>
  new Promise((resolveChild) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolveChild({ status, stdout, stderr }));
  });

const sampleJsonld = {
  "@context": "https://leafgon.com/ns/leaf-graph-jsonld/v1",
  "@id": "leaf://example/jsonld-sample",
  "@type": "LeafGraph",
  domain: "example",
  appid: "jsonld-sample",
  nodes: [
    {
      "@id": "leaf://example/jsonld-sample/node/node-in",
      "@type": "LeafNode",
      uuid: "node-in",
      leafnodetype: "leafinflowport",
      data: {
        leaf: {
          logic: {
            type: "leafinflowport",
          },
          appdata: {
            position: { x: 120, y: 200 },
          },
        },
      },
    },
    {
      "@id": "leaf://example/jsonld-sample/node/node-out",
      "@type": "LeafNode",
      uuid: "node-out",
      leafnodetype: "leafoutflowport",
      data: {
        leaf: {
          logic: {
            type: "leafoutflowport",
          },
          appdata: {
            position: { x: 460, y: 200 },
          },
        },
      },
    },
  ],
  edges: [
    {
      "@id": "leaf://example/jsonld-sample/edge/edge-in-out",
      "@type": "LeafEdge",
      uuid: "edge-in-out",
      source: "node-in",
      target: "node-out",
      edgeType: "leafdataedge",
      data: {
        leaf: {
          logic: {
            type: "leafdataedge",
          },
        },
      },
    },
  ],
};

test("library converters preserve graph semantics across JSON-LD and runtime DTO", () => {
  const runtimeGraph = buildGraphFromJsonld(sampleJsonld);
  assert.equal(runtimeGraph.domain, "example");
  assert.equal(runtimeGraph.appid, "jsonld-sample");
  assert.equal(runtimeGraph.nodes.length, 2);
  assert.equal(runtimeGraph.nodes[0].uuid, "node-in");
  assert.equal(runtimeGraph.nodes[0].out_edges.length, 1);

  const roundTripped = exportGraphToJsonld(runtimeGraph);
  assert.equal(roundTripped.domain, sampleJsonld.domain);
  assert.equal(roundTripped.appid, sampleJsonld.appid);
  assert.equal(roundTripped.nodes.length, sampleJsonld.nodes.length);
  assert.equal(roundTripped.edges.length, sampleJsonld.edges.length);
  assert.equal(roundTripped.edges[0].source, sampleJsonld.edges[0].source);
  assert.equal(roundTripped.edges[0].target, sampleJsonld.edges[0].target);
  assert.equal(roundTripped.edges[0].edgeType, "leafdataedge");
});

test("CLI build/export workflow emits executable DTO-compatible graph JSON", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".jsonld-tools-test-"));
  try {
    const jsonldPath = join(temporaryDirectory, "graph.jsonld");
    const graphPath = join(temporaryDirectory, "graph.json");
    const exportedPath = join(temporaryDirectory, "graph.roundtrip.jsonld");

    await writeFile(jsonldPath, `${JSON.stringify(sampleJsonld, null, 2)}\n`, "utf8");

    const buildResult = await run(buildScript, ["--jsonld", jsonldPath, "--out", graphPath]);
    assert.equal(buildResult.status, 0, buildResult.stderr);
    const buildSummary = JSON.parse(buildResult.stdout);
    assert.equal(buildSummary.mode, "jsonld-to-graph");
    assert.equal(buildSummary.nodeCount, 2);
    assert.equal(buildSummary.edgeCount, 1);

    const graph = JSON.parse(await readFile(graphPath, "utf8"));
    assert.equal(graph.domain, "example");
    assert.equal(graph.appid, "jsonld-sample");
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.nodes[0].leafnodetype, "leafinflowport");
    assert.equal(typeof graph.nodes[0].data, "string");
    assert.equal(graph.nodes[0].out_edges.length, 1);
    assert.equal(typeof graph.nodes[0].out_edges[0].data, "string");

    const exportResult = await run(exportScript, ["--graph", graphPath, "--out", exportedPath]);
    assert.equal(exportResult.status, 0, exportResult.stderr);
    const exportSummary = JSON.parse(exportResult.stdout);
    assert.equal(exportSummary.mode, "graph-to-jsonld");
    assert.equal(exportSummary.nodeCount, 2);
    assert.equal(exportSummary.edgeCount, 1);

    const exported = JSON.parse(await readFile(exportedPath, "utf8"));
    assert.equal(exported["@type"], "LeafGraph");
    assert.equal(exported.nodes.length, 2);
    assert.equal(exported.edges.length, 1);
    assert.equal(exported.edges[0].edgeType, "leafdataedge");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
