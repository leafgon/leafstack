#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { encodeBase64Json } from "./lib/runtime-dto.mjs";

const usage = () => {
  console.error(
    "usage: scaffold-runtime-dto.mjs --out <graph.json> [--domain <domain>] [--appid <appid>] [--endpoint <url>] [--profile-default <profile-id>] [--operation add|subtract|multiply|divide|power] [--constant <number>] [--operation-id <id>]",
  );
};

const parseArgs = (argv) => {
  const options = {};
  const supported = new Set([
    "--out",
    "--domain",
    "--appid",
    "--endpoint",
    "--profile-default",
    "--operation",
    "--constant",
    "--operation-id",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument) || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${argument}`);
    }
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }

  if (!options.out) throw new Error("--out is required");

  const operation = String(options.operation ?? "add");
  if (!["add", "subtract", "multiply", "divide", "power"].includes(operation)) {
    throw new Error(`--operation must be one of add|subtract|multiply|divide|power (got '${operation}')`);
  }

  const constant = Number(options.constant ?? 2);
  if (!Number.isFinite(constant)) {
    throw new Error(`--constant must be numeric (got '${options.constant}')`);
  }

  return {
    out: resolve(options.out),
    domain: String(options.domain ?? "example"),
    appid: String(options.appid ?? "runtime-dto-http-arith"),
    endpoint: String(options.endpoint ?? "http://127.0.0.1:8080/v1/operations"),
    profileDefault: String(options["profile-default"] ?? "profile-001"),
    operation,
    constant,
    operationId: String(options["operation-id"] ?? "op-01"),
  };
};

const runtimeNodeData = ({ type, args = {}, position }) => ({
  leaf: {
    api: "breezyforest",
    logic: {
      type,
      args,
    },
    appdata: {
      position,
    },
  },
});

const runtimeEdgeData = ({ sourceHandle = "out_a", targetHandle = "in_a" } = {}) => ({
  leaf: {
    api: "breezyforest",
    logic: {
      type: "leafdataedge",
    },
    appdata: {
      sourceHandle,
      targetHandle,
    },
  },
});

const node = ({ uuid, leafnodetype, data, outEdges = [] }) => ({
  uuid,
  leafnodetype,
  data: encodeBase64Json(data),
  out_edges: outEdges,
});

const edge = ({ uuid, source, target, sourceHandle = "out_a", targetHandle = "in_a" }) => ({
  uuid,
  source: { uuid: source },
  target: { uuid: target },
  data: encodeBase64Json(runtimeEdgeData({ sourceHandle, targetHandle })),
});

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const requestExpression = `(do (def request {:uri "${options.endpoint}" :mode "post" :header {:content-type "application/json"} :data {:profile "${options.profileDefault}" :operationId "${options.operationId}" :operation "${options.operation}" :operands [inport ${options.constant}]}}) (bottle "http-request" request))`;
const parseExpression = "(do (def payload (if (isbottle inport) (get inport :_content) inport)) (get payload :result))";

const graph = {
  domain: options.domain,
  appid: options.appid,
  nodes: [
    node({
      uuid: "IN1",
      leafnodetype: "leafinflowport",
      data: runtimeNodeData({ type: "leafinflowport", position: { x: 80, y: 160 } }),
      outEdges: [edge({ uuid: "E01_IN1_TO_REQ", source: "IN1", target: "REQ_HTTP" })],
    }),
    node({
      uuid: "REQ_HTTP",
      leafnodetype: "leaflisp",
      data: runtimeNodeData({
        type: "leaflisp",
        args: {
          lispexpression: requestExpression,
        },
        position: { x: 260, y: 160 },
      }),
      outEdges: [edge({ uuid: "E02_REQ_TO_HTTP", source: "REQ_HTTP", target: "HTTP_ARITH" })],
    }),
    node({
      uuid: "HTTP_ARITH",
      leafnodetype: "leafelement",
      data: runtimeNodeData({
        type: "leafelement",
        args: {
          elementname: "http",
          svgicon: {
            unicode: null,
            url: "",
            jsx: null,
          },
          elementconfig: "",
        },
        position: { x: 440, y: 160 },
      }),
      outEdges: [edge({ uuid: "E03_HTTP_TO_PARSE", source: "HTTP_ARITH", target: "PARSE_HTTP" })],
    }),
    node({
      uuid: "PARSE_HTTP",
      leafnodetype: "leaflisp",
      data: runtimeNodeData({
        type: "leaflisp",
        args: {
          lispexpression: parseExpression,
        },
        position: { x: 620, y: 160 },
      }),
      outEdges: [edge({ uuid: "E04_PARSE_TO_OUT", source: "PARSE_HTTP", target: "OUT1" })],
    }),
    node({
      uuid: "OUT1",
      leafnodetype: "leafoutflowport",
      data: runtimeNodeData({ type: "leafoutflowport", position: { x: 800, y: 160 } }),
      outEdges: [],
    }),
  ],
};

await writeFile(options.out, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      mode: "scaffold-runtime-dto",
      out: options.out,
      domain: options.domain,
      appid: options.appid,
      operation: options.operation,
      constant: options.constant,
      operationId: options.operationId,
      nodeCount: graph.nodes.length,
      edgeCount: graph.nodes.reduce((count, current) => count + current.out_edges.length, 0),
    },
    null,
    2,
  ),
);
