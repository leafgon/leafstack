import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "validate-dag-contract.mjs");

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

const fixtureGraph = (withExtraContractEdge = false) => {
  const dataEdge = encode({ leaf: { logic: { type: "leafdataedge" } } });
  const lambdaEdge = encode({ leaf: { logic: { type: "leaflambdaedge" } } });
  const nodeData = (type) =>
    encode({
      leaf: {
        logic: { type },
        appdata: {},
      },
    });

  const nodes = [
    {
      uuid: "IN1",
      leafnodetype: "leafinflowport",
      data: nodeData("leafinflowport"),
      out_edges: [
        {
          uuid: "E1",
          source: { uuid: "IN1" },
          target: { uuid: "M1" },
          data: dataEdge,
        },
      ],
    },
    {
      uuid: "M1",
      leafnodetype: "leaflisp",
      data: nodeData("leaflisp"),
      out_edges: [
        {
          uuid: "E2",
          source: { uuid: "M1" },
          target: { uuid: "OUT1" },
          data: dataEdge,
        },
      ],
    },
    {
      uuid: "OUT1",
      leafnodetype: "leafoutflowport",
      data: nodeData("leafoutflowport"),
      out_edges: [],
    },
    {
      uuid: "SPELL_IMPL",
      leafnodetype: "leaflisp",
      data: nodeData("leaflisp"),
      out_edges: [
        {
          uuid: "L1",
          source: { uuid: "SPELL_IMPL" },
          target: { uuid: "SPELL_DEF" },
          data: lambdaEdge,
        },
      ],
    },
    {
      uuid: "SPELL_DEF",
      leafnodetype: "leafspelldef",
      data: nodeData("leafspelldef"),
      out_edges: [],
    },
  ];

  if (withExtraContractEdge) {
    nodes[0].out_edges.push({
      uuid: "EXTRA",
      source: { uuid: "IN1" },
      target: { uuid: "OUT1" },
      data: dataEdge,
    });
  }

  return {
    domain: "example",
    appid: "dag-contract",
    nodes,
  };
};

test("validate-dag-contract passes when contract edges match exactly", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".dag-contract-test-"));
  try {
    const graphPath = join(temporaryDirectory, "graph.json");
    const requiredPath = join(temporaryDirectory, "required.json");

    await writeFile(graphPath, `${JSON.stringify(fixtureGraph(false), null, 2)}\n`, "utf8");
    await writeFile(
      requiredPath,
      `${JSON.stringify(["IN1->M1", "M1->OUT1"], null, 2)}\n`,
      "utf8",
    );

    const result = await run(["--graph", graphPath, "--required", requiredPath]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, true);
    assert.deepEqual(output.missingDirectEdges, []);
    assert.deepEqual(output.unexpectedDirectEdges, []);
    assert.deepEqual(output.missingReachability, []);
    assert.deepEqual(output.unexpectedReachability, []);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("validate-dag-contract fails when an unexpected contract data edge exists", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".dag-contract-test-"));
  try {
    const graphPath = join(temporaryDirectory, "graph.json");
    const requiredPath = join(temporaryDirectory, "required.json");

    await writeFile(graphPath, `${JSON.stringify(fixtureGraph(true), null, 2)}\n`, "utf8");
    await writeFile(
      requiredPath,
      `${JSON.stringify(["IN1->M1", "M1->OUT1"], null, 2)}\n`,
      "utf8",
    );

    const result = await run(["--graph", graphPath, "--required", requiredPath]);
    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.deepEqual(output.unexpectedDirectEdges, ["IN1->OUT1"]);
    assert.deepEqual(output.missingDirectEdges, []);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
