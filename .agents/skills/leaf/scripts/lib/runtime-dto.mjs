export const extractGraph = (payload) => payload?.data?.graph ?? payload?.graph ?? payload;

export const encodeBase64Json = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

export const decodeBase64Json = (encoded, label = "base64-json") => {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error(`${label} must be a non-empty base64 string`);
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (error) {
    throw new Error(`${label} is not valid base64 (${error.message})`);
  }

  try {
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${error.message})`);
  }
};

export const isDeclarativeGraphShape = (graph) => {
  if (!graph || typeof graph !== "object") return false;
  if (typeof graph.kind === "string" && graph.kind.trim().toLowerCase() === "leaf-graph") return true;
  if (Object.hasOwn(graph, "inputs") || Object.hasOwn(graph, "outputs")) return true;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  return nodes.some(
    (node) =>
      node
      && typeof node === "object"
      && Object.hasOwn(node, "id")
      && Object.hasOwn(node, "element")
      && !Object.hasOwn(node, "uuid"),
  );
};

export const classifyRuntimeDtoGraphShape = (graph) => {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return "invalid-payload";

  const hasNodesArray = Array.isArray(graph.nodes);
  const hasEdgesArray = Array.isArray(graph.edges);
  const declarative = isDeclarativeGraphShape(graph);

  if (declarative && hasNodesArray) {
    const hasRuntimeNode = graph.nodes.some(
      (node) => node && typeof node === "object" && typeof node.uuid === "string" && Object.hasOwn(node, "leafnodetype"),
    );
    if (hasRuntimeNode) return "mixed-runtime-declarative";
  }

  if (declarative) return "declarative";
  if (hasNodesArray && hasEdgesArray) return "custom-nodes-edges";
  if (hasNodesArray) return "runtime-dto";
  return "unknown-object";
};

const validateNodeBase = (node, index, problems) => {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    problems.push(`nodes[${index}] must be an object`);
    return;
  }

  if (typeof node.uuid !== "string" || node.uuid.length === 0) {
    problems.push(`nodes[${index}].uuid must be a non-empty string`);
  }

  if (typeof node.leafnodetype !== "string" || node.leafnodetype.length === 0) {
    problems.push(`nodes[${index}].leafnodetype must be a non-empty string`);
  }

  if (Object.hasOwn(node, "id") || Object.hasOwn(node, "element")) {
    problems.push(`nodes[${index}] appears declarative (id/element keys are not runtime DTO fields)`);
  }
};

const validateEdge = ({ edge, nodeUuid, nodeIndex, edgeIndex, knownNodeIds, problems, warnings }) => {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}] must be an object`);
    return;
  }

  if (typeof edge.uuid !== "string" || edge.uuid.length === 0) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].uuid must be a non-empty string`);
  }

  const sourceUuid = edge?.source?.uuid;
  const targetUuid = edge?.target?.uuid;

  if (typeof sourceUuid !== "string" || sourceUuid.length === 0) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].source.uuid must be a non-empty string`);
  } else if (sourceUuid !== nodeUuid) {
    warnings.push(`edge ${edge.uuid ?? `<${nodeIndex}:${edgeIndex}>`} source.uuid (${sourceUuid}) does not match parent node uuid (${nodeUuid})`);
  }

  if (typeof targetUuid !== "string" || targetUuid.length === 0) {
    problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].target.uuid must be a non-empty string`);
  } else if (!knownNodeIds.has(targetUuid)) {
    warnings.push(`edge ${edge.uuid ?? `<${nodeIndex}:${edgeIndex}>`} targets unknown node uuid (${targetUuid})`);
  }

  try {
    const decoded = decodeBase64Json(edge.data, `nodes[${nodeIndex}].out_edges[${edgeIndex}].data`);
    const logicType = decoded?.leaf?.logic?.type;
    if (typeof logicType !== "string" || logicType.length === 0) {
      problems.push(`nodes[${nodeIndex}].out_edges[${edgeIndex}].data must include leaf.logic.type`);
    }
  } catch (error) {
    problems.push(error.message);
  }
};

export const validateRuntimeDtoGraph = (graph) => {
  const problems = [];
  const warnings = [];
  const shapeClass = classifyRuntimeDtoGraphShape(graph);

  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return {
      pass: false,
      problems: ["graph payload must resolve to an object"],
      warnings,
      nodeCount: 0,
      edgeCount: 0,
      declarativeShape: false,
      shapeClass,
      failureCode: "graph-payload-invalid",
    };
  }

  const declarativeShape = isDeclarativeGraphShape(graph);
  if (declarativeShape) {
    problems.push("graph payload appears to be declarative schema (kind/inputs/outputs/id+element), not runtime DTO");
  }

  if (shapeClass === "mixed-runtime-declarative") {
    problems.push("graph payload mixes declarative and runtime DTO fields; submit one canonical runtime DTO artifact only");
  }

  if (shapeClass === "custom-nodes-edges") {
    problems.push("graph payload uses top-level edges array; runtime DTO requires nested nodes[].out_edges payloads");
  }

  if (typeof graph.domain !== "string" || graph.domain.length === 0) {
    problems.push("graph.domain must be a non-empty string");
  }

  if (typeof graph.appid !== "string" || graph.appid.length === 0) {
    problems.push("graph.appid must be a non-empty string");
  }

  if (!Array.isArray(graph.nodes)) {
    problems.push("graph.nodes must be an array");
    return {
      pass: false,
      problems,
      warnings,
      nodeCount: 0,
      edgeCount: 0,
      declarativeShape,
      shapeClass,
      failureCode: "graph-nodes-missing",
    };
  }

  const nodeIds = new Set();
  for (const [index, node] of graph.nodes.entries()) {
    validateNodeBase(node, index, problems);
    if (node && typeof node.uuid === "string" && node.uuid.length > 0) {
      if (nodeIds.has(node.uuid)) {
        problems.push(`duplicate node uuid: ${node.uuid}`);
      }
      nodeIds.add(node.uuid);
    }
  }

  let edgeCount = 0;
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;

    try {
      const decodedNode = decodeBase64Json(node.data, `nodes[${nodeIndex}].data`);
      const logicType = decodedNode?.leaf?.logic?.type;
      if (typeof logicType !== "string" || logicType.length === 0) {
        problems.push(`nodes[${nodeIndex}].data must include leaf.logic.type`);
      } else if (node.leafnodetype !== logicType) {
        warnings.push(`node ${node.uuid ?? `<${nodeIndex}>`} leafnodetype (${node.leafnodetype}) differs from data leaf.logic.type (${logicType})`);
      }
    } catch (error) {
      problems.push(error.message);
    }

    if (!Array.isArray(node.out_edges)) {
      problems.push(`nodes[${nodeIndex}].out_edges must be an array`);
      continue;
    }

    for (const [edgeIndex, edge] of node.out_edges.entries()) {
      edgeCount += 1;
      validateEdge({
        edge,
        nodeUuid: node.uuid,
        nodeIndex,
        edgeIndex,
        knownNodeIds: nodeIds,
        problems,
        warnings,
      });
    }
  }

  const pass = problems.length === 0;

  return {
    pass,
    problems,
    warnings,
    nodeCount: graph.nodes.length,
    edgeCount,
    declarativeShape,
    shapeClass,
    failureCode: pass
      ? null
      : (declarativeShape
        ? "declarative-shape"
        : (shapeClass === "custom-nodes-edges"
          ? "custom-graph-shape"
          : (shapeClass === "mixed-runtime-declarative"
            ? "mixed-graph-shape"
            : "runtime-dto-invalid"))),
  };
};

export const inspectRuntimeDtoNodes = (graph) => {
  const entries = [];
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    return entries;
  }

  for (const [index, node] of graph.nodes.entries()) {
    const entry = {
      index,
      uuid: typeof node?.uuid === "string" ? node.uuid : null,
      leafnodetype: typeof node?.leafnodetype === "string" ? node.leafnodetype : null,
      decoded: null,
      error: null,
      json: null,
    };

    try {
      entry.decoded = decodeBase64Json(node?.data, `nodes[${index}].data`);
      entry.json = JSON.stringify(entry.decoded);
    } catch (error) {
      entry.error = error.message;
    }

    entries.push(entry);
  }

  return entries;
};

const getNodeLogic = (node, index) => {
  const decoded = decodeBase64Json(node?.data, `nodes[${index}].data`);
  const logic = decoded?.leaf?.logic;
  if (!logic || typeof logic !== "object") {
    throw new Error(`nodes[${index}].data must include leaf.logic object`);
  }
  return logic;
};

const readsUnsafeParsedHttpResult = (expression) => {
  const source = String(expression ?? "");
  if (source.length === 0) return false;

  const directParsePattern = /\(parse\s+\(get\s+[A-Za-z0-9_-]+\s+:result\)\)/;
  const directNilGuardPattern = /\(isnil\s+\(get\s+[A-Za-z0-9_-]+\s+:result\)\)/;

  if (directParsePattern.test(source) && !directNilGuardPattern.test(source)) {
    return true;
  }

  const bindingPattern = /\(def\s+([A-Za-z0-9_-]+)\s+\(get\s+[A-Za-z0-9_-]+\s+:result\)\)/g;
  for (const match of source.matchAll(bindingPattern)) {
    const bindingName = match?.[1];
    if (typeof bindingName !== "string" || bindingName.length === 0) continue;

    const parseBindingPattern = new RegExp(`\\(parse\\s+${bindingName}\\)`);
    if (!parseBindingPattern.test(source)) continue;

    const nilGuardPattern = new RegExp(`\\(isnil\\s+${bindingName}\\)`);
    if (!nilGuardPattern.test(source)) {
      return true;
    }
  }

  return false;
};

const isRedundantKeyedMixUnwrap = (expression) => {
  const source = String(expression ?? "");
  if (source.length === 0) return false;

  const unwrapSteps = source.match(/\(if\s+\(isbottle\s+[A-Za-z0-9_-]+\)\s+\(get\s+[A-Za-z0-9_-]+\s+:_content\)\s+[A-Za-z0-9_-]+\)/g) ?? [];
  if (unwrapSteps.length < 2) return false;

  return /\(get\s+[A-Za-z0-9_-]+\s+:[A-Za-z0-9_-]+\)/.test(source);
};

const parseSafetyModes = new Set(["off", "balanced", "strict"]);

const getRawParseInportUsage = (expression) => {
  const source = String(expression ?? "");
  if (source.length === 0) {
    return {
      usesRawParseInport: false,
      aliases: [],
    };
  }

  const aliases = new Set();
  const defAliasPattern = /\(def\s+([A-Za-z0-9_-]+)\s+([A-Za-z0-9_-]+)\)/g;

  let changed = true;
  while (changed) {
    changed = false;
    defAliasPattern.lastIndex = 0;
    for (const match of source.matchAll(defAliasPattern)) {
      const targetName = match?.[1];
      const sourceName = match?.[2];
      if (typeof targetName !== "string" || typeof sourceName !== "string") continue;
      if (sourceName !== "inport" && !aliases.has(sourceName)) continue;
      if (aliases.has(targetName)) continue;
      aliases.add(targetName);
      changed = true;
    }
  }

  if (/\(parse\s+inport\)/.test(source)) {
    return {
      usesRawParseInport: true,
      aliases: [],
    };
  }

  const aliasHits = [];
  for (const alias of aliases) {
    const aliasPattern = new RegExp(`\\(parse\\s+${alias}\\)`);
    if (!aliasPattern.test(source)) continue;
    aliasHits.push(alias);
  }

  return {
    usesRawParseInport: aliasHits.length > 0,
    aliases: aliasHits,
  };
};

const classifyRawParseInportRisk = ({ incoming, nodeMetaByUuid }) => {
  if (!Array.isArray(incoming) || incoming.length !== 1) {
    return {
      risk: "nonscalar-risk",
      details: `node receives ${Array.isArray(incoming) ? incoming.length : 0} upstream edges`,
    };
  }

  const sourceUuid = incoming[0]?.sourceUuid;
  if (typeof sourceUuid !== "string" || sourceUuid.length === 0) {
    return {
      risk: "unknown",
      details: "upstream source uuid is missing",
    };
  }

  const sourceMeta = nodeMetaByUuid.get(sourceUuid);
  if (!sourceMeta || sourceMeta.decodeError) {
    return {
      risk: "unknown",
      details: `upstream source '${sourceUuid}' metadata is unavailable`,
    };
  }

  const sourceLeafType = typeof sourceMeta.leafnodetype === "string" ? sourceMeta.leafnodetype : "unknown";
  if (["leafelement", "leafmixflow", "leafbottle"].includes(sourceLeafType)) {
    return {
      risk: "nonscalar-risk",
      details: `upstream '${sourceUuid}' type '${sourceLeafType}' often emits envelope/map payloads`,
    };
  }

  if (sourceLeafType === "leaflisp") {
    const sourceExpression = String(sourceMeta.logic?.args?.lispexpression ?? "");
    if (/\bbottle\s+["']/.test(sourceExpression)) {
      return {
        risk: "nonscalar-risk",
        details: `upstream leaflisp '${sourceUuid}' emits a bottle payload`,
      };
    }
  }

  return {
    risk: "unknown",
    details: `upstream '${sourceUuid}' type '${sourceLeafType}' does not prove a scalar contract`,
  };
};

export const lintRuntimeDtoHttpContracts = (graph, options = {}) => {
  const outKey = typeof options.outKey === "string" && options.outKey.length > 0 ? options.outKey : "OUT1";
  const requestedParseSafety = typeof options.parseSafety === "string" ? options.parseSafety.trim().toLowerCase() : "balanced";
  const parseSafety = parseSafetyModes.has(requestedParseSafety) ? requestedParseSafety : "balanced";
  const issues = [];
  const warnings = [];
  const facts = {
    outKey,
    parseSafety,
    nodeCount: 0,
    httpNodeCount: 0,
    leaflispNodeCount: 0,
  };

  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    return {
      pass: false,
      issues: [
        {
          code: "graph-nodes-missing",
          message: "graph.nodes must be an array for HTTP contract linting",
        },
      ],
      warnings,
      facts,
    };
  }

  facts.nodeCount = graph.nodes.length;

  const nodeByUuid = new Map();
  const nodeMetaByUuid = new Map();
  const incomingByTarget = new Map();

  for (const [index, node] of graph.nodes.entries()) {
    if (!node || typeof node !== "object") continue;
    const uuid = typeof node.uuid === "string" ? node.uuid : null;
    if (!uuid) continue;

    nodeByUuid.set(uuid, node);

    let logic = null;
    let decodeError = null;
    try {
      logic = getNodeLogic(node, index);
    } catch (error) {
      decodeError = error.message;
    }

    nodeMetaByUuid.set(uuid, {
      index,
      leafnodetype: typeof node.leafnodetype === "string" ? node.leafnodetype : null,
      logic,
      decodeError,
    });

    for (const edge of Array.isArray(node.out_edges) ? node.out_edges : []) {
      const targetUuid = edge?.target?.uuid;
      if (typeof targetUuid !== "string" || targetUuid.length === 0) continue;
      const entries = incomingByTarget.get(targetUuid) ?? [];
      entries.push({ sourceUuid: uuid, edgeUuid: edge?.uuid ?? null });
      incomingByTarget.set(targetUuid, entries);
    }
  }

  const outNode = nodeByUuid.get(outKey);
  if (!outNode) {
    issues.push({
      code: "missing-outflow-node",
      message: `outflow node '${outKey}' is not present in graph.nodes`,
    });
  } else if (outNode.leafnodetype !== "leafoutflowport") {
    issues.push({
      code: "outflow-node-type-mismatch",
      message: `node '${outKey}' must use leafoutflowport (found '${outNode.leafnodetype ?? "unknown"}')`,
    });
  } else {
    const incomingToOutflow = incomingByTarget.get(outKey) ?? [];
    if (incomingToOutflow.length === 0) {
      issues.push({
        code: "outflow-node-missing-incoming",
        message: `node '${outKey}' must have at least one incoming producer edge`,
      });
    }
  }

  for (const [uuid, meta] of nodeMetaByUuid.entries()) {
    if (meta.decodeError) continue;

    if (meta.leafnodetype === "leaflisp" && meta.logic?.type === "leaflisp") {
      facts.leaflispNodeCount += 1;
      const incoming = incomingByTarget.get(uuid) ?? [];
      const expression = String(meta.logic?.args?.lispexpression ?? "");

      if (/\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/.test(expression)) {
        issues.push({
          code: "leaflisp-literal-shell-template",
          message: `leaflisp node '${uuid}' contains shell-template syntax (\${...}); LEAFlisp does not expand shell env templates at runtime`,
        });
      }

      if (/\bbottle\s+["']wait["']/.test(expression)) {
        issues.push({
          code: "leaflisp-wait-bottle-fallback",
          message: `leaflisp node '${uuid}' emits bottle "wait" fallback; use deterministic readiness wiring and avoid placeholder wait bottles`,
        });
      }

      if (/\(if\s+\(islist\s+[^\s)]+\)\s+0\s+[^\s)]+\)/.test(expression)) {
        issues.push({
          code: "leaflisp-lossy-list-coercion",
          message: `leaflisp node '${uuid}' collapses list payloads to scalar 0; preserve list values or branch with explicit non-lossy shaping`,
        });
      }

      if (expression.includes(":IN1") && incoming.length > 0 && /\(if\s+\(isnil\s+[^)]+\)/.test(expression)) {
        const incomingLeafTypes = incoming.map((entry) => nodeMetaByUuid.get(entry.sourceUuid)?.leafnodetype ?? null);
        const hasInflowSource = incomingLeafTypes.some((leafType) => leafType === "leafinflowport");
        const hasNonInflowSource = incomingLeafTypes.some((leafType) => typeof leafType === "string" && leafType !== "leafinflowport");
        if (!hasInflowSource && hasNonInflowSource) {
          issues.push({
            code: "leaflisp-nonsource-in1-reread",
            message: `leaflisp node '${uuid}' re-reads :IN1 from transformed upstream payloads; consume upstream transformed values explicitly instead of re-extracting root input keys`,
          });
        }
      }

      if (parseSafety !== "off") {
        const parseUsage = getRawParseInportUsage(expression);
        if (parseUsage.usesRawParseInport) {
          const risk = classifyRawParseInportRisk({ incoming, nodeMetaByUuid });
          const aliasHint = parseUsage.aliases.length > 0
            ? ` via alias(es) ${parseUsage.aliases.map((name) => `'${name}'`).join(", ")}`
            : "";

          if (risk.risk === "nonscalar-risk") {
            issues.push({
              code: "leaflisp-raw-parse-inport-nonscalar-risk",
              message: `leaflisp node '${uuid}' uses raw parse of inport${aliasHint} with non-scalar-risk upstream shape (${risk.details}); unwrap/select scalar value before parse`,
            });
          } else if (risk.risk === "unknown") {
            const finding = {
              code: "leaflisp-raw-parse-inport-unproven-scalar",
              message: `leaflisp node '${uuid}' uses raw parse of inport${aliasHint} but scalar contract is unproven (${risk.details}); keep raw parse only when scalar input is guaranteed, otherwise add explicit extraction`,
            };

            if (parseSafety === "strict") {
              issues.push(finding);
            } else {
              warnings.push(finding);
            }
          }
        }
      }

      for (const rule of [
        { code: "leaflisp-unsupported-token-list", pattern: /\(list\b/, token: "(list ...)" },
        { code: "leaflisp-unsupported-token-vector", pattern: /\(vector\b/, token: "(vector ...)" },
        { code: "leaflisp-unsupported-token-array", pattern: /\(array\b/, token: "(array ...)" },
        { code: "leaflisp-unsupported-token-inport2", pattern: /\binport2\b/, token: "inport2" },
        { code: "leaflisp-unsupported-token-import", pattern: /\bimport\b/, token: "import (use inport)" },
      ]) {
        if (!rule.pattern.test(expression)) continue;
        issues.push({
          code: rule.code,
          message: `leaflisp node '${uuid}' uses unsupported token ${rule.token}; use LEAFlisp core forms and explicit provenance-safe bottle/map shaping`,
        });
      }

      if (incoming.length > 1) {
        const usesIndexAccess = /\(get\s+(?:inport|pair)\s+\d+\)/.test(expression);
        const readsBottleName = /:_bname|\(get\s+[^)]+\s+:_bname\)/.test(expression);

        if (usesIndexAccess) {
          issues.push({
            code: "leaflisp-multi-input-index-access",
            message: `leaflisp node '${uuid}' receives multiple inputs but indexes positional inport entries; encode provenance in bottles and resolve by bottle name (or merge through leafmixflow before parsing)`,
          });
        }

        if (!readsBottleName) {
          warnings.push({
            code: "leaflisp-multi-input-provenance-unclear",
            message: `leaflisp node '${uuid}' receives ${incoming.length} upstream edges with no bottle-name screening; use bottled upstream payloads and/or leafmixflow key-value merge for deterministic provenance`,
          });
        }
      }

      const incomingLeafTypes = incoming.map((entry) => nodeMetaByUuid.get(entry.sourceUuid)?.leafnodetype ?? null);
      const hasMixflowSource = incomingLeafTypes.some((leafType) => leafType === "leafmixflow");
      if (hasMixflowSource && isRedundantKeyedMixUnwrap(expression)) {
        warnings.push({
          code: "leaflisp-keyed-mix-overunwrap",
          message: `leaflisp node '${uuid}' reads keyed mixflow data but applies repeated generic bottle/content unwraps; prefer direct keyed reads (for example (get inport :arg1)) unless the local contract requires envelope handling`,
        });
      }
    }

    const logicType = meta.logic?.type;
    const elementName = meta.logic?.args?.elementname;
    if (meta.leafnodetype !== "leafelement" || logicType !== "leafelement" || elementName !== "http") {
      continue;
    }

    facts.httpNodeCount += 1;
    const incoming = incomingByTarget.get(uuid) ?? [];
    if (incoming.length === 0) {
      issues.push({
        code: "http-node-missing-request-source",
        message: `http node '${uuid}' has no incoming request source`,
      });
    }

    for (const entry of incoming) {
      const sourceMeta = nodeMetaByUuid.get(entry.sourceUuid);
      if (!sourceMeta) {
        issues.push({
          code: "http-request-source-missing",
          message: `http node '${uuid}' source '${entry.sourceUuid}' does not exist`,
        });
        continue;
      }

      if (sourceMeta.decodeError) {
        issues.push({
          code: "http-request-source-decode-error",
          message: `http source '${entry.sourceUuid}' has invalid payload (${sourceMeta.decodeError})`,
        });
        continue;
      }

      if (sourceMeta.leafnodetype !== "leaflisp" || sourceMeta.logic?.type !== "leaflisp") {
        issues.push({
          code: "http-request-source-non-leaflisp",
          message: `http node '${uuid}' source '${entry.sourceUuid}' must be leaflisp request-builder`,
        });
        continue;
      }

      const expression = String(sourceMeta.logic?.args?.lispexpression ?? "");
      if (!/bottle\s+["']http-request["']/.test(expression)) {
        issues.push({
          code: "http-request-source-missing-http-request-bottle",
          message: `request source '${entry.sourceUuid}' must emit bottle \"http-request\"`,
        });
      }

      if (/\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/.test(expression)) {
        issues.push({
          code: "http-request-source-literal-shell-template",
          message: `request source '${entry.sourceUuid}' contains literal shell-template syntax (\${...}); set profile explicitly in payload data and avoid shell substitution syntax in LEAFlisp`,
        });
      }

      for (const token of [":uri", ":mode", ":data", ":operation", ":operands"]) {
        if (!expression.includes(token)) {
          issues.push({
            code: "http-request-source-missing-required-token",
            message: `request source '${entry.sourceUuid}' expression does not contain ${token}`,
          });
        }
      }

      if (!expression.includes(":profile")) {
        warnings.push({
          code: "http-request-source-missing-profile-token",
          message: `request source '${entry.sourceUuid}' expression does not contain :profile (runtime should rely on ARITHMETIC_PROFILE_ID fallback policy)`,
        });
      }
    }

    const outgoing = Array.isArray(nodeByUuid.get(uuid)?.out_edges) ? nodeByUuid.get(uuid).out_edges : [];
    if (outgoing.length === 0) {
      issues.push({
        code: "http-node-missing-parse-target",
        message: `http node '${uuid}' has no outgoing parse target`,
      });
      continue;
    }

    for (const edge of outgoing) {
      const targetUuid = edge?.target?.uuid;
      const targetMeta = typeof targetUuid === "string" ? nodeMetaByUuid.get(targetUuid) : null;
      if (!targetMeta) {
        issues.push({
          code: "http-parse-target-missing",
          message: `http node '${uuid}' target '${targetUuid ?? "unknown"}' does not exist`,
        });
        continue;
      }

      if (targetMeta.decodeError) {
        issues.push({
          code: "http-parse-target-decode-error",
          message: `parse node '${targetUuid}' has invalid payload (${targetMeta.decodeError})`,
        });
        continue;
      }

      if (targetMeta.leafnodetype !== "leaflisp" || targetMeta.logic?.type !== "leaflisp") {
        issues.push({
          code: "http-parse-target-non-leaflisp",
          message: `http node '${uuid}' target '${targetUuid}' must be leaflisp parser`,
        });
        continue;
      }

      const parseExpression = String(targetMeta.logic?.args?.lispexpression ?? "");
      if (!parseExpression.includes(":result")) {
        issues.push({
          code: "http-parse-target-missing-result-read",
          message: `parse node '${targetUuid}' should extract :result from HTTP response`,
        });
      }

      if (readsUnsafeParsedHttpResult(parseExpression)) {
        issues.push({
          code: "http-parse-target-unsafe-result-parse",
          message: `parse node '${targetUuid}' parses :result without nil-safe guard; unwrap bottle/content and guard missing result before parse`,
        });
      }

      if (!parseExpression.includes(":_content")) {
        warnings.push({
          code: "http-parse-target-missing-content-unwrap",
          message: `parse node '${targetUuid}' does not reference :_content; confirm bottle/content unwrapping is intentional`,
        });
      }

      const indexesPairInputs = /\(get\s+pair\s+0\)|\(get\s+pair\s+1\)/.test(parseExpression);
      const hasPairNilGuards = /\(isnil\s+pair\)|\(isnil\s+first\)|\(isnil\s+second\)/.test(parseExpression);
      if (indexesPairInputs && !hasPairNilGuards) {
        issues.push({
          code: "http-parse-target-unchecked-pair-assumption",
          message: `parse node '${targetUuid}' indexes pair[0/1] without nil guards; do not assume both async inputs arrive together`,
        });
      }
    }
  }

  return {
    pass: issues.length === 0,
    issues,
    warnings,
    facts,
  };
};
