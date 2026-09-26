import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "explain-runtime-error.mjs");

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

test("explain-runtime-error detects known issue signatures from text", async () => {
  const result = await run([
    "--text",
    "failed to decode models response and later OPERATION_ID_NOT_FOUND",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  assert.equal(output.mode, "explain-runtime-error");
  const codes = output.issues.map((entry) => entry.code).sort();
  assert.deepEqual(codes, ["models_manager_decode_warning", "operation_id_not_found"]);
});

test("explain-runtime-error classifies common leaflisp shape mismatch errors", async () => {
  const result = await run([
    "--text",
    "LEAFlisp error: {refnode: REQ_SUB_9}: line: 0 - Type Error! Expected 'Vector', but got 'Number'",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const issueCodes = output.issues.map((entry) => entry.code);
  assert.ok(issueCodes.includes("leaflisp_expected_vector_got_number"));
});

test("explain-runtime-error adds graph diagnostics for malformed runtime DTO", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".explain-runtime-error-test-"));
  const stderrPath = join(temporaryDirectory, "stderr.log");
  const graphPath = join(temporaryDirectory, "graph.json");

  try {
    await writeFile(stderrPath, "Runner timeout while replaying artifact\n", "utf8");
    await writeFile(
      graphPath,
      `${JSON.stringify(
        {
          domain: "example",
          appid: "bad-graph",
          nodes: [
            {
              uuid: "IN1",
              leafnodetype: "leafinflowport",
              data: "not-base64",
              out_edges: [],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await run(["--stderr", stderrPath, "--graph", graphPath]);
    assert.equal(result.status, 0, result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "explain-runtime-error");
    assert.equal(output.graphDiagnostics.pass, false);

    const issueCodes = output.issues.map((entry) => entry.code);
    assert.ok(issueCodes.includes("runtime_timeout"));
    assert.ok(issueCodes.includes("runtime_dto_shape_invalid"));
    assert.ok(issueCodes.includes("malformed_node_payloads"));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
