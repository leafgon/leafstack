#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const usage = () => console.error(`usage: leaf-blob-storage.mjs store --domain <id> --appid <id> --spelldef <name> --file <path> --description <text> [options]

options:
  --token-env <name>     bearer-token environment variable (default LEAFGON_API_TOKEN)
  --endpoint <origin>    leaf-server origin (default https://www.leafgon.com)
  --content-type <type>  override extension-based media type
  --dry-run              resolve and compute identity without writing`);

const args = process.argv.slice(2);
const command = args.shift();
const options = { tokenEnv: "LEAFGON_API_TOKEN", endpoint: "https://www.leafgon.com", dryRun: false };
const valueOptions = new Map([
  ["--domain", "domain"], ["--appid", "appid"], ["--spelldef", "spelldef"],
  ["--file", "file"], ["--token-env", "tokenEnv"], ["--endpoint", "endpoint"],
  ["--content-type", "contentType"], ["--description", "description"],
]);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--dry-run") { options.dryRun = true; continue; }
  const key = valueOptions.get(argument);
  if (!key || index + 1 >= args.length) { usage(); throw new Error(`invalid argument: ${argument}`); }
  options[key] = args[index + 1];
  index += 1;
}
if (command !== "store") { usage(); throw new Error("only the store command is supported"); }

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
if (!identifier.test(options.domain ?? "")) throw new Error("invalid --domain");
if (!identifier.test(options.appid ?? "")) throw new Error("invalid --appid");
if (!options.spelldef || options.spelldef.length > 128 || /[\u0000-\u001f\u007f]/.test(options.spelldef)) throw new Error("invalid --spelldef");
if (!options.file) throw new Error("--file is required");
if (typeof options.description !== "string" || options.description.trim().length === 0 ||
    options.description.length > 512 || /[\u0000-\u001f\u007f]/.test(options.description)) {
  throw new Error("--description is required and must be 1 to 512 printable characters");
}
options.description = options.description.trim();
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.tokenEnv)) throw new Error("invalid --token-env");
const endpoint = new URL(options.endpoint);
if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost") {
  throw new Error("--endpoint must use HTTPS except for loopback testing");
}
endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
const apiUrl = pathname => new URL(`/${pathname.replace(/^\/+/, "")}`, endpoint);

const contentTypes = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".html", "text/html"],
  [".txt", "text/plain"], [".css", "text/css"], [".js", "text/javascript"],
  [".json", "application/json"], [".pdf", "application/pdf"], [".woff2", "font/woff2"],
]);
const allowedContentTypes = new Set(contentTypes.values());
const filePath = path.resolve(options.file);
const fileInfo = await stat(filePath);
if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > 10 * 1024 * 1024) throw new Error("file must be 1 byte to 10 MiB");
const fileName = path.basename(filePath);
if (!/^[A-Za-z0-9._~-]+$/.test(fileName)) throw new Error("file name must be one safe path segment");
const contentType = (options.contentType ?? contentTypes.get(path.extname(fileName).toLowerCase()))?.toLowerCase();
if (!allowedContentTypes.has(contentType)) throw new Error("unsupported content type");

const token = process.env[options.tokenEnv];
if (!options.dryRun && !token) throw new Error(`${options.tokenEnv} is missing`);
const request = async (url, init = {}) => fetch(url, {
  ...init,
  headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});
const graphQuery = `query {
  graph: getGraph(domain: "${options.domain}", appid: "${options.appid}", filter: {}) {
    domain appid nodes { uuid leafnodetype data out_edges { uuid source { uuid } target { uuid } data } }
  }
}`;
const graphResponse = await request(apiUrl("qmgraphql"), {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: graphQuery }),
});
if (!graphResponse.ok) throw new Error(`graph read failed with HTTP ${graphResponse.status}`);
const envelope = await graphResponse.json();
if (envelope.error || envelope.errors) throw new Error("graph read returned errors");
const graph = envelope.data?.graph;
if (graph?.domain !== options.domain || graph?.appid !== options.appid || !Array.isArray(graph.nodes)) throw new Error("graph read returned an unexpected graph");
const decode = (encoded, label) => {
  try { return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); }
  catch (error) { throw new Error(`${label} has invalid encoded data: ${error.message}`); }
};
const nodes = new Map(graph.nodes.map(node => [node.uuid, { ...node, decoded: decode(node.data, `node ${node.uuid}`) }]));
const edges = graph.nodes.flatMap(node => (node.out_edges ?? []).map(edge => ({ ...edge, type: decode(edge.data, `edge ${edge.uuid}`)?.leaf?.logic?.type })));
const definitions = [...nodes.values()].filter(node => node.leafnodetype === "leafspelldef" && node.decoded?.leaf?.logic?.args?.spellname === options.spelldef);
if (definitions.length !== 1) throw new Error(`expected one spelldef named ${JSON.stringify(options.spelldef)}, found ${definitions.length}`);
const selected = new Set([definitions[0].uuid]);
let changed = true;
while (changed) {
  changed = false;
  for (const edge of edges) {
    const source = edge.source?.uuid;
    const target = edge.target?.uuid;
    const additions = edge.type === "leafdataedge" && (selected.has(source) || selected.has(target))
      ? [source, target]
      : edge.type === "leaflambdaedge" && selected.has(target) ? [source] : [];
    for (const uuid of additions) if (nodes.has(uuid) && !selected.has(uuid)) { selected.add(uuid); changed = true; }
  }
}
const blobNodes = [...selected].map(uuid => nodes.get(uuid)).filter(node =>
  node.leafnodetype === "leafelement" &&
  (node.decoded?.leaf?.logic?.args?.elementname === "blob" || node.decoded?.elementname === "blob"));
if (blobNodes.length !== 1) throw new Error(`expected one blob element in spelldef scope, found ${blobNodes.length}`);
const blobElementId = blobNodes[0].uuid;

const bytes = await readFile(filePath);
const digest = createHash("sha256").update(bytes).digest("hex");
const contentHash = `sha256:${digest}`;
const identityMaterial = `${contentHash}\n${contentType}\n${bytes.length}`;
const identityDigest = createHash("sha256").update(identityMaterial).digest();
const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
let bits = 0, value = 0, encoded = "";
for (const byte of identityDigest) {
  value = (value << 8) | byte; bits += 8;
  while (bits >= 5) { encoded += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
}
if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31];
const objectId = encoded.slice(0, 32);
const objectCollectionUrl = apiUrl(`api/v1/blob-storage/objects/${encodeURIComponent(options.domain)}/${encodeURIComponent(options.appid)}/${encodeURIComponent(blobElementId)}`);
const objectUrl = new URL(`${objectCollectionUrl.pathname}/${encodeURIComponent(objectId)}`, objectCollectionUrl);
const safeBase = { graph: `${options.domain}/${options.appid}`, spelldef: options.spelldef, blobElementId, objectId, contentType, contentLength: bytes.length, contentHash, description: options.description };
if (options.dryRun) { console.log(JSON.stringify({ ...safeBase, dryRun: true }, null, 2)); process.exit(0); }

const verifyDescriptionEnrichment = async () => {
  const response = await request(new URL(`${objectCollectionUrl.pathname}:list`, objectCollectionUrl), {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ schemaVersion: "ghostos.blob_list_bottle.v1", objectIds: [objectId],
      correlationId: randomUUID() }),
  });
  if (!response.ok) throw new Error(`blob description enrichment verification failed with HTTP ${response.status}`);
  const result = await response.json();
  const item = Array.isArray(result?.items) ? result.items.find(candidate => candidate?.objectId === objectId) : undefined;
  if (result?.schemaVersion !== "ghostos.blob_list_file.v1" ||
      item?.objectMetadata?.description !== options.description) {
    throw new Error("blob objectMetadata.description verification mismatch");
  }
};

const head = await request(objectUrl, { method: "HEAD" });
if (head.ok) {
  const existingResponse = await request(objectUrl);
  if (!existingResponse.ok) throw new Error(`blob metadata verification failed with HTTP ${existingResponse.status}`);
  const existingMetadata = await existingResponse.json();
  const existing = {
    contentType: head.headers.get("x-blob-content-type"),
    contentLength: Number(head.headers.get("x-blob-content-length")),
    contentHash: head.headers.get("x-blob-content-hash"),
    assetRevision: Number(head.headers.get("x-blob-asset-revision")),
    description: existingMetadata?.description,
  };
  if (existing.contentType !== contentType || existing.contentLength !== bytes.length || existing.contentHash !== contentHash ||
      existing.description !== options.description || !Number.isSafeInteger(existing.assetRevision)) {
    throw new Error("deterministic object ID exists with mismatched metadata");
  }
  await verifyDescriptionEnrichment();
  console.log(JSON.stringify({ ...safeBase, assetRevision: existing.assetRevision, wrote: false, verified: true }, null, 2));
  process.exit(0);
}
if (head.status !== 404) throw new Error(`blob preflight failed with HTTP ${head.status}`);

const correlationId = randomUUID();
const runtimeRefResponse = await request(apiUrl("api/v1/runtime-file-refs"), {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ schemaVersion: "leafgon.runtime_file_ref_create.v1", graphDomainId: options.domain,
    graphAppId: options.appid, blobElementId, fileName, contentType, contentLength: bytes.length,
    contentHash, correlationId, payloadBase64: bytes.toString("base64") }),
});
if (runtimeRefResponse.status !== 201) throw new Error(`runtime file ref creation failed with HTTP ${runtimeRefResponse.status}`);
const runtimeRef = await runtimeRefResponse.json();
if (runtimeRef?.schemaVersion !== "leafgon.runtime_file_ref.v1" || runtimeRef?.kind !== "runtime-file-ref" || typeof runtimeRef.ref !== "string") {
  throw new Error("runtime file ref response is invalid");
}
const resolveResponse = await request(apiUrl(`api/v1/blob-storage/runtime-file-refs/${encodeURIComponent(runtimeRef.ref)}:resolve`), {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ graphDomainId: options.domain, graphAppId: options.appid, blobElementId,
    contentHash, correlationId }),
});
if (!resolveResponse.ok) throw new Error(`runtime file ref resolution failed with HTTP ${resolveResponse.status}`);
const resolved = await resolveResponse.json();
if (resolved?.payloadRef?.kind !== "temp-file" || typeof resolved.payloadRef.ref !== "string" ||
    resolved.contentType !== contentType || resolved.contentLength !== bytes.length || resolved.contentHash !== contentHash) {
  throw new Error("runtime file ref resolution response is invalid");
}
const idempotencyKey = `leaf-blob-${digest.slice(0, 40)}`;
const put = await request(objectUrl, {
  method: "PUT", headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
  body: JSON.stringify({ contentType, contentLength: bytes.length, contentHash,
    payloadRef: resolved.payloadRef, operation: "create",
    description: options.description, correlationId }),
});
if (!put.ok) throw new Error(`blob store failed with HTTP ${put.status}`);
const acknowledgement = await put.json();
if (acknowledgement?.schemaVersion !== "ghostos.blob_data_file.v1") throw new Error("blob store returned an invalid acknowledgement");

const verifyResponse = await request(objectUrl);
if (!verifyResponse.ok) throw new Error(`blob verification failed with HTTP ${verifyResponse.status}`);
const verified = await verifyResponse.json();
if (verified?.objectId !== objectId || verified?.blobElementId !== blobElementId || verified?.contentType !== contentType ||
    verified?.contentLength !== bytes.length || verified?.contentHash !== contentHash ||
    verified?.description !== options.description || !Number.isSafeInteger(verified?.assetRevision)) {
  throw new Error("blob verification metadata mismatch");
}
await verifyDescriptionEnrichment();
console.log(JSON.stringify({ ...safeBase, assetRevision: verified.assetRevision, lastModifiedAt: verified.lastModifiedAt, wrote: true, verified: true }, null, 2));
