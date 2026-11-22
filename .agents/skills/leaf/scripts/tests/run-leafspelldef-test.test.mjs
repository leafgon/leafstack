import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runScript = join(skillDirectory, "scripts", "run-leafspelldef-test.mjs");
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

const encodeNodeData = (payload) => Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

test("run-leafspelldef-test resolves entry spell and generates menu-test payload", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".run-leafspelldef-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");
  const inputPath = join(temporaryDirectory, "input.json");

  const entryRefnode = "9305df15-3888-4314-95fd-85369e9bbf25";
  const targetNodeuuid = "ce36aee2-7e1e-4a84-ba65-6db66e0da0cb";

  try {
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      `export const executeLEAFGraph = async (_graph, input, options = {}) => ({ seenInput: input, seenOptions: options });\n`,
      "utf8",
    );

    const graph = {
      domain: "breezyforest",
      appid: "tests",
      nodes: [
        {
          uuid: entryRefnode,
          leafnodetype: "leafspell",
          data: encodeNodeData({ leaf: { logic: { args: { spellname: "test-hpc-element" } } } }),
          out_edges: [],
        },
      ],
    };

    await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    await writeFile(
      inputPath,
      `${JSON.stringify({ _bname: "intent", _content: { operation: "query" } }, null, 2)}\n`,
      "utf8",
    );

    const result = await run([
      "--graph",
      graphPath,
      "--target-nodeuuid",
      targetNodeuuid,
      "--entry-spellname",
      "test-hpc-element",
      "--input",
      inputPath,
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "leafspelldef-test-harness");
    assert.equal(output.invocation.entryRefnode, entryRefnode);
    assert.equal(output.invocation.targetNodeuuid, targetNodeuuid);
    assert.deepEqual(output.run.output.seenInput, {
      touchevent: { _refnode: targetNodeuuid },
      data: { _bname: "intent", _content: { operation: "query" } },
    });
    assert.deepEqual(output.run.output.seenOptions, {
      domain: "breezyforest",
      appid: "tests",
      refnode: entryRefnode,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("run-leafspelldef-test supports cast-spell variant", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".run-leafspelldef-test-"));
  const fakeGhostosDirectory = join(temporaryDirectory, "ghostos");
  const graphPath = join(temporaryDirectory, "graph.json");
  const inputPath = join(temporaryDirectory, "input.json");

  const entryRefnode = "9305df15-3888-4314-95fd-85369e9bbf25";
  const targetNodeuuid = "ce36aee2-7e1e-4a84-ba65-6db66e0da0cb";

  try {
    await mkdir(join(fakeGhostosDirectory, "src"), { recursive: true });
    await writeFile(
      join(fakeGhostosDirectory, "package.json"),
      `${JSON.stringify({ name: "ghostos", version: ghostosLatest, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(fakeGhostosDirectory, "src", "index.core.js"),
      `export const executeLEAFGraph = async (_graph, input) => ({ seenInput: input });\n`,
      "utf8",
    );

    const graph = {
      domain: "breezyforest",
      appid: "tests",
      nodes: [],
    };

    await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    await writeFile(inputPath, `${JSON.stringify({ hello: "world" }, null, 2)}\n`, "utf8");

    const result = await run([
      "--graph",
      graphPath,
      "--target-nodeuuid",
      targetNodeuuid,
      "--entry-refnode",
      entryRefnode,
      "--variant",
      "cast-spell",
      "--input",
      inputPath,
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.run.output.seenInput, {
      _bname: "cast-spell",
      _content: {
        nodeuuid: targetNodeuuid,
        input: { hello: "world" },
      },
      _label: {},
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

