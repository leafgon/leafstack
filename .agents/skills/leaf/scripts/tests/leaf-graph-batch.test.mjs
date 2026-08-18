import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const batchScript = join(skillDirectory, "scripts", "leaf-graph-batch.mjs");
const encode = (value) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const run = (args, env) =>
  new Promise((resolveChild) => {
    const child = spawn(process.execPath, args, { env });
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

test("remote update falls back to an authoritative re-query when its payload is null", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".batch-test-"));
  const originalData = encode({
    leaf: {
      logic: { type: "leaflabel", args: { labelstr: "node-a" } },
      appdata: { position: { x: 0, y: 0 } },
    },
  });
  const updatedData = encode({
    leaf: {
      logic: { type: "leaflabel", args: { labelstr: "node-a" } },
      appdata: { position: { x: 100, y: 200 } },
    },
  });
  const graph = {
    domain: "example",
    appid: "batch",
    nodes: [
      {
        uuid: "node-a",
        leafnodetype: "leaflabel",
        data: originalData,
        out_edges: [],
      },
    ],
  };
  let queryCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      if (payload.query.includes("getGraph")) {
        queryCount += 1;
        response.end(JSON.stringify({ data: { graph } }));
        return;
      }
      graph.nodes[0].data = payload.variables.data;
      response.end(JSON.stringify({ data: { updateNode: null } }));
    });
  });

  try {
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/qmgraphql`;
    const manifest = {
      format: "leaf.graph-batch.v1",
      graphs: [{ domain: "example", appid: "batch", file: "graph.json" }],
      operations: [
        {
          op: "updateNode",
          domain: "example",
          appid: "batch",
          uuid: "node-a",
          set: { data: updatedData },
        },
      ],
    };
    const rawManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = join(temporaryDirectory, "batch.json");
    await writeFile(manifestPath, rawManifest, "utf8");
    const confirmation = `sha256:${createHash("sha256")
      .update(rawManifest)
      .digest("hex")}`;

    const result = await run(
      [
        batchScript,
        manifestPath,
        "--apply",
        "--confirm",
        confirmation,
        "--endpoint",
        endpoint,
        "--confirm-endpoint",
        endpoint,
        "--token-env",
        "LEAF_TEST_TOKEN",
      ],
      { ...process.env, LEAF_TEST_TOKEN: "test-token" },
    );

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.verified, true);
    assert.equal(
      output.acknowledgements[0].acknowledgement,
      "authoritative-requery",
    );
    assert.equal(graph.nodes[0].data, updatedData);
    assert.equal(queryCount, 3);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("remote resume skips an exact node and re-queries a null add acknowledgement", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".batch-test-"));
  const nodeData = (label) =>
    encode({
      leaf: {
        logic: { type: "leaflabel", args: { labelstr: label } },
        appdata: { position: { x: 0, y: 0 } },
      },
    });
  const existingNode = {
    uuid: "node-existing",
    leafnodetype: "leaflabel",
    data: nodeData("existing"),
    out_edges: [],
  };
  const addedNode = {
    uuid: "node-added",
    leafnodetype: "leaflisp",
    data: encode({
      leaf: {
        object: null,
        logic: { type: "leaflisp", args: { lispexpression: "(return 1)" } },
        appdata: { position: { x: 0, y: 0 } },
      },
    }),
    out_edges: [],
  };
  const graph = {
    domain: "example",
    appid: "resume",
    nodes: [existingNode],
  };
  let mutationCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      if (payload.query.includes("getGraph")) {
        response.end(JSON.stringify({ data: { graph } }));
        return;
      }
      mutationCount += 1;
      const materialized = JSON.parse(
        Buffer.from(addedNode.data, "base64").toString("utf8"),
      );
      materialized.leaf.object = { value: 1 };
      graph.nodes.push({
        ...addedNode,
        data: encode(materialized),
      });
      response.end(
        JSON.stringify({ data: { addNode: { node: null, numUids: null } } }),
      );
    });
  });

  try {
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/qmgraphql`;
    const manifest = {
      format: "leaf.graph-batch.v1",
      graphs: [{ domain: "example", appid: "resume", file: "graph.json" }],
      operations: [
        { op: "addNode", domain: "example", appid: "resume", node: existingNode },
        { op: "addNode", domain: "example", appid: "resume", node: addedNode },
      ],
    };
    const rawManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = join(temporaryDirectory, "batch.json");
    await writeFile(manifestPath, rawManifest, "utf8");
    const confirmation = `sha256:${createHash("sha256")
      .update(rawManifest)
      .digest("hex")}`;

    const result = await run(
      [
        batchScript,
        manifestPath,
        "--apply",
        "--resume",
        "--confirm",
        confirmation,
        "--endpoint",
        endpoint,
        "--confirm-endpoint",
        endpoint,
        "--token-env",
        "LEAF_TEST_TOKEN",
      ],
      { ...process.env, LEAF_TEST_TOKEN: "test-token" },
    );

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.verified, true);
    assert.deepEqual(
      output.acknowledgements.map(({ acknowledgement }) => acknowledgement),
      ["authoritative-preexisting", "authoritative-requery"],
    );
    assert.equal(mutationCount, 1);
    assert.deepEqual(graph.nodes.map(({ uuid }) => uuid), ["node-existing", "node-added"]);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("remote deletes accept null payloads only after authoritative absence", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".batch-test-"));
  const graph = {
    domain: "example",
    appid: "delete",
    nodes: [
      {
        uuid: "node-a",
        leafnodetype: "leaflabel",
        data: encode({ leaf: { logic: { type: "leaflabel", args: {} }, appdata: {} } }),
        out_edges: [
          {
            uuid: "edge-a-b",
            source: { uuid: "node-a" },
            target: { uuid: "node-b" },
            data: encode({ leaf: { logic: { type: "leafdataedge" } } }),
          },
        ],
      },
      {
        uuid: "node-b",
        leafnodetype: "leaflabel",
        data: encode({ leaf: { logic: { type: "leaflabel", args: {} }, appdata: {} } }),
        out_edges: [],
      },
    ],
  };
  let mutationCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      if (payload.query.includes("getGraph")) {
        response.end(JSON.stringify({ data: { graph } }));
        return;
      }
      mutationCount += 1;
      if (payload.query.includes("DeleteEdge")) graph.nodes[0].out_edges = [];
      if (payload.query.includes("DeleteNode")) graph.nodes = graph.nodes.filter(({ uuid }) => uuid !== payload.variables.uuid);
      response.end(JSON.stringify({ data: { [payload.query.includes("DeleteEdge") ? "deleteEdge" : "deleteNode"]: null } }));
    });
  });

  try {
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/qmgraphql`;
    const manifest = {
      format: "leaf.graph-batch.v1",
      graphs: [{ domain: "example", appid: "delete", file: "graph.json" }],
      operations: [
        { op: "deleteEdge", domain: "example", appid: "delete", uuid: "edge-a-b" },
        { op: "deleteNode", domain: "example", appid: "delete", uuid: "node-b" },
      ],
    };
    const rawManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = join(temporaryDirectory, "batch.json");
    await writeFile(manifestPath, rawManifest, "utf8");
    const confirmation = `sha256:${createHash("sha256").update(rawManifest).digest("hex")}`;

    const result = await run(
      [batchScript, manifestPath, "--apply", "--confirm", confirmation, "--endpoint", endpoint, "--confirm-endpoint", endpoint, "--token-env", "LEAF_TEST_TOKEN"],
      { ...process.env, LEAF_TEST_TOKEN: "test-token" },
    );

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.verified, true);
    assert.deepEqual(output.acknowledgements.map(({ acknowledgement }) => acknowledgement), ["authoritative-requery", "authoritative-requery"]);
    assert.equal(mutationCount, 2);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("remote resume skips already absent deletes", async () => {
  const temporaryDirectory = await mkdtemp(join(skillDirectory, ".batch-test-"));
  const graph = { domain: "example", appid: "resume-delete", nodes: [] };
  let mutationCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      if (payload.query.includes("getGraph")) response.end(JSON.stringify({ data: { graph } }));
      else {
        mutationCount += 1;
        response.end(JSON.stringify({ data: {} }));
      }
    });
  });

  try {
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/qmgraphql`;
    const manifest = {
      format: "leaf.graph-batch.v1",
      graphs: [{ domain: "example", appid: "resume-delete", file: "graph.json" }],
      operations: [
        { op: "deleteEdge", domain: "example", appid: "resume-delete", uuid: "edge-missing" },
        { op: "deleteNode", domain: "example", appid: "resume-delete", uuid: "node-missing" },
      ],
    };
    const rawManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = join(temporaryDirectory, "batch.json");
    await writeFile(manifestPath, rawManifest, "utf8");
    const confirmation = `sha256:${createHash("sha256").update(rawManifest).digest("hex")}`;

    const result = await run(
      [batchScript, manifestPath, "--apply", "--resume", "--confirm", confirmation, "--endpoint", endpoint, "--confirm-endpoint", endpoint, "--token-env", "LEAF_TEST_TOKEN"],
      { ...process.env, LEAF_TEST_TOKEN: "test-token" },
    );

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.verified, true);
    assert.deepEqual(output.acknowledgements.map(({ acknowledgement }) => acknowledgement), ["authoritative-preexisting", "authoritative-preexisting"]);
    assert.equal(mutationCount, 0);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
