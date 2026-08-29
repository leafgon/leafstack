#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const usage = () => {
  console.error(`usage: capture-leaf-editor.mjs --domain <id> --appid <id> --output <file.jpg>

options:
  --spelldef <name> capture only this spelldef and its attached dataflow graph
  --main            capture the one unanchored, non-spelldef main graph
  --wait-ms <ms>    real-time render wait (default 30000)
  --width <px>      viewport width (default 1920)
  --height <px>     viewport height (default 1080)
  --chrome <path>   Chrome executable path`);
};

const options = {
  waitMs: 30_000,
  width: 1920,
  height: 1080,
};

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const value = args[index + 1];
  switch (args[index]) {
    case "--domain": options.domain = value; index += 1; break;
    case "--appid": options.appid = value; index += 1; break;
    case "--output": options.output = value; index += 1; break;
    case "--spelldef": options.spelldef = value; index += 1; break;
    case "--main": options.main = true; break;
    case "--wait-ms": options.waitMs = Number(value); index += 1; break;
    case "--width": options.width = Number(value); index += 1; break;
    case "--height": options.height = Number(value); index += 1; break;
    case "--chrome": options.chrome = value; index += 1; break;
    case "--help": usage(); process.exit(0);
    default: throw new Error(`unknown or incomplete argument: ${args[index]}`);
  }
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
if (!identifierPattern.test(options.domain ?? "")) throw new Error("invalid --domain");
if (!identifierPattern.test(options.appid ?? "")) throw new Error("invalid --appid");
if (options.spelldef !== undefined && (options.spelldef.length === 0 || options.spelldef.length > 128 || /[\u0000-\u001f\u007f]/.test(options.spelldef))) {
  throw new Error("invalid --spelldef");
}
if (options.main && options.spelldef !== undefined) throw new Error("--main and --spelldef are mutually exclusive");
if (!options.output || !/\.jpe?g$/i.test(options.output)) throw new Error("--output must end in .jpg or .jpeg");
for (const key of ["waitMs", "width", "height"]) {
  if (!Number.isInteger(options[key]) || options[key] <= 0) throw new Error(`--${key} must be a positive integer`);
}
if (options.waitMs > 120_000) throw new Error("--wait-ms cannot exceed 120000");

const chromeCandidates = [
  options.chrome,
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const executable = async candidate => {
  try {
    const { access } = await import("node:fs/promises");
    await access(candidate);
    return true;
  } catch {
    return false;
  }
};

let chrome;
for (const candidate of chromeCandidates) {
  if (await executable(candidate)) { chrome = candidate; break; }
}
if (!chrome) throw new Error("Chrome executable not found; pass --chrome or set CHROME_PATH");

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(error => error ? reject(error) : resolve(port));
  });
});

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const decodeData = (encoded, label) => {
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (error) {
    throw new Error(`${label} has invalid encoded data: ${error.message}`);
  }
};

