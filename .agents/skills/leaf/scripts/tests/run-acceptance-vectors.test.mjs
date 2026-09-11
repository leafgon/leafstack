import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(skillDirectory, "scripts", "run-acceptance-vectors.mjs");
const ghostosLatest = JSON.parse(
  execFileSync("npm", ["view", "ghostos@latest", "version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);

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

test("run-acceptance-vectors executes case vectors against GhostOS runtime", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".acceptance-vectors-test-"));
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
      `export const executeLEAFGraph = async (_graph, input, options = {}) => {
  if (options.refnode === 'OUT1') {
    return Number(input.IN1 ?? 0) + Number(input.IN2 ?? 0);
  }
  return 0;
};
`,
      "utf8",
    );

    await writeFile(
      graphPath,
      `${JSON.stringify({ domain: "example", appid: "vectors-sample", nodes: [] }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      vectorsPath,
      `${JSON.stringify(
        {
          refnode: "OUT1",
          cases: [
            { case: 1, input: { IN1: 4, IN2: 9 }, expected: { OUT1: 13 } },
            { case: 2, input: { IN1: 10, IN2: 1 }, expected: { OUT1: 11 } },
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
      "--vectors",
      vectorsPath,
      "--ghostos-dir",
      fakeGhostosDirectory,
      "--version",
      ghostosLatest,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "acceptance-vectors");
    assert.equal(output.ghostosVersion, ghostosLatest);
    assert.equal(output.allPass, true);
    assert.deepEqual(
      output.results.map((entry) => entry.pass),
      [true, true],
    );
    assert.deepEqual(output.results[0].actual, { OUT1: 13 });
    assert.deepEqual(output.results[1].actual, { OUT1: 11 });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
