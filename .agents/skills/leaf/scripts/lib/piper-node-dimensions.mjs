const PT_TO_PX = 4 / 3;
const OUTER_BOX_EXTRA_PX = 10; // 2px padding and up to 3px selected border per side.

const outerPixels = (width, height, unit = "px") => {
  const multiplier = unit === "pt" ? PT_TO_PX : 1;
  return Object.freeze({
    width: Math.ceil(width * multiplier + OUTER_BOX_EXTRA_PX),
    height: Math.ceil(height * multiplier + OUTER_BOX_EXTRA_PX),
  });
};

export const PIPER_EDITOR_DIMENSIONS = Object.freeze({
  circularnode: outerPixels(50, 50, "pt"),
  circularnamednode: outerPixels(50, 50, "pt"),
  circularnamedboolnode: outerPixels(50, 50, "pt"),
  elementnode: outerPixels(50, 50, "pt"),
  errornode: outerPixels(50, 50, "pt"),
  rectangularnode: outerPixels(110, 35, "pt"),
  rectangularnamednode: Object.freeze({ width: 120, height: 57 }),
  rectangularnamednodeLong: Object.freeze({ width: 145, height: 57 }),
  tinynode: outerPixels(20, 20, "pt"),
  fallback: Object.freeze({ width: 75, height: 75 }),
});

// Captured editor-category mapping for LEAF layout sizing.
// Keep this table updated from deployed UI/runtime behavior when needed.
export const PIPER_EDITOR_NODE_TYPE_BY_LEAF_TYPE = Object.freeze({
  leafradioRX: "circularnamednode",
  leafradioTX: "circularnamednode",
  leafoutflowport: "tinynode",
  leafinflowport: "tinynode",
  leafmemoryio: "circularnamednode",
  leafscreenio: "circularnode",
  leafdeckspade: "circularnode",
  leafdeckheart: "circularnamednode",
  leafdeckdiamond: "circularnamednode",
  leafdeckclub: "circularnamednode",
  leafelement: "circularnamednode",
  leafgraph: "circularnamednode",
  leaflambdagraph: "circularnode",
  leafanchor: "tinynode",
  leafspelldef: "rectangularnamednode",
  leafspell: "circularnamednode",
  leafloopyspell: "rectangularnode",
  leafsyncflow: "circularnode",
  leafchronosflow: "circularnode",
  leafasyncflow: "circularnode",
  leafmixflow: "circularnode",
  leafgateflow: "circularnamedboolnode",
  leaflabel: "circularnamednode",
  leafdelabel: "circularnamednode",
  leafbottle: "circularnamednode",
  leafunbottle: "circularnamednode",
  leafcrate: "circularnode",
  leafconfig: "rectangularnode",
  leaflisp: "circularnode",
});

const PIPER_NAMED_DATA_KEY_BY_LEAF_TYPE = Object.freeze({
  leafspelldef: ["spellname"],
});

const valueAtPath = (value, path) => {
  let current = value;
  for (const key of path ?? []) current = current?.[key];
  return current;
};

const validateDimension = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !new Set(["width", "height"]).has(key))) {
    throw new Error(`${label} supports only width and height`);
  }
  for (const key of ["width", "height"]) {
    if (
      typeof value[key] !== "number" ||
      !Number.isFinite(value[key]) ||
      value[key] <= 0
    ) {
      throw new Error(`${label}.${key} must be a positive finite number`);
    }
  }
  return { width: value.width, height: value.height };
};

export const normalizeNodeDimensionOverrides = (
  value = {},
  label = "nodeDimensions",
) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object keyed by leaf.logic.type`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([leafType, dimensions]) => {
      if (leafType.length === 0)
        throw new Error(`${label} has an empty leaf type`);
      return [leafType, validateDimension(dimensions, `${label}.${leafType}`)];
    }),
  );
};

export const resolvePiperLeafNodeDimensions = (
  decodedNodeData,
  overrides = {},
) => {
  const leafType = decodedNodeData?.leaf?.logic?.type;
  if (typeof leafType !== "string" || leafType.length === 0) {
    throw new Error("decoded node data must contain leaf.logic.type");
  }
  if (Object.hasOwn(overrides, leafType))
    return { ...overrides[leafType], source: "override" };

  let editorNodeType = PIPER_EDITOR_NODE_TYPE_BY_LEAF_TYPE[leafType];
  if (editorNodeType === "rectangularnamednode") {
    const name = valueAtPath(
      decodedNodeData.leaf.logic.args,
      PIPER_NAMED_DATA_KEY_BY_LEAF_TYPE[leafType],
    );
    if (typeof name === "string" && name.length > 14)
      editorNodeType = "rectangularnamednodeLong";
  }
  const dimensions =
    PIPER_EDITOR_DIMENSIONS[editorNodeType] ?? PIPER_EDITOR_DIMENSIONS.fallback;
  return { ...dimensions, source: editorNodeType ?? "fallback" };
};