const readCaptureSelection = async () => {
  if (options.spelldef === undefined && !options.main) return undefined;
  const query = `query {
    graph: getGraph(domain: "${options.domain}", appid: "${options.appid}", filter: {}) {
      domain appid
      nodes {
        uuid leafnodetype data
        out_edges { uuid source { uuid } target { uuid } data }
      }
    }
  }`;
  const response = await fetch("https://www.leafgon.com/qmgraphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`public graph read failed with HTTP ${response.status}`);
  const envelope = await response.json();
  if (envelope.error || envelope.errors) throw new Error("public graph read returned GraphQL errors");
  const graph = envelope.data?.graph;
  if (graph?.domain !== options.domain || graph?.appid !== options.appid || !Array.isArray(graph.nodes)) {
    throw new Error("public graph read returned an unexpected graph");
  }

  const nodes = new Map(graph.nodes.map(node => [node.uuid, {
    ...node,
    decoded: decodeData(node.data, `node ${node.uuid}`),
  }]));
  const edges = graph.nodes.flatMap(node => (node.out_edges ?? []).map(edge => ({
    ...edge,
    type: decodeData(edge.data, `edge ${edge.uuid}`)?.leaf?.logic?.type,
  })));
  const connectedSet = (seeds, allowedTypes, allowedNodes = new Set(nodes.keys())) => {
    const selected = new Set([...seeds].filter(uuid => allowedNodes.has(uuid)));
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges.filter(candidate => allowedTypes.has(candidate.type))) {
        const source = edge.source?.uuid;
        const target = edge.target?.uuid;
        if (!selected.has(source) && !selected.has(target)) continue;
        for (const uuid of [source, target]) {
          if (allowedNodes.has(uuid) && !selected.has(uuid)) { selected.add(uuid); changed = true; }
        }
      }
    }
    return selected;
  };
  const edgeIdsWithin = selected => edges
    .filter(edge => selected.has(edge.source?.uuid) && selected.has(edge.target?.uuid))
    .map(edge => edge.uuid);
  const scopedUpstream = seeds => {
    const selected = new Set(seeds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        const source = edge.source?.uuid;
        const target = edge.target?.uuid;
        const additions = edge.type === "leafdataedge" && (selected.has(source) || selected.has(target))
          ? [source, target]
          : edge.type === "leaflambdaedge" && selected.has(target)
            ? [source]
            : [];
        for (const uuid of additions) {
          if (nodes.has(uuid) && !selected.has(uuid)) { selected.add(uuid); changed = true; }
        }
      }
    }
    return selected;
  };

  if (options.spelldef !== undefined) {
    const matches = [...nodes.values()].filter(node =>
      node.leafnodetype === "leafspelldef" &&
      node.decoded?.leaf?.logic?.args?.spellname === options.spelldef);
    if (matches.length !== 1) {
      throw new Error(`expected one spelldef named ${JSON.stringify(options.spelldef)}, found ${matches.length}`);
    }
    const definition = matches[0];
    const lambdaSources = edges
      .filter(edge => edge.type === "leaflambdaedge" && edge.target?.uuid === definition.uuid)
      .map(edge => edge.source?.uuid)
      .filter(source => nodes.has(source));
    const selected = scopedUpstream([definition.uuid]);
    return {
      mode: "spelldef",
      name: options.spelldef,
      nodeIds: [...selected],
      edgeIds: edgeIdsWithin(selected),
      lambdaSourceCount: lambdaSources.length,
    };
  }

  const definitionIds = new Set([...nodes.values()]
    .filter(node => node.leafnodetype === "leafspelldef")
    .map(node => node.uuid));
  const excluded = scopedUpstream([...definitionIds]);

  const anchorEdges = edges.filter(edge => edge.type === "leafanchoredge");
  const anchored = connectedSet(
    anchorEdges.map(edge => edge.target?.uuid),
    new Set(["leafdataedge", "leaflambdaedge"]),
  );
  for (const uuid of anchored) excluded.add(uuid);
  for (const edge of anchorEdges) excluded.add(edge.source?.uuid);

  const remaining = new Set([...nodes.keys()].filter(uuid => !excluded.has(uuid)));
  const components = [];
  const unvisited = new Set(remaining);
  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value;
    const component = connectedSet([seed], new Set(["leafdataedge", "leaflambdaedge"]), remaining);
    components.push(component);
    for (const uuid of component) unvisited.delete(uuid);
  }
  if (components.length !== 1) throw new Error(`expected one main graph, found ${components.length}`);
  const selected = components[0];
  return { mode: "main", nodeIds: [...selected], edgeIds: edgeIdsWithin(selected) };
};

const captureSelection = await readCaptureSelection();
const profile = await mkdtemp(path.join(os.tmpdir(), "leaf-editor-capture-"));
const port = await reservePort();
const url = `https://www.leafgon.com/editor/${options.domain}/${options.appid}`;
let browser;

