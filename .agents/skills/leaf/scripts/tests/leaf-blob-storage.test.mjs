import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const script = path.resolve(import.meta.dirname, "../leaf-blob-storage.mjs");
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64");

test("store resolves a blob spelldef, writes once, and verifies metadata", async t => {
  const definitionId = "11111111-1111-4111-8111-111111111111";
  const blobId = "22222222-2222-4222-8222-222222222222";
  const edgeId = "33333333-3333-4333-8333-333333333333";
  let stored;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    const json = (status, value, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(value));
    };
    if (request.method === "POST" && request.url === "/qmgraphql") {
      assert.match(body.query, /domain: "testdomain"/);
      return json(200, { data: { graph: { domain: "testdomain", appid: "testapp", nodes: [
        { uuid: definitionId, leafnodetype: "leafspelldef", data: encode({ leaf: { logic: { type: "leafspelldef", args: { spellname: "storage" } } } }), out_edges: [] },
        { uuid: blobId, leafnodetype: "leafelement", data: encode({ leaf: { logic: { type: "leafelement", args: { elementname: "blob" } } } }), out_edges: [
          { uuid: edgeId, source: { uuid: blobId }, target: { uuid: definitionId }, data: encode({ leaf: { logic: { type: "leaflambdaedge" } } }) },
        ] },
      ] } } });
    }
    if (request.method === "HEAD" && request.url?.startsWith("/api/v1/blob-storage/objects/")) {
      response.writeHead(404); return response.end();
    }
    if (request.method === "POST" && request.url === "/api/v1/runtime-file-refs") {
      assert.equal(body.schemaVersion, "leafgon.runtime_file_ref_create.v1");
      assert.equal(body.blobElementId, blobId);
      assert.ok(body.payloadBase64);
      return json(201, { schemaVersion: "leafgon.runtime_file_ref.v1", kind: "runtime-file-ref", ref: "test-runtime-ref", expiresAt: "2099-01-01T00:00:00Z" });
    }
    if (request.method === "POST" && request.url === "/api/v1/blob-storage/runtime-file-refs/test-runtime-ref:resolve") {
      assert.equal(body.blobElementId, blobId);
      return json(200, { payloadRef: { kind: "temp-file", ref: "test-temp-file" }, contentType: "image/jpeg",
        contentLength: 17, contentHash: body.contentHash });
    }
    if (request.method === "PUT" && request.url?.startsWith("/api/v1/blob-storage/objects/")) {
      assert.match(request.headers["idempotency-key"], /^leaf-blob-[0-9a-f]{40}$/);
      assert.deepEqual(body.payloadRef, { kind: "temp-file", ref: "test-temp-file" });
      assert.equal(body.description, "Test graph image");
      const objectId = request.url.split("/").at(-1);
      stored = { schemaVersion: "ghostos.blob_data_file.v1", blobElementId: blobId, objectId,
        contentType: body.contentType, contentLength: body.contentLength, contentHash: body.contentHash,
        description: body.description, assetRevision: 1, lastModifiedAt: "2026-01-01T00:00:00Z" };
      return json(201, stored);
    }
    if (request.method === "GET" && request.url?.startsWith("/api/v1/blob-storage/objects/")) return json(200, stored);
    if (request.method === "POST" && request.url?.endsWith(":list")) {
      assert.equal(body.schemaVersion, "ghostos.blob_list_bottle.v1");
      assert.deepEqual(body.objectIds, [stored.objectId]);
      return json(200, { schemaVersion: "ghostos.blob_list_file.v1", items: [
        { ...stored, objectMetadata: { description: stored.description } },
      ] });
    }
    json(404, {});
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), "leaf-blob-test-"));
  const file = path.join(directory, "graph.jpg");
  await writeFile(file, Buffer.from("jpeg-test-payload"));
  const { stdout } = await execFileAsync(process.execPath, [script, "store", "--domain", "testdomain",
    "--appid", "testapp", "--spelldef", "storage", "--file", file, "--token-env", "TEST_LEAF_TOKEN",
    "--description", "Test graph image",
    "--endpoint", `http://127.0.0.1:${server.address().port}`], { env: { ...process.env, TEST_LEAF_TOKEN: "test-token" } });
  const result = JSON.parse(stdout);
  assert.equal(result.wrote, true);
  assert.equal(result.verified, true);
  assert.equal(result.blobElementId, blobId);
  assert.equal(result.assetRevision, 1);
  assert.equal(result.description, "Test graph image");
});

test("store rejects a missing description before making requests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "leaf-blob-description-test-"));
  const file = path.join(directory, "graph.jpg");
  await writeFile(file, Buffer.from("jpeg-test-payload"));
  await assert.rejects(execFileAsync(process.execPath, [script, "store", "--domain", "testdomain",
    "--appid", "testapp", "--spelldef", "storage", "--file", file, "--dry-run"]),
  /--description is required/);
});
