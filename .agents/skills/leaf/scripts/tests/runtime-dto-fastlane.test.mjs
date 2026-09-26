import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "runtime-dto-fastlane.mjs");
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
  appid: "fastlane-fixture",
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

test("runtime-dto-fastlane returns compact success summary", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".runtime-dto-fastlane-test-"));
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
      `export const executeLEAFGraph = async (_graph, input) => ({ OUT1: Number(input.IN1 ?? 0) + 1 });\n`,
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
      "--quiet",
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "runtime-dto-fastlane");
    assert.equal(output.pass, true);
    assert.equal(output.issueCount, 0);
    assert.equal(output.preflight.steps?.smoke?.output?.OUT1, 12);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("runtime-dto-fastlane returns diagnose summary on runtime failure", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".runtime-dto-fastlane-test-"));
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
      `export const executeLEAFGraph = async () => { throw new Error("LEAFlisp error: {refnode: REQ_HTTP}: line: 0 - Type Error! Expected 'HashMap', but got 'Number'"); };\n`,
      "utf8",
    );

    await writeFile(graphPath, `${JSON.stringify(runtimeFixture, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
      "--quiet",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "runtime-dto-fastlane");
    assert.equal(output.pass, false);
    assert.equal(output.preflight.diagnostics.refnode, "REQ_HTTP");
    const issueCodes = output.preflight.diagnostics.issues.map((entry) => entry.code);
    assert.ok(issueCodes.includes("leaflisp_expected_hashmap_got_number"));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