try {
  browser = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-background-networking",
    `--user-data-dir=${profile}`,
    `--window-size=${options.width},${options.height}`,
    "--force-device-scale-factor=1",
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  let targets;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) { targets = await response.json(); break; }
    } catch {}
    await delay(250);
  }
  const target = targets?.find(item => item.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("Chrome debugging target did not become ready");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send("Page.enable");
  await send("Page.navigate", { url });
  await delay(options.waitMs);

  let crop;
  if (captureSelection) {
    const fit = await send("Runtime.evaluate", {
      expression: `(() => {
        const ids = ${JSON.stringify(captureSelection.nodeIds)};
        const edgeIds = new Set(${JSON.stringify(captureSelection.edgeIds)});
        const padding = 64;
        const viewport = document.querySelector(".react-flow__viewport");
        const pane = document.querySelector(".react-flow__pane");
        if (!viewport || !pane) throw new Error("React Flow viewport is unavailable");
        const elements = ids.map(id => document.querySelector(
          '.react-flow__node[data-id="' + CSS.escape(id) + '"]'));
        const missing = ids.filter((_, index) => !elements[index]);
        if (missing.length) throw new Error("missing rendered component nodes: " + missing.length);
        const selectedNodes = new Set(ids);
        document.querySelectorAll(".react-flow__node").forEach(element => {
          if (!selectedNodes.has(element.getAttribute("data-id"))) element.style.display = "none";
        });
        document.querySelectorAll(".react-flow__edge").forEach(element => {
          const testId = element.getAttribute("data-testid") || "";
          const edgeId = testId.startsWith("rf__edge-") ? testId.slice(9) : "";
          if (!edgeIds.has(edgeId)) element.style.display = "none";
        });
        const logical = elements.map(element => {
          const match = element.style.transform.match(/translate\\(([-.0-9]+)px,\\s*([-.0-9]+)px\\)/);
          if (!match) throw new Error("rendered node has no logical translation");
          return { x: Number(match[1]), y: Number(match[2]), width: element.offsetWidth, height: element.offsetHeight };
        });
        const minX = Math.min(...logical.map(rect => rect.x));
        const minY = Math.min(...logical.map(rect => rect.y));
        const maxX = Math.max(...logical.map(rect => rect.x + rect.width));
        const maxY = Math.max(...logical.map(rect => rect.y + rect.height));
        const paneRect = pane.getBoundingClientRect();
        const graphWidth = maxX - minX;
        const graphHeight = maxY - minY;
        const scale = Math.min(2, (paneRect.width - padding * 2) / graphWidth, (paneRect.height - padding * 2) / graphHeight);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error("component cannot be fitted in the viewport");
        const tx = paneRect.x + (paneRect.width - graphWidth * scale) / 2 - minX * scale;
        const ty = paneRect.y + (paneRect.height - graphHeight * scale) / 2 - minY * scale;
        viewport.style.transform = "translate(" + tx + "px, " + ty + "px) scale(" + scale + ")";
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          const rendered = elements.map(element => element.getBoundingClientRect());
          const left = Math.max(paneRect.left, Math.min(...rendered.map(rect => rect.left)) - padding);
          const top = Math.max(paneRect.top, Math.min(...rendered.map(rect => rect.top)) - padding);
          const right = Math.min(paneRect.right, Math.max(...rendered.map(rect => rect.right)) + padding);
          const bottom = Math.min(paneRect.bottom, Math.max(...rendered.map(rect => rect.bottom)) + padding);
          resolve({ x: left, y: top, width: right - left, height: bottom - top, scale, renderedNodeCount: elements.length });
        })));
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (fit.exceptionDetails) throw new Error(fit.exceptionDetails.exception?.description ?? "spelldef fit failed");
    crop = fit.result.value;
    if (!crop || crop.width <= 0 || crop.height <= 0) throw new Error("spelldef crop is empty");
  }

  const state = await send("Runtime.evaluate", {
    expression: `({
      readyState: document.readyState,
      canvasCount: document.querySelectorAll("canvas").length,
      svgCount: document.querySelectorAll("svg").length,
      targetVisible: ${JSON.stringify(options.spelldef ?? null)} === null ||
        [...document.querySelectorAll(".react-flow__node-leafspelldef")]
          .some(node => node.textContent.includes(${JSON.stringify(options.spelldef ?? "")}))
    })`,
    returnByValue: true,
  });
  if (captureSelection?.mode === "spelldef" && !state.result.value?.targetVisible) throw new Error("target spelldef is not visible after fitting");
  const screenshot = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 94,
    captureBeyondViewport: false,
    fromSurface: true,
    ...(crop ? { clip: { x: crop.x, y: crop.y, width: crop.width, height: crop.height, scale: 1 } } : {}),
  });
  socket.close();

  const output = path.resolve(options.output);
  await writeFile(output, Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({
    url,
    output,
    viewport: { width: options.width, height: options.height },
    waitMs: options.waitMs,
    selection: captureSelection ? {
      mode: captureSelection.mode,
      name: captureSelection.name,
      componentNodeCount: captureSelection.nodeIds.length,
      componentEdgeCount: captureSelection.edgeIds.length,
      lambdaSourceCount: captureSelection.lambdaSourceCount,
      crop,
    } : undefined,
    page: state.result.value,
  }, null, 2));
} finally {
  if (browser && browser.exitCode === null) browser.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}
