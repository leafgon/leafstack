import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "preflight-runtime-dto.mjs");
const ghostosLatest = JSON.parse(
  execFileSync("npm", ["view", "ghostos@latest", "version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);

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
  appid: "preflight-fixture",
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

test("preflight-runtime-dto passes with expected vector output shape", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");

  try {
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      `export const executeLEAFGraph = async (_graph, input) => ({ OUT1: [Number(input.IN1 ?? 0) + 2, Number(input.IN1 ?? 0) - 3] });\n`,
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--out-kind",
      "vector",
      "--out-length",
      "2",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "preflight-runtime-dto");
    assert.equal(output.pass, true);
    assert.equal(output.outKindObserved, "vector");
    assert.equal(output.outLengthObserved, 2);
    assert.deepEqual(output.checks, []);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto fails when output key is missing", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");

  try {
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      `export const executeLEAFGraph = async (_graph, input) => ({ OUT1: Number(input.IN1 ?? 0) + 2 });\n`,
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT2",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(
      output.checks.includes("missing-output-key:OUT2")
      || output.checks.includes("static-contract:missing-outflow-node"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto diagnose reports runtime classification when smoke execution fails", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");

  try {
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      `export const executeLEAFGraph = async () => { throw new Error("LEAFlisp error: {refnode: REQ_SUB_9}: line: 0 - Type Error! Expected 'Vector', but got 'Number'"); };\n`,
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
      "--diagnose",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("smoke-execution-failed"));
    assert.equal(output.diagnostics.enabled, true);
    const issueCodes = output.diagnostics.issues.map((entry) => entry.code);
    assert.ok(issueCodes.includes("leaflisp_expected_vector_got_number"));
    assert.equal(output.diagnostics.refnode, "REQ_SUB_9");
    assert.equal(output.diagnostics.focus?.found, false);
    assert.ok(Array.isArray(output.diagnostics.nextActions));
    assert.ok(output.diagnostics.nextActions.length >= 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto static contract lint fails before smoke", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const httpContractFixture = {
    domain: "example",
    appid: "http-contract-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "E1",
            source: { uuid: "IN1" },
            target: { uuid: "REQ_HTTP" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "REQ_HTTP",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(bottle \"wrong-request\" {:operation \"add\" :operands [inport 2]})",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E2",
            source: { uuid: "REQ_HTTP" },
            target: { uuid: "HTTP_ARITH" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "HTTP_ARITH",
        leafnodetype: "leafelement",
        data: encode({
          leaf: {
            logic: {
              type: "leafelement",
              args: {
                elementname: "http",
                elementconfig: "",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E3",
            source: { uuid: "HTTP_ARITH" },
            target: { uuid: "PARSE_HTTP" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "PARSE_HTTP",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(get inport :result)",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E4",
            source: { uuid: "PARSE_HTTP" },
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

  try {
    await writeFile(graphPath, `${JSON.stringify(httpContractFixture, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--diagnose",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("static-contract:http-request-source-missing-http-request-bottle"));
    assert.equal(output.steps.smoke, null);
    assert.equal(output.staticContract.pass, false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
