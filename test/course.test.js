import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  CourseStore,
  addSource,
  putChapter,
  summary,
  validateForExport,
} from "../src/course.js";
import {
  validateChapter,
  validateState,
  validateSource,
  validateBlock,
  BLOCK_SCHEMA,
  CHAPTER_SCHEMA,
} from "../src/schema.js";
const source = (id = "s", hash = "hash-1", pages = 1) => ({
  id,
  name: id,
  kind: "slides",
  hash,
  pages,
  warnings: [],
  extractedPages: [{ page: 1, text: "Grounded content" }],
});
const block = { type: "paragraph", text: "Explain the concept." };
const chapter = (id = "c", dependsOn = []) => ({
  id,
  title: id,
  order: 1,
  sources: [{ sourceId: "s", pages: [1] }],
  dependsOn,
  notes: [block],
  atlas: [{ title: "Overview", blocks: [block] }],
  questions: [{ id: `${id}-q1`, prompt: [block], solution: [block] }],
});
const initial = () => ({
  version: 1,
  course: "course",
  title: "Title",
  revision: 0,
  sources: {},
  chapters: {},
});
function populated() {
  const s = initial();
  addSource(s, source());
  putChapter(s, chapter());
  return s;
}
async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sea-course-"));
  t.after(async () => {
    assert.equal(path.dirname(dir), os.tmpdir());
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("block validation and discovery match renderer acceptance limits", () => {
  const math = { type: "math", tex: "x".repeat(8000) },
    table = {
      type: "table",
      headers: Array.from({ length: 8 }, (_, i) => `Column ${i}`),
      rows: [Array(8).fill("Cell")],
    },
    diagram = {
      type: "diagram",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: Array.from({ length: 200 }, () => ({ from: "a", to: "b" })),
    };
  for (const value of [math, table, diagram])
    assert.equal(validateBlock(value), value);
  assert.throws(
    () => validateBlock({ ...math, tex: math.tex + "x" }),
    /math.tex/,
  );
  assert.throws(
    () =>
      validateBlock({
        ...table,
        headers: [...table.headers, "Ninth"],
        rows: [Array(9).fill("Cell")],
      }),
    /headers/,
  );
  assert.throws(
    () =>
      validateBlock({
        ...diagram,
        edges: [...diagram.edges, { from: "a", to: "b" }],
      }),
    /edges/,
  );
  const variants = Object.fromEntries(
    BLOCK_SCHEMA.oneOf.map((v) => [v.properties.type.const, v.properties]),
  );
  assert.equal(variants.math.tex.maxLength, 8000);
  assert.equal(variants.table.headers.maxItems, 8);
  assert.equal(variants.table.rows.items.maxItems, 8);
  assert.equal(variants.diagram.edges.maxItems, 200);
  assert.equal(CHAPTER_SCHEMA.properties.notes.items, BLOCK_SCHEMA);
});
test("existing question payload corrections require a substantive explanation", () => {
  for (const field of ["prompt", "marks", "mock", "order", "minutes"]) {
    const s = populated(),
      c = chapter();
    c.questions[0][field] =
      field === "prompt"
        ? [{ type: "paragraph", text: "Corrected question" }]
        : field === "mock"
          ? "Paper B"
          : 5;
    const before = JSON.stringify(s);
    assert.throws(() => putChapter(s, c), /correctionReason/);
    assert.equal(JSON.stringify(s), before);
    c.correctionReason = "short";
    assert.throws(() => putChapter(s, c), /at least 10/);
    c.correctionReason =
      "Correct the assessment statement to match the verified source.";
    putChapter(s, c);
    assert.equal(summary(s).chapters[0].correctionReason, c.correctionReason);
    assert.equal(s.chapters.c.questions[0].id, "c-q1");
    const deepened = JSON.parse(JSON.stringify(c));
    delete deepened.correctionReason;
    deepened.questions[0].solution = [
      { type: "paragraph", text: "A more detailed worked solution." },
    ];
    putChapter(s, deepened);
    assert.equal(summary(s).chapters[0].correctionReason, c.correctionReason);
    deepened.questions[0].prompt = [
      { type: "paragraph", text: "Another silent correction" },
    ];
    assert.throws(() => putChapter(s, deepened), /correctionReason/);
  }
});
test("solution-only updates and new questions do not require correction reasons", () => {
  const s = populated(),
    c = chapter();
  c.questions[0].solution = [{ type: "paragraph", text: "Expanded solution" }];
  c.questions.push({ id: "new-q", prompt: [block], solution: [block] });
  putChapter(s, c);
  assert.equal(s.chapters.c.questions.length, 2);
  assert.equal(summary(s).chapters[0].correctionReason, undefined);
});
test("write guard denies before directory creation and checks atomic rename", async (t) => {
  const root = await workspace(t);
  const denied = new CourseStore(root, {
    beforeWrite: async () => {
      throw Error("Policy denied");
    },
  });
  await assert.rejects(denied.create("course", "Title"), /Policy denied/);
  assert.deepEqual(await fs.readdir(root), []);
  const base = new CourseStore(root);
  await base.create("course", "Title");
  const calls = [];
  const guarded = new CourseStore(root, {
    beforeWrite: async (event) => {
      calls.push(event.operation);
      if (event.operation === "state-commit")
        throw Error("Policy revoked before commit");
    },
  });
  await assert.rejects(
    guarded.transact("course", 0, (s) => {
      s.title = "Denied";
    }),
    /revoked/,
  );
  assert.equal((await base.load("course")).title, "Title");
  assert.equal((await base.load("course")).revision, 0);
  assert.ok(calls.includes("lock-open"));
  assert.ok(calls.includes("lock-write"));
  assert.ok(calls.includes("temp-open"));
  assert.ok(calls.includes("state-write"));
  assert.deepEqual(
    await fs.readdir(path.join(root, ".sea", "courses", "course")),
    ["state.json"],
  );
});
test("queued writer rechecks guard after policy changes during lock wait", async (t) => {
  const root = await workspace(t),
    base = new CourseStore(root);
  await base.create("course", "Title");
  let release, entered;
  const held = new Promise((r) => {
      release = r;
    }),
    inside = new Promise((r) => {
      entered = r;
    });
  const holder = base.locked("course", async () => {
    entered();
    await held;
  });
  await inside;
  let denied = false,
    firstOpen;
  const opening = new Promise((r) => {
    firstOpen = r;
  });
  const queued = new CourseStore(root, {
    beforeWrite: async (event) => {
      if (denied) throw Error("Policy revoked while queued");
      if (event.operation === "lock-open") firstOpen();
    },
  });
  const attempt = queued.transact("course", 0, (s) => {
    s.title = "Denied";
  });
  const rejection = assert.rejects(attempt, /Policy revoked/);
  await opening;
  denied = true;
  release();
  await holder;
  await rejection;
  assert.equal((await base.load("course")).revision, 0);
  assert.equal((await base.load("course")).title, "Title");
});
test("original source reference metadata is strict and remains metadata only", () => {
  validateSource({
    ...source(),
    original: { type: "workspace", path: "notes.txt" },
  });
  validateSource({
    ...source(),
    original: {
      type: "attachment",
      attachmentId: "upload-123",
      name: "notes.txt",
      bytes: 42,
    },
  });
  assert.throws(
    () =>
      validateSource({
        ...source(),
        original: { type: "workspace", path: "notes.txt", bytes: 1 },
      }),
    /unknown field/,
  );
  assert.throws(
    () =>
      validateSource({
        ...source(),
        original: {
          type: "attachment",
          attachmentId: "x",
          name: "bad\u0000name",
          bytes: 2,
        },
      }),
    /control/,
  );
});
test("create is idempotent, validates slug, persists, no-op revision unchanged", async (t) => {
  const store = new CourseStore(await workspace(t));
  const state = await store.create("course", "Title");
  assert.equal(state.revision, 0);
  assert.deepEqual(await store.create("course", "Title"), state);
  await assert.rejects(store.create("course", "Other"), /different title/);
  await assert.rejects(store.create("../escape", "Title"), /slug/);
  assert.deepEqual(await store.transact("course", 0, (s) => s), state);
  assert.deepEqual(await store.load("course"), state);
});
test("transactions reject conflicts and roll back errors", async (t) => {
  const store = new CourseStore(await workspace(t));
  await store.create("course", "Title");
  let s = await store.transact("course", 0, (s) => addSource(s, source()));
  assert.equal(s.revision, 1);
  await assert.rejects(
    store.transact("course", 0, (s) => s),
    { code: "REVISION_CONFLICT" },
  );
  await assert.rejects(
    store.transact("course", 1, (s) => {
      s.title = "Not saved";
      throw Error("rollback");
    }),
    /rollback/,
  );
  assert.equal((await store.load("course")).title, "Title");
  s = await store.transact("course", 1, (s) => addSource(s, source()));
  assert.equal(s.revision, 1);
});
test("cross-store optimistic writers produce exactly one winner", async (t) => {
  const root = await workspace(t),
    a = new CourseStore(root),
    b = new CourseStore(root);
  await a.create("course", "Title");
  const results = await Promise.allSettled([
    a.transact("course", 0, (s) => {
      s.title = "A";
    }),
    b.transact("course", 0, (s) => {
      s.title = "B";
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "REVISION_CONFLICT",
  );
  assert.equal((await a.load("course")).revision, 1);
});
test("cross-process writers honor the same exclusive lock", async (t) => {
  const root = await workspace(t),
    store = new CourseStore(root);
  await store.create("course", "Title");
  const moduleUrl = new URL("../src/course.js", import.meta.url).href;
  const script = `import {CourseStore} from ${JSON.stringify(moduleUrl)}; try { await new CourseStore(${JSON.stringify(root)}).transact('course',0,async s=>{await new Promise(r=>setTimeout(r,80));s.title='writer';}); } catch(e) {process.exitCode=e.code==='REVISION_CONFLICT'?3:4;}`;
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script],
        { stdio: "ignore" },
      );
      child.on("error", reject);
      child.on("exit", resolve);
    });
  const codes = await Promise.all([run(), run()]);
  assert.deepEqual(codes.sort(), [0, 3]);
  assert.equal((await store.load("course")).revision, 1);
});
test("replacement invalidates transitively, identical hashes no-op, new sources only pending", () => {
  const s = populated();
  putChapter(s, chapter("d", ["c"]));
  putChapter(s, chapter("e", ["d"]));
  addSource(s, source("new"));
  assert.ok(summary(s).chapters.every((c) => !c.stale));
  assert.equal(
    summary(s).sources.find((x) => x.id === "new").coverage,
    "pending",
  );
  addSource(s, source("s", "hash-2"));
  assert.ok(summary(s).chapters.every((c) => c.stale));
  putChapter(s, chapter());
  assert.equal(summary(s).chapters.find((c) => c.id === "c").stale, false); // provenance snapshots also participate in the chapter content hash
  assert.ok(
    summary(s)
      .chapters.filter((c) => c.id !== "c")
      .every((c) => c.stale),
  );
  putChapter(s, chapter("d", ["c"]));
  putChapter(s, chapter("e", ["d"]));
  assert.ok(summary(s).chapters.every((c) => !c.stale));
  const before = JSON.stringify(s);
  addSource(s, { ...source("s", "hash-2"), name: "ignored" });
  assert.equal(JSON.stringify(s), before);
});
test("indirect dependencies stay stale after upstream provenance refresh", () => {
  const s = populated();
  addSource(s, source("other"));
  const d = chapter("d", ["c"]);
  d.sources = [{ sourceId: "other", pages: [1] }];
  putChapter(s, d);
  addSource(s, source("s", "changed"));
  assert.equal(summary(s).chapters.find((x) => x.id === "d").stale, true);
  putChapter(s, chapter());
  assert.equal(summary(s).chapters.find((x) => x.id === "d").stale, true);
  putChapter(s, d);
  assert.equal(summary(s).chapters.find((x) => x.id === "d").stale, false);
});
test("dependency content changes stale downstream and cycles fail atomically", () => {
  const s = populated();
  putChapter(s, chapter("d", ["c"]));
  const changed = chapter();
  changed.notes = [{ type: "paragraph", text: "Changed" }];
  putChapter(s, changed);
  assert.equal(summary(s).chapters.find((c) => c.id === "d").stale, true);
  const before = JSON.stringify(s);
  assert.throws(() => putChapter(s, chapter("c", ["d"])), /cycle/);
  assert.equal(JSON.stringify(s), before);
});
test("question IDs stay unique and cannot disappear", async (t) => {
  const s = populated(),
    bad = chapter("d");
  bad.questions[0].id = "c-q1";
  assert.throws(() => putChapter(s, bad), /globally unique/);
  const missing = chapter();
  missing.questions = [];
  assert.throws(() => putChapter(s, missing), /remove existing/);
  const store = new CourseStore(await workspace(t));
  await store.create("course", "Title");
  await store.transact("course", 0, () => s);
  await assert.rejects(
    store.transact("course", 1, (s) => {
      delete s.chapters.c;
    }),
    /remove existing/,
  );
});
test("export requires page coverage and reviewed warning/exclusion decisions", () => {
  const s = populated();
  assert.equal(validateForExport(s).ok, true);
  addSource(s, source("s", "hash2", 3));
  putChapter(s, chapter());
  assert.equal(summary(s).sources[0].missingPageCount, 2);
  assert.deepEqual(summary(s).sources[0].missingPageRanges, ["2-3"]);
  assert.match(validateForExport(s).errors.join(" "), /pending coverage/);
  s.sources.s.reviewedPages = [2, 3];
  s.sources.s.reviewReason =
    "These pages contain only administrative information";
  assert.equal(validateForExport(s).ok, true);
  s.sources.s.warnings = ["OCR unavailable"];
  assert.match(validateForExport(s).errors.join(" "), /unacknowledged/);
  s.sources.s.warningsAcknowledged = true;
  assert.equal(validateForExport(s).ok, true);
  assert.equal(validateForExport(s).warnings.length, 1);
  addSource(s, source("unused"));
  s.sources.unused.exclusion = { reviewed: true, reason: "Duplicate appendix" };
  assert.equal(validateForExport(s).ok, true);
  assert.equal(validateForExport(s).warnings.length, 2);
});
test("replacement reducing page count preserves stale chapters rather than deleting IDs", () => {
  const s = initial();
  addSource(s, source("s", "a", 5));
  const c = chapter();
  c.sources[0].pages = [1, 5];
  putChapter(s, c);
  addSource(s, source("s", "b", 1));
  assert.equal(summary(s).chapters[0].stale, true);
  assert.match(validateForExport(s).errors.join(" "), /out-of-range/);
});
test("schema rejects unknown properties, prototype attacks, oversized input and malformed blocks", () => {
  assert.throws(
    () => validateChapter({ ...chapter(), stale: false }),
    /unknown field/,
  );
  assert.throws(() => validateState(JSON.parse('{"__proto__":{}}')), /Unsafe/);
  assert.throws(
    () => addSource(initial(), { ...source(), id: "constructor" }),
    /identifier/,
  );
  assert.throws(
    () => validateChapter({ ...chapter(), title: "x".repeat(301) }),
    /text/,
  );
  const c = chapter();
  c.questions[0].solution = [];
  assert.throws(() => validateChapter(c), /array/);
  assert.throws(
    () => validateSource({ ...source(), warningsAcknowledged: true }),
    /reviewReason/,
  );
  assert.throws(
    () =>
      validateSource({
        ...source(),
        reviewedPages: [2],
        reviewReason: "Reviewed",
      }),
    /reviewed page/,
  );
  c.questions[0].solution = [
    { type: "table", headers: ["A", "B"], rows: [["A"]] },
  ];
  assert.throws(() => validateChapter(c), /row/);
});
test("optional mock metadata and solution foundations validated and persisted", () => {
  const c = chapter();
  Object.assign(c.questions[0], {
    marks: 5,
    mock: "Mock A",
    minutes: 3,
    order: 0,
  });
  c.solutionIntro = [block];
  assert.equal(validateChapter(c), c);
  const s = initial();
  addSource(s, source());
  putChapter(s, c);
  assert.equal(s.chapters.c.questions[0].marks, 5);
});
test("reject symlinks in course descendants and parent directories", async (t) => {
  const root = await workspace(t),
    store = new CourseStore(root);
  await store.create("course", "Title");
  const outside = await workspace(t),
    link = path.join(root, ".sea", "courses", "course", "nested");
  try {
    await fs.symlink(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (e) {
    if (["EPERM", "EACCES"].includes(e.code)) {
      t.skip("Symlink creation unavailable");
      return;
    }
    throw e;
  }
  await assert.rejects(store.load("course"), /Symlink/);
  await assert.rejects(
    store.transact("course", 0, (s) => s),
    /Symlink/,
  );
  const other = await workspace(t);
  await fs.symlink(
    outside,
    path.join(other, ".sea"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    new CourseStore(other).create("course", "Title"),
    /Unsafe/,
  );
});
test("reject hard-linked state files and corrupt persisted metadata", async (t) => {
  const root = await workspace(t),
    store = new CourseStore(root);
  await store.create("course", "Title");
  const file = path.join(root, ".sea", "courses", "course", "state.json");
  await fs.link(file, path.join(root, "state-copy.json"));
  await assert.rejects(store.load("course"), /Unsafe/);
});
