import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "run-runtime-dto-smoke.mjs");
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

test("run-runtime-dto-smoke delegates to run-leaf-graph execution", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".runtime-dto-smoke-test-"));
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

    await writeFile(
      graphPath,
      `${JSON.stringify(
        {
          domain: "example",
          appid: "runtime-smoke",
          nodes: [
            {
              uuid: "IN1",
              leafnodetype: "leafinflowport",
              data: encode({ leaf: { logic: { type: "leafinflowport", args: {} } } }),
              out_edges: [],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await run([
      "--graph",
      graphPath,
      "--in1",
      "11",
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "runtime-dto-smoke");
    assert.equal(output.input.IN1, 11);
    assert.equal(output.ghostosVersion, ghostosLatest);
    assert.deepEqual(output.output, { OUT1: 13 });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
