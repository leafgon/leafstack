import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowScript = join(skillDirectory, "scripts", "leaf-jsonld-workflow.mjs");
const ghostosLatest = JSON.parse(
  execFileSync("npm", ["view", "ghostos@latest", "version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);

const run = (args) =>
  new Promise((resolveChild) => {
    const child = spawn(process.execPath, [workflowScript, ...args], {
      env: process.env,
    });
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
  "@id": "leaf://example/workflow-sample",
  "@type": "LeafGraph",
  domain: "example",
  appid: "workflow-sample",
  nodes: [
    {
      "@id": "leaf://example/workflow-sample/node/in",
      "@type": "LeafNode",
      uuid: "in",
      leafnodetype: "leafinflowport",
      data: {
        leaf: {
          logic: { type: "leafinflowport" },
          appdata: {},
        },
      },
    },
    {
      "@id": "leaf://example/workflow-sample/node/out",
      "@type": "LeafNode",
      uuid: "out",
      leafnodetype: "leafoutflowport",
      data: {
        leaf: {
          logic: { type: "leafoutflowport" },
          appdata: {},
        },
      },
    },
  ],
  edges: [
    {
      "@id": "leaf://example/workflow-sample/edge/in-out",
      "@type": "LeafEdge",
      uuid: "in-out",
      source: "in",
      target: "out",
      edgeType: "leafdataedge",
      data: {
        leaf: {
          logic: { type: "leafdataedge" },
        },
      },
    },
  ],
};

test("leaf-jsonld-workflow runs build, inspect, execute, and roundtrip export", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".jsonld-workflow-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");

  try {
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      `export const executeLEAFGraph = async (graph, input, options = {}) => ({
  domain: options.domain ?? null,
  appid: options.appid ?? null,
  refnode: options.refnode ?? null,
  nodeCount: Array.isArray(graph?.nodes) ? graph.nodes.length : -1,
  input
});
`,
      "utf8",
    );

    const jsonldPath = join(temporaryDirectory, "graph.jsonld");
    const graphPath = join(temporaryDirectory, "graph.json");
    const roundtripPath = join(temporaryDirectory, "graph.roundtrip.jsonld");
    const inputPath = join(temporaryDirectory, "input.json");
    await writeFile(jsonldPath, `${JSON.stringify(sampleJsonld, null, 2)}\n`, "utf8");
    await writeFile(inputPath, `${JSON.stringify({ IN1: 8 }, null, 2)}\n`, "utf8");

    const result = await run([
      "--jsonld",
      jsonldPath,
      "--graph-out",
      graphPath,
      "--input",
      inputPath,
      "--refnode",
      "out",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
      "--jsonld-roundtrip-out",
      roundtripPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "jsonld-workflow");
    assert.equal(output.executed, true);
    assert.equal(output.inspected.nodeCount, 2);
    assert.equal(output.inspected.edgeCount, 1);
    assert.deepEqual(output.inspected.errors, []);
    assert.equal(output.run.ghostosVersion, ghostosLatest);
    assert.deepEqual(output.run.output, {
      domain: "example",
      appid: "workflow-sample",
      refnode: "out",
      nodeCount: 2,
      input: { IN1: 8 },
    });

    const graph = JSON.parse(await readFile(graphPath, "utf8"));
    assert.equal(graph.domain, "example");
    assert.equal(graph.appid, "workflow-sample");
    assert.equal(graph.nodes.length, 2);
    assert.equal(typeof graph.nodes[0].data, "string");
    assert.equal(graph.nodes[0].out_edges.length, 1);

    const roundtrip = JSON.parse(await readFile(roundtripPath, "utf8"));
    assert.equal(roundtrip["@type"], "LeafGraph");
    assert.equal(roundtrip.nodes.length, 2);
    assert.equal(roundtrip.edges.length, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
