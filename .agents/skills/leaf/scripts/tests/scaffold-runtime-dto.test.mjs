import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scaffoldScript = join(skillDirectory, "scripts", "scaffold-runtime-dto.mjs");
const validateScript = join(skillDirectory, "scripts", "validate-runtime-dto.mjs");

const runScript = (scriptPath, args) =>
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

test("scaffold-runtime-dto emits a valid runtime DTO template", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".scaffold-runtime-dto-test-"));
  const outputPath = join(temporaryDirectory, "runtime-dto.json");

  try {
    const scaffoldResult = await runScript(scaffoldScript, [
      "--out",
      outputPath,
      "--domain",
      "sample-domain",
      "--appid",
      "sample-app",
      "--operation",
      "multiply",
      "--constant",
      "3",
      "--operation-id",
      "op-99",
    ]);

    assert.equal(scaffoldResult.status, 0, scaffoldResult.stderr);
    const scaffoldOutput = JSON.parse(scaffoldResult.stdout);
    assert.equal(scaffoldOutput.mode, "scaffold-runtime-dto");
    assert.equal(scaffoldOutput.nodeCount, 5);
    assert.equal(scaffoldOutput.edgeCount, 4);

    const validateResult = await runScript(validateScript, ["--graph", outputPath]);
    assert.equal(validateResult.status, 0, validateResult.stderr);
    const validateOutput = JSON.parse(validateResult.stdout);
    assert.equal(validateOutput.pass, true);

    const graph = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(graph.domain, "sample-domain");
    assert.equal(graph.appid, "sample-app");
    assert.equal(graph.nodes[2].leafnodetype, "leafelement");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
