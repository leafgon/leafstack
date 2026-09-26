import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runScript = join(skillDirectory, "scripts", "run-leaf-graph.mjs");
const ghostosLatest = JSON.parse(
  execFileSync("npm", ["view", "ghostos@latest", "version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);

const run = (args) =>
  new Promise((resolveChild) => {
    const child = spawn(process.execPath, [runScript, ...args], {
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

test("run-leaf-graph executes a local graph fixture through ghostos source override", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".run-leaf-graph-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");
  const inputPath = join(temporaryDirectory, "input.json");

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

    await writeFile(
      graphPath,
      `${JSON.stringify({ domain: "example", appid: "fixture", nodes: [] }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(inputPath, `${JSON.stringify({ IN1: 4 }, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--input",
      inputPath,
      "--refnode",
      "node-target",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ghostosVersion, ghostosLatest);
    assert.equal(output.graphPath, graphPath);
    assert.deepEqual(output.input, { IN1: 4 });
    assert.deepEqual(output.runtimeOptions, {
      domain: "example",
      appid: "fixture",
      refnode: "node-target",
    });
    assert.deepEqual(output.output, {
      domain: "example",
      appid: "fixture",
      refnode: "node-target",
      nodeCount: 0,
      input: { IN1: 4 },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("run-leaf-graph quiet mode suppresses runtime console chatter", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".run-leaf-graph-test-"));
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
      `export const executeLEAFGraph = async () => {
  console.log("runtime-stdout-noise");
  console.error("runtime-stderr-noise");
  return { OUT1: 42 };
};
`,
      "utf8",
    );

    await writeFile(
      graphPath,
      `${JSON.stringify({ domain: "example", appid: "quiet-fixture", nodes: [] }, null, 2)}\n`,
      "utf8",
    );

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
    assert.deepEqual(output.output, { OUT1: 42 });
    assert.equal(result.stderr.includes("runtime-stderr-noise"), false);
    assert.equal(result.stdout.includes("runtime-stdout-noise"), false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
