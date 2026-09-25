import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "validate-runtime-dto.mjs");

const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const run = (args) =>
  new Promise((resolveChild) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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

const runtimeFixture = {
  domain: "example",
  appid: "fixture",
  nodes: [
    {
      uuid: "IN1",
      leafnodetype: "leafinflowport",
      data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
      out_edges: [
        {
          uuid: "E1",
          source: { uuid: "IN1" },
          target: { uuid: "OUT1" },
          data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
        },
      ],
    },
    {
      uuid: "OUT1",
      leafnodetype: "leafoutflowport",
      data: encode({ leaf: { logic: { type: "leafoutflowport", args: {} } } }),
      out_edges: [],
    },
  ],
};

const declarativeFixture = {
  kind: "leaf-graph",
  version: "1.0.1",
  nodes: [
    {
      id: "n1",
      element: "leafelement(http)",
    },
  ],
  inputs: {
    IN1: { type: "number" },
  },
  outputs: {
    OUT1: { type: "number" },
  },
};

test("validate-runtime-dto passes for transport DTO graph", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".validate-runtime-dto-test-"));
  try {
    const graphPath = join(temporaryDirectory, "graph.json");
    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");

    const result = await run(["--graph", graphPath]);
    assert.equal(result.status, 0, result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, true);
    assert.equal(output.nodeCount, 2);
    assert.equal(output.edgeCount, 1);
    assert.deepEqual(output.problems, []);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("validate-runtime-dto rejects declarative graph shape", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".validate-runtime-dto-test-"));
  try {
    const graphPath = join(temporaryDirectory, "graph.json");
    await writeFile(graphPath, `${JSON.stringify(declarativeFixture, null, 2)}\n`, "utf8");

    const result = await run(["--graph", graphPath]);
    assert.equal(result.status, 1, result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.equal(output.declarativeShape, true);
    assert.ok(output.problems.some((entry) => entry.includes("declarative")));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
