export const COURSE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_STATE_BYTES = 16 * 1024 * 1024;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export function assertSafeJson(value, depth = 0, budget = { n: 0 }) {
  if (++budget.n > 250000 || depth > 32)
    throw new Error("JSON complexity limit exceeded");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string") {
    if (value.length > 100000) throw new Error("String too long");
    return;
  }
  if (
    !value ||
    typeof value !== "object" ||
    (!Array.isArray(value) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
  )
    throw new Error("Expected plain JSON");
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) throw new Error("Unsafe JSON key");
    assertSafeJson(value[key], depth + 1, budget);
  }
}
function fail(message) {
  throw new Error(message);
}
export function object(v, keys, label) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail(`${label}: expected object`);
  for (const k of Object.keys(v))
    if (!keys.includes(k)) fail(`${label}: unknown field ${k}`);
}
export function text(v, label, max = 10000, empty = false) {
  if (typeof v !== "string" || v.length > max || (!empty && !v.trim()))
    fail(`${label}: invalid text`);
}
export function id(v, label = "id") {
  if (
    typeof v !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(v) ||
    forbidden.has(v)
  )
    fail(`${label}: invalid identifier`);
}
function array(v, label, max, min = 0) {
  if (!Array.isArray(v) || v.length > max || v.length < min)
    fail(`${label}: invalid array`);
}
function unique(v, label) {
  if (new Set(v).size !== v.length) fail(`${label}: duplicate values`);
}
export function validateBlock(b) {
  object(
    b,
    [
      "type",
      "text",
      "level",
      "items",
      "tex",
      "headers",
      "rows",
      "title",
      "nodes",
      "edges",
      "caption",
    ],
    "block",
  );
  const allowed = {
    paragraph: ["type", "text"],
    heading: ["type", "text", "level"],
    bullets: ["type", "items"],
    math: ["type", "tex"],
    table: ["type", "headers", "rows"],
    callout: ["type", "title", "text"],
    diagram: ["type", "nodes", "edges", "caption"],
  }[b.type];
  if (!allowed) fail("Unknown block type");
  object(b, allowed, "block");
  if (["paragraph", "heading", "callout"].includes(b.type))
    text(b.text, "block.text");
  if (
    b.type === "heading" &&
    b.level !== undefined &&
    (!Number.isInteger(b.level) || b.level < 1 || b.level > 6)
  )
    fail("Invalid heading level");
  if (b.type === "callout") text(b.title, "callout.title", 300);
  if (b.type === "math") text(b.tex, "math.tex", 8000);
  if (b.type === "bullets") {
    array(b.items, "items", 100, 1);
    b.items.forEach((x) => text(x, "item"));
  }
  if (b.type === "table") {
    array(b.headers, "headers", 8, 1);
    b.headers.forEach((x) => text(x, "header", 1000));
    array(b.rows, "rows", 300, 1);
    for (const row of b.rows) {
      array(row, "row", b.headers.length, b.headers.length);
      row.forEach((x) => text(x, "cell", 10000, true));
    }
  }
  if (b.type === "diagram") {
    array(b.nodes, "nodes", 100, 1);
    array(b.edges, "edges", 200);
    for (const n of b.nodes) {
      object(n, ["id", "label"], "node");
      id(n.id);
      text(n.label, "node.label", 1000);
    }
    unique(
      b.nodes.map((n) => n.id),
      "nodes",
    );
    const ids = new Set(b.nodes.map((n) => n.id));
    for (const e of b.edges) {
      object(e, ["from", "to", "label"], "edge");
      if (!ids.has(e.from) || !ids.has(e.to)) fail("Unknown diagram node");
      if (e.label !== undefined) text(e.label, "edge.label", 1000);
    }
    if (b.caption !== undefined) text(b.caption, "caption", 2000);
  }
  return b;
}
function blocks(v, label, min = 0) {
  array(v, label, 500, min);
  v.forEach(validateBlock);
}
export function validateChapter(c, stored = false) {
  assertSafeJson(c);
  object(
    c,
    [
      "id",
      "title",
      "order",
      "sources",
      "dependsOn",
      "notes",
      "atlas",
      "questions",
      "solutionIntro",
      "correctionReason",
      ...(stored ? ["sourceHashes", "dependencyHashes", "contentHash"] : []),
    ],
    "chapter",
  );
  if (c.correctionReason !== undefined) {
    text(c.correctionReason, "correctionReason", 2000);
    if (c.correctionReason.trim().length < 10)
      fail("correctionReason must contain at least 10 characters");
  }
  id(c.id);
  text(c.title, "chapter.title", 300);
  if (!Number.isInteger(c.order) || c.order < 0 || c.order > 100000)
    fail("Invalid chapter order");
  array(c.sources, "sources", 1000);
  for (const s of c.sources) {
    object(s, ["sourceId", "pages"], "source reference");
    id(s.sourceId);
    array(s.pages, "pages", 10000, 1);
    if (s.pages.some((p) => !Number.isInteger(p) || p < 1 || p > 100000))
      fail("Invalid page");
    unique(s.pages, "pages");
  }
  unique(
    c.sources.map((s) => s.sourceId),
    "source references",
  );
  array(c.dependsOn, "dependsOn", 1000);
  c.dependsOn.forEach((x) => id(x));
  unique(c.dependsOn, "dependsOn");
  blocks(c.notes, "notes");
  if (c.solutionIntro !== undefined) blocks(c.solutionIntro, "solutionIntro");
  array(c.atlas, "atlas", 200);
  for (const a of c.atlas) {
    object(a, ["title", "blocks"], "atlas entry");
    text(a.title, "atlas.title", 300);
    blocks(a.blocks, "atlas.blocks", 1);
  }
  array(c.questions, "questions", 1000);
  for (const q of c.questions) {
    object(
      q,
      ["id", "prompt", "solution", "marks", "mock", "minutes", "order"],
      "question",
    );
    id(q.id);
    blocks(q.prompt, "prompt", 1);
    blocks(q.solution, "solution", 1);
    for (const field of ["marks", "minutes", "order"])
      if (
        q[field] !== undefined &&
        (typeof q[field] !== "number" ||
          !Number.isFinite(q[field]) ||
          q[field] < 0 ||
          q[field] > 100000)
      )
        fail(`Invalid question ${field}`);
    if (q.mock !== undefined) text(q.mock, "question.mock", 300);
  }
  unique(
    c.questions.map((q) => q.id),
    "question IDs",
  );
  if (stored) {
    for (const k of ["sourceHashes", "dependencyHashes"]) {
      if (!c[k] || typeof c[k] !== "object" || Array.isArray(c[k]))
        fail(`Missing ${k}`);
      for (const [key, h] of Object.entries(c[k])) {
        id(key);
        text(h, k, 128);
      }
    }
    text(c.contentHash, "contentHash", 128);
  }
  return c;
}
export function validateSource(s) {
  object(
    s,
    [
      "id",
      "name",
      "kind",
      "hash",
      "pages",
      "warnings",
      "warningsAcknowledged",
      "exclusion",
      "extractedPages",
      "reviewedPages",
      "reviewReason",
      "original",
    ],
    "source",
  );
  id(s.id);
  text(s.name, "source.name", 500);
  if (
    !["slides", "quiz", "assignment", "solutions", "reference"].includes(s.kind)
  )
    fail("Invalid source kind");
  text(s.hash, "source.hash", 128);
  if (!Number.isInteger(s.pages) || s.pages < 1 || s.pages > 100000)
    fail("Invalid source page count");
  array(s.warnings, "warnings", 1000);
  s.warnings.forEach((w) => text(w, "warning", 10000));
  if (s.original !== undefined) {
    const original = s.original;
    object(
      original,
      ["type", "attachmentId", "name", "bytes", "path"],
      "source.original",
    );
    const safeText = (value, label, max) => {
      text(value, label, max);
      if (/[\u0000-\u001f\u007f]/.test(value))
        fail(`${label}: control characters forbidden`);
    };
    if (original.type === "attachment") {
      object(
        original,
        ["type", "attachmentId", "name", "bytes"],
        "attachment original",
      );
      safeText(original.attachmentId, "attachmentId", 512);
      safeText(original.name, "original.name", 500);
      if (
        !Number.isSafeInteger(original.bytes) ||
        original.bytes < 0 ||
        original.bytes > 40 * 1024 * 1024
      )
        fail("Invalid original byte count");
    } else if (original.type === "workspace") {
      object(original, ["type", "path"], "workspace original");
      safeText(original.path, "original.path", 4096);
    } else fail("Invalid original source type");
  }
  if (s.extractedPages !== undefined) {
    array(s.extractedPages, "extractedPages", 10000);
    let length = 0;
    for (const p of s.extractedPages) {
      object(p, ["page", "text"], "extracted page");
      if (!Number.isInteger(p.page) || p.page < 1 || p.page > s.pages)
        fail("Invalid extracted page index");
      text(p.text, "extracted page text", 100000, true);
      length += p.text.length;
    }
    unique(
      s.extractedPages.map((p) => p.page),
      "extracted pages",
    );
    if (length > 8000000) fail("Extracted text limit exceeded");
  }
  if (
    s.warningsAcknowledged !== undefined &&
    typeof s.warningsAcknowledged !== "boolean"
  )
    fail("Invalid warning acknowledgment");
  if (s.reviewReason !== undefined) text(s.reviewReason, "reviewReason", 2000);
  if (s.reviewedPages !== undefined) {
    array(s.reviewedPages, "reviewedPages", 100000);
    if (
      s.reviewedPages.some((p) => !Number.isInteger(p) || p < 1 || p > s.pages)
    )
      fail("Invalid reviewed page");
    unique(s.reviewedPages, "reviewedPages");
  }
  if (s.warningsAcknowledged === true || s.reviewedPages?.length)
    text(s.reviewReason, "reviewReason", 2000);
  if (s.exclusion !== undefined) {
    object(s.exclusion, ["reviewed", "reason"], "exclusion");
    if (s.exclusion.reviewed !== true) fail("Exclusion must be reviewed");
    text(s.exclusion.reason, "exclusion.reason", 2000);
  }
  return s;
}
export function validateState(s, { allowStalePages = false } = {}) {
  assertSafeJson(s);
  object(
    s,
    ["version", "course", "title", "revision", "sources", "chapters"],
    "state",
  );
  if (
    s.version !== 1 ||
    !COURSE_PATTERN.test(s.course) ||
    typeof s.course !== "string"
  )
    fail("Invalid course state");
  text(s.title, "title", 300);
  if (!Number.isSafeInteger(s.revision) || s.revision < 0)
    fail("Invalid revision");
  for (const field of ["sources", "chapters"]) {
    if (
      !s[field] ||
      typeof s[field] !== "object" ||
      Array.isArray(s[field]) ||
      Object.keys(s[field]).length > 1000
    )
      fail(`Invalid ${field}`);
  }
  for (const [key, v] of Object.entries(s.sources)) {
    validateSource(v);
    if (key !== v.id) fail("Source key mismatch");
  }
  const questionIds = new Set();
  for (const [key, c] of Object.entries(s.chapters)) {
    validateChapter(c, true);
    if (key !== c.id) fail("Chapter key mismatch");
    for (const r of c.sources) {
      if (!s.sources[r.sourceId]) fail("Unknown source reference");
      if (
        !allowStalePages &&
        r.pages.some((p) => p > s.sources[r.sourceId].pages)
      )
        fail("Source page out of range");
    }
    for (const q of c.questions) {
      if (questionIds.has(q.id)) fail("Question IDs must be globally unique");
      questionIds.add(q.id);
    }
  }
  const visiting = new Set(),
    done = new Set();
  function visit(key) {
    if (visiting.has(key)) fail("Chapter dependency cycle");
    if (done.has(key)) return;
    const c = s.chapters[key];
    if (!c) fail("Unknown chapter dependency");
    visiting.add(key);
    for (const d of c.dependsOn) visit(d);
    visiting.delete(key);
    done.add(key);
  }
  Object.keys(s.chapters).forEach(visit);
  if (Buffer.byteLength(JSON.stringify(s)) > MAX_STATE_BYTES)
    fail("State size limit exceeded");
  return s;
}
// Self-contained schemas can be nested in a tool without broken root $ref paths.
const str = (max = 10000) => ({ type: "string", minLength: 1, maxLength: max });
const ident = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$" };
const arr = (items, maxItems, minItems = 0) => ({
  type: "array",
  items,
  maxItems,
  minItems,
});
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const variant = (type, properties, required = Object.keys(properties)) =>
  obj({ type: { const: type }, ...properties }, ["type", ...required]);
