#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const usage = () => {
  console.error(
    "usage: run-leafspelldef-test.mjs --graph <graph.json> --target-nodeuuid <leafspelldef-uuid> (--entry-refnode <node-uuid> | --entry-spellname <spellname>) [--variant <menu-test|cast-spell>] [--input <input.json>] [run-leaf-graph options]",
  );
};

const parseNonNegativeInteger = (raw, flagName) => {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return value;
};

const parseArgs = (argv) => {
  const options = {};
  const valueFlags = new Set([
    "--graph",
    "--target-nodeuuid",
    "--entry-refnode",
    "--entry-spellname",
    "--variant",
    "--input",
    "--version",
    "--ghostos-dir",
    "--json-indent",
    "--log-file",
  ]);
  const booleanFlags = new Set(["--quiet", "--error-json", "--skip-version-check"]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueFlags.has(argument)) {
      if (index + 1 >= argv.length) {
        throw new Error(`missing value for ${argument}`);
      }
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
      continue;
    }
    if (booleanFlags.has(argument)) {
      options[argument.slice(2)] = true;
      continue;
    }
    throw new Error(`invalid argument: ${argument}`);
  }

  if (!options.graph) {
    throw new Error("--graph is required");
  }
  if (!options["target-nodeuuid"]) {
    throw new Error("--target-nodeuuid is required");
  }
  if (!UUID_RE.test(options["target-nodeuuid"])) {
    throw new Error("--target-nodeuuid must be a UUID");
  }

  const entryRefnode = options["entry-refnode"];
  const entrySpellname = options["entry-spellname"];
  if (!entryRefnode && !entrySpellname) {
    throw new Error("one of --entry-refnode or --entry-spellname is required");
  }
  if (entryRefnode && entrySpellname) {
    throw new Error("use either --entry-refnode or --entry-spellname, not both");
  }
  if (entryRefnode && !UUID_RE.test(entryRefnode)) {
    throw new Error("--entry-refnode must be a UUID");
  }

  const variant = options.variant ?? "menu-test";
  if (!new Set(["menu-test", "cast-spell"]).has(variant)) {
    throw new Error("--variant must be one of: menu-test, cast-spell");
  }

  return {
    graph: resolve(options.graph),
    targetNodeuuid: options["target-nodeuuid"],
    entryRefnode,
    entrySpellname,
    variant,
    input: options.input ? resolve(options.input) : null,
    version: options.version,
    ghostosDir: options["ghostos-dir"] ? resolve(options["ghostos-dir"]) : null,
    skipVersionCheck: Boolean(options["skip-version-check"]),
    quiet: Boolean(options.quiet),
    errorJson: Boolean(options["error-json"]),
    jsonIndent:
      typeof options["json-indent"] === "string"
        ? parseNonNegativeInteger(options["json-indent"], "--json-indent")
        : null,
    logFile: options["log-file"] ? resolve(options["log-file"]) : null,
  };
};

const extractGraph = (payload) => payload?.data?.graph ?? payload?.graph ?? payload;

const decodeJsonishPayload = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const attempts = [];
  attempts.push(trimmed);

  try {
    attempts.push(Buffer.from(trimmed, "base64").toString("utf8"));
  } catch (_error) {
  }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_error) {
    }
  }

  return undefined;
};

const maybeSpellname = (node) => {
  const decoded = decodeJsonishPayload(node?.data);
  const value = decoded?.leaf?.logic?.args?.spellname;
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
};

const resolveEntryRefnode = ({ graph, entryRefnode, entrySpellname }) => {
  if (entryRefnode) {
    return entryRefnode;
  }

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const matches = nodes.filter((node) => {
    if (!node || typeof node !== "object") return false;
    if (typeof node.uuid !== "string" || !UUID_RE.test(node.uuid)) return false;
    if (node.leafnodetype !== "leafspell") return false;
    return maybeSpellname(node) === entrySpellname;
  });

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one leafspell with spellname ${JSON.stringify(entrySpellname)}, found ${matches.length}`,
    );
  }

  return matches[0].uuid;
};

const makeHarnessInput = ({ variant, targetNodeuuid, inputPayload }) => {
  if (variant === "cast-spell") {
    return {
      _bname: "cast-spell",
      _content: {
        nodeuuid: targetNodeuuid,
        input: inputPayload,
      },
      _label: {},
    };
  }

  return {
    touchevent: {
      _refnode: targetNodeuuid,
    },
    data: inputPayload,
  };
};

const runNode = (scriptPath, args) =>
  new Promise((resolveProcess) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
    child.on("close", (status) => {
      resolveProcess({ status: status ?? 1, stdout, stderr });
    });
  });

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const runLeafGraphScript = resolve(scriptDirectory, "run-leaf-graph.mjs");

let temporaryDirectory;

try {
  const parsedGraphPayload = JSON.parse(await readFile(options.graph, "utf8"));
  const graph = extractGraph(parsedGraphPayload);
  if (!graph || !Array.isArray(graph.nodes)) {
    throw new Error("graph payload must resolve to an object with a nodes array");
  }

  const inputPayload = options.input ? JSON.parse(await readFile(options.input, "utf8")) : {};
  const entryRefnode = resolveEntryRefnode({
    graph,
    entryRefnode: options.entryRefnode,
    entrySpellname: options.entrySpellname,
  });

  const harnessInput = makeHarnessInput({
    variant: options.variant,
    targetNodeuuid: options.targetNodeuuid,
    inputPayload,
  });

  temporaryDirectory = await mkdtemp(join(tmpdir(), "leafspelldef-test-harness-"));
  const generatedInputPath = join(temporaryDirectory, "leafspelldef-test.input.json");
  await writeFile(generatedInputPath, `${JSON.stringify(harnessInput, null, 2)}\n`, "utf8");

  const childArgs = ["--graph", options.graph, "--input", generatedInputPath, "--refnode", entryRefnode];
  if (options.version) childArgs.push("--version", options.version);
  if (options.ghostosDir) childArgs.push("--ghostos-dir", options.ghostosDir);
  if (options.skipVersionCheck) childArgs.push("--skip-version-check");
  if (options.quiet) childArgs.push("--quiet");
  if (options.errorJson) childArgs.push("--error-json");
  if (typeof options.jsonIndent === "number") childArgs.push("--json-indent", String(options.jsonIndent));
  if (options.logFile) childArgs.push("--log-file", options.logFile);

  const childResult = await runNode(runLeafGraphScript, childArgs);
  if (childResult.stderr) process.stderr.write(childResult.stderr);

  if (childResult.status !== 0) {
    if (childResult.stdout) process.stdout.write(childResult.stdout);
    process.exit(childResult.status);
  }

  let parsedRun;
  try {
    parsedRun = JSON.parse(childResult.stdout);
  } catch (_error) {
    throw new Error("run-leaf-graph returned non-JSON output");
  }

  const wrappedOutput = {
    mode: "leafspelldef-test-harness",
    invocation: {
      variant: options.variant,
      targetNodeuuid: options.targetNodeuuid,
      entryRefnode,
      entrySpellname: options.entrySpellname ?? null,
      sourceInputPath: options.input,
      generatedInputPath,
    },
    run: parsedRun,
  };

  const indent = options.quiet ? 0 : (options.jsonIndent ?? 2);
  console.log(JSON.stringify(wrappedOutput, null, indent));
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
} finally {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

