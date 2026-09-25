import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "runtime-dto-kit.mjs");

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

test("runtime-dto-kit scaffolds and validates runtime DTO with --skip-smoke", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".runtime-dto-kit-test-"));
  const graphPath = join(temporaryDirectory, "graph.json");

  try {
    const result = await run([
      "--out",
      graphPath,
      "--domain",
      "example",
      "--appid",
      "kit-smoke",
      "--operation",
      "multiply",
      "--constant",
      "3",
      "--skip-smoke",
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);

    assert.equal(output.mode, "runtime-dto-kit");
    assert.equal(output.pass, true);
    assert.equal(output.steps.validation.pass, true);
    assert.equal(output.steps.smoke, null);
    assert.equal(output.steps.scaffold.out, graphPath);

    await access(graphPath, constants.R_OK);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