export const BLOCK_SCHEMA = {
  oneOf: [
    variant("paragraph", { text: str() }),
    variant(
      "heading",
      { text: str(), level: { type: "integer", minimum: 1, maximum: 6 } },
      ["text"],
    ),
    variant("bullets", { items: arr(str(), 100, 1) }),
    variant("math", { tex: str(8000) }),
    variant("table", {
      headers: arr(str(1000), 8, 1),
      rows: arr(arr({ type: "string", maxLength: 10000 }, 8, 1), 300, 1),
    }),
    variant("callout", { title: str(300), text: str() }),
    variant(
      "diagram",
      {
        nodes: arr(obj({ id: ident, label: str(1000) }), 100, 1),
        edges: arr(
          obj({ from: ident, to: ident, label: str(1000) }, ["from", "to"]),
          200,
        ),
        caption: str(2000),
      },
      ["nodes", "edges"],
    ),
  ],
};
const blockList = (min = 0) => arr(BLOCK_SCHEMA, 500, min);
export const CHAPTER_SCHEMA = obj(
  {
    id: ident,
    title: str(300),
    order: { type: "integer", minimum: 0, maximum: 100000 },
    sources: arr(
      obj({
        sourceId: ident,
        pages: arr({ type: "integer", minimum: 1, maximum: 100000 }, 10000, 1),
      }),
      1000,
    ),
    dependsOn: arr(ident, 1000),
    notes: blockList(),
    atlas: arr(obj({ title: str(300), blocks: blockList(1) }), 200),
    questions: arr(
      obj(
        {
          id: ident,
          prompt: blockList(1),
          solution: blockList(1),
          marks: { type: "number", minimum: 0, maximum: 100000 },
          mock: str(300),
          minutes: { type: "number", minimum: 0, maximum: 100000 },
          order: { type: "number", minimum: 0, maximum: 100000 },
        },
        ["id", "prompt", "solution"],
      ),
      1000,
    ),
    solutionIntro: blockList(),
    correctionReason: {
      type: "string",
      minLength: 10,
      maxLength: 2000,
      description:
        "Required when correcting an existing question prompt or assessment metadata; explain the deliberate correction.",
    },
  },
  [
    "id",
    "title",
    "order",
    "sources",
    "dependsOn",
    "notes",
    "atlas",
    "questions",
  ],
);
