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
    assert.equal(output.completion.readyToSubmit, true);
    assert.equal(output.completion.stopNow, true);
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

test("preflight-runtime-dto classifies scalar-root output envelope without sink-key misclassification", async () => {
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
      "export const executeLEAFGraph = async () => 42;\n",
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
    assert.ok(output.checks.includes("output-envelope-nonobject:OUT1"));
    assert.ok(!output.checks.includes("missing-output-key:OUT1"));
    assert.equal(output.firstFixRecipe.code, "output-envelope-nonobject:OUT1");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto classifies null-root output envelope and avoids missing-output-key sink recipe", async () => {
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
      "export const executeLEAFGraph = async () => null;\n",
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
    assert.ok(output.checks.includes("output-envelope-null:OUT1"));
    assert.ok(!output.checks.includes("missing-output-key:OUT1"));
    assert.equal(output.firstFixRecipe.code, "output-envelope-null:OUT1");
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

test("preflight-runtime-dto flags unsafe HTTP parse expressions before smoke", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const unsafeHttpParseFixture = {
    domain: "example",
    appid: "http-unsafe-parse-fixture",
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
                lispexpression: "(do (def request {:uri \"http://127.0.0.1:8080/v1/operations\" :mode \"post\" :header {:content-type \"application/json\"} :data {:profile \"profile-001\" :operation \"add\" :operands [inport 2]}}) (bottle \"http-request\" request))",
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
                lispexpression: "(do (def pair inport) (def first (get pair 0)) (def second (get pair 1)) (def payload (if (isbottle first) (get first :_content) first)) (def result (parse (get payload :result))) {:OUT1 result})",
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
    await writeFile(graphPath, `${JSON.stringify(unsafeHttpParseFixture, null, 2)}\n`, "utf8");

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
    assert.ok(output.checks.includes("static-contract:http-parse-target-unsafe-result-parse"));
    assert.ok(output.checks.includes("static-contract:http-parse-target-unchecked-pair-assumption"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto blocks positional multi-input leaflisp joins", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const multiInputFixture = {
    domain: "example",
    appid: "multi-input-index-fixture",
    nodes: [
      {
        uuid: "A",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "EA",
            source: { uuid: "A" },
            target: { uuid: "JOIN" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "B",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "EB",
            source: { uuid: "B" },
            target: { uuid: "JOIN" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "JOIN",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do (def left (get inport 0)) (def right (get inport 1)) (+ left right))",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "EJ",
            source: { uuid: "JOIN" },
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
    await writeFile(graphPath, `${JSON.stringify(multiInputFixture, null, 2)}\n`, "utf8");

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
    assert.equal(output.completion.readyToSubmit, false);
    assert.ok(output.checks.includes("static-contract:leaflisp-multi-input-index-access"));
    assert.ok(
      output.staticContract.warnings
        .map((entry) => entry.code)
        .includes("leaflisp-multi-input-provenance-unclear"),
    );
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto blocks unsupported leaflisp dialect tokens", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const badDialectFixture = {
    domain: "example",
    appid: "bad-dialect-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "E1",
            source: { uuid: "IN1" },
            target: { uuid: "JOIN" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "JOIN",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do (def xs (list inport2)) xs)",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E2",
            source: { uuid: "JOIN" },
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
    await writeFile(graphPath, `${JSON.stringify(badDialectFixture, null, 2)}\n`, "utf8");

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
    assert.equal(output.completion.readyToSubmit, false);
    assert.ok(output.checks.includes("static-contract:leaflisp-unsupported-token-list"));
    assert.ok(output.checks.includes("static-contract:leaflisp-unsupported-token-inport2"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto warns on redundant keyed-mix unwrap scaffolds", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const keyedMixFixture = {
    domain: "example",
    appid: "keyed-mix-overunwrap-fixture",
    nodes: [
      {
        uuid: "CONST_A",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "3",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E_A",
            source: { uuid: "CONST_A" },
            target: { uuid: "BOTTLE_A" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "CONST_B",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "5",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E_B",
            source: { uuid: "CONST_B" },
            target: { uuid: "BOTTLE_B" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "BOTTLE_A",
        leafnodetype: "leafbottle",
        data: encode({
          leaf: {
            logic: {
              type: "leafbottle",
              args: { bottlekey: "arg1" },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E_BA",
            source: { uuid: "BOTTLE_A" },
            target: { uuid: "MIX" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "BOTTLE_B",
        leafnodetype: "leafbottle",
        data: encode({
          leaf: {
            logic: {
              type: "leafbottle",
              args: { bottlekey: "arg2" },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E_BB",
            source: { uuid: "BOTTLE_B" },
            target: { uuid: "MIX" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "MIX",
        leafnodetype: "leafmixflow",
        data: encode({
          leaf: {
            logic: {
              type: "leafmixflow",
              args: {
                mixOperator: "merge",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E_M",
            source: { uuid: "MIX" },
            target: { uuid: "JOIN" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "JOIN",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do (def merged0 (if (isbottle inport) (get inport :_content) inport)) (def merged (if (isbottle merged0) (get merged0 :_content) merged0)) (def a (get merged :arg1)) (def b (get merged :arg2)) (+ a b))",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E_J",
            source: { uuid: "JOIN" },
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
    await writeFile(graphPath, `${JSON.stringify(keyedMixFixture, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--diagnose",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.staticContract.pass, true);
    assert.ok(
      output.staticContract.warnings
        .map((entry) => entry.code)
        .includes("leaflisp-keyed-mix-overunwrap"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto blocks literal shell templates in leaflisp HTTP request builders", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const shellTemplateFixture = {
    domain: "example",
    appid: "shell-template-fixture",
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
                lispexpression: "(do (def request {:uri \"http://127.0.0.1:8080/v1/operations\" :mode \"post\" :header {:content-type \"application/json\"} :data {:profile \"${ARITHMETIC_PROFILE_ID:-profile-001}\" :operation \"add\" :operands [inport 2]}}) (bottle \"http-request\" request))",
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
                lispexpression: "(do (def payloadzero (if (isbottle inport) (get inport :_content) inport)) (def payload (if (isbottle payloadzero) (get payloadzero :_content) payloadzero)) (def result (get payload :result)) {:OUT1 result})",
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
    await writeFile(graphPath, `${JSON.stringify(shellTemplateFixture, null, 2)}\n`, "utf8");

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
    assert.ok(output.checks.includes("static-contract:leaflisp-literal-shell-template"));
    assert.ok(output.checks.includes("static-contract:http-request-source-literal-shell-template"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto blocks placeholder wait-bottle fallback", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const waitFallbackFixture = {
    domain: "example",
    appid: "wait-fallback-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "E1",
            source: { uuid: "IN1" },
            target: { uuid: "JOIN" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "JOIN",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do (bottle \"wait\" 0))",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E2",
            source: { uuid: "JOIN" },
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
    await writeFile(graphPath, `${JSON.stringify(waitFallbackFixture, null, 2)}\n`, "utf8");
    const result = await run(["--graph", graphPath, "--out-key", "OUT1", "--diagnose"]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("static-contract:leaflisp-wait-bottle-fallback"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto blocks lossy list coercion", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const lossyListFixture = {
    domain: "example",
    appid: "lossy-list-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "E1",
            source: { uuid: "IN1" },
            target: { uuid: "JOIN" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "JOIN",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do (def raw inport) (def v (if (islist raw) 0 raw)) v)",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E2",
            source: { uuid: "JOIN" },
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
    await writeFile(graphPath, `${JSON.stringify(lossyListFixture, null, 2)}\n`, "utf8");
    const result = await run(["--graph", graphPath, "--out-key", "OUT1", "--diagnose"]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("static-contract:leaflisp-lossy-list-coercion"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto blocks non-source IN1 reread fallback", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const nonsourceIn1RereadFixture = {
    domain: "example",
    appid: "nonsource-in1-reread-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "E1",
            source: { uuid: "IN1" },
            target: { uuid: "PASS" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "PASS",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do {:x inport})",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E2",
            source: { uuid: "PASS" },
            target: { uuid: "JOIN" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "JOIN",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do (def raw0 (if (isbottle inport) (get inport :_content) inport)) (def bykey (get raw0 :IN1)) (if (isnil bykey) raw0 bykey))",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E3",
            source: { uuid: "JOIN" },
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
    await writeFile(graphPath, `${JSON.stringify(nonsourceIn1RereadFixture, null, 2)}\n`, "utf8");
    const result = await run(["--graph", graphPath, "--out-key", "OUT1", "--diagnose"]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("static-contract:leaflisp-nonsource-in1-reread"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto warns on unproven raw (parse inport) in balanced mode", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");

  const rawParseFixture = {
    domain: "example",
    appid: "raw-parse-inport-warning-fixture",
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
                lispexpression: "(do (def x (parse inport)) (def request {:uri \"http://127.0.0.1:8080/v1/operations\" :mode \"post\" :header {:content-type \"application/json\"} :data {:profile \"profile-001\" :operation \"add\" :operands [x 2]}}) (bottle \"http-request\" request))",
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
                lispexpression: "(do (def payloadzero (if (isbottle inport) (get inport :_content) inport)) (def payload (if (isbottle payloadzero) (get payloadzero :_content) payloadzero)) (def result (get payload :result)) (if (isnil result) nil result))",
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
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      "export const executeLEAFGraph = async () => ({ OUT1: 13 });\n",
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(rawParseFixture, null, 2)}\n`, "utf8");
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

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, true);
    assert.equal(output.parseSafety, "balanced");
    assert.ok(!output.checks.includes("static-contract:leaflisp-raw-parse-inport-unproven-scalar"));
    assert.ok(
      output.staticContract.warnings
        .map((entry) => entry.code)
        .includes("leaflisp-raw-parse-inport-unproven-scalar"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto escalates unproven raw (parse inport) in strict mode", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const strictRawParseFixture = {
    domain: "example",
    appid: "raw-parse-inport-strict-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "E1",
            source: { uuid: "IN1" },
            target: { uuid: "PARSE_NODE" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "PARSE_NODE",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(do (def x inport) (parse x))",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E2",
            source: { uuid: "PARSE_NODE" },
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
    await writeFile(graphPath, `${JSON.stringify(strictRawParseFixture, null, 2)}\n`, "utf8");
    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--parse-safety",
      "strict",
      "--diagnose",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.equal(output.parseSafety, "strict");
    assert.ok(output.checks.includes("static-contract:leaflisp-raw-parse-inport-unproven-scalar"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto blocks raw (parse inport) when upstream is non-scalar-risk", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const nonscalarRiskFixture = {
    domain: "example",
    appid: "raw-parse-inport-nonscalar-risk-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [
          {
            uuid: "E1",
            source: { uuid: "IN1" },
            target: { uuid: "MIX" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "MIX",
        leafnodetype: "leafmixflow",
        data: encode({ leaf: { logic: { type: "leafmixflow", args: {} } } }),
        out_edges: [
          {
            uuid: "E2",
            source: { uuid: "MIX" },
            target: { uuid: "PARSE_NODE" },
            data: encode({ leaf: { logic: { type: "leafdataedge", args: {} } } }),
          },
        ],
      },
      {
        uuid: "PARSE_NODE",
        leafnodetype: "leaflisp",
        data: encode({
          leaf: {
            logic: {
              type: "leaflisp",
              args: {
                lispexpression: "(parse inport)",
              },
            },
          },
        }),
        out_edges: [
          {
            uuid: "E3",
            source: { uuid: "PARSE_NODE" },
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
    await writeFile(graphPath, `${JSON.stringify(nonscalarRiskFixture, null, 2)}\n`, "utf8");
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
    assert.equal(output.parseSafety, "balanced");
    assert.ok(output.checks.includes("static-contract:leaflisp-raw-parse-inport-nonscalar-risk"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto requires incoming producer edge for outflow node", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  const missingOutflowIncomingFixture = {
    domain: "example",
    appid: "missing-outflow-incoming-fixture",
    nodes: [
      {
        uuid: "IN1",
        leafnodetype: "leafinflowport",
        data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
        out_edges: [],
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
    await writeFile(graphPath, `${JSON.stringify(missingOutflowIncomingFixture, null, 2)}\n`, "utf8");
    const result = await run(["--graph", graphPath, "--out-key", "OUT1", "--diagnose"]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("static-contract:outflow-node-missing-incoming"));
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto treats null output as failure unless allow-null-out is set", async () => {
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
      "export const executeLEAFGraph = async () => ({ OUT1: null });\n",
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");

    const failedResult = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(failedResult.status, 1, failedResult.stderr);
    const failedOutput = JSON.parse(failedResult.stdout);
    assert.equal(failedOutput.pass, false);
    assert.ok(failedOutput.checks.includes("output-null:OUT1"));

    const allowedResult = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
      "--allow-null-out",
    ]);

    assert.equal(allowedResult.status, 0, allowedResult.stderr);
    const allowedOutput = JSON.parse(allowedResult.stdout);
    assert.equal(allowedOutput.pass, true);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto can fail on required DAG contract before smoke", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");
  const requiredPath = join(temporaryDirectory, "required.json");

  try {
    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");
    await writeFile(
      requiredPath,
      `${JSON.stringify(["IN1->MISSING_NODE", "MISSING_NODE->OUT1"], null, 2)}\n`,
      "utf8",
    );

    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--required",
      requiredPath,
      "--diagnose",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("dag-contract-failed"));
    assert.equal(output.dagContract.pass, false);
    assert.equal(output.steps.smoke, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preflight-runtime-dto can run acceptance vectors and fail on semantic mismatch", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".preflight-runtime-dto-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");
  const vectorsPath = join(temporaryDirectory, "vectors.json");

  try {
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      "export const executeLEAFGraph = async (_graph, input) => ({ OUT1: Number(input.IN1 ?? 0) + 2 });\n",
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");
    await writeFile(
      vectorsPath,
      `${JSON.stringify([{ case: 1, input: { IN1: 11 }, expected: { OUT1: 999 } }], null, 2)}\n`,
      "utf8",
    );

    const result = await run([
      "--graph",
      graphPath,
      "--out-key",
      "OUT1",
      "--vectors",
      vectorsPath,
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
      "--diagnose",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pass, false);
    assert.ok(output.checks.includes("acceptance-vectors-failed"));
    assert.equal(output.acceptanceVectors.allPass, false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
