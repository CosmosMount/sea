import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  COURSE_PATTERN,
  MAX_STATE_BYTES,
  assertSafeJson,
  validateChapter,
  validateSource,
  validateState,
  text,
} from "./schema.js";

const own = (o, k) => Object.hasOwn(o, k);
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export function chapterContentHash(c) {
  const { contentHash, ...content } = c;
  return createHash("sha256").update(canonical(content)).digest("hex");
}
function clone(v) {
  assertSafeJson(v);
  return JSON.parse(JSON.stringify(v));
}
function courseId(course) {
  if (typeof course !== "string" || !COURSE_PATTERN.test(course))
    throw new Error("Invalid course slug");
}
export function addSource(state, input) {
  assertSafeJson(input);
  const source = clone({ ...input, warnings: input.warnings ?? [] });
  validateSource(source);
  const previous = own(state.sources, source.id)
    ? state.sources[source.id]
    : null;
  if (previous?.hash === source.hash) return state;
  const candidate = clone(state);
  candidate.sources[source.id] = source;
  // Changed source page counts may invalidate old references. Keep those chapters to
  // preserve question IDs; export reports their stale snapshots and invalid pages.
  validateState(candidate, { allowStalePages: true });
  state.sources[source.id] = source;
  return state;
}
export function putChapter(state, input) {
  validateChapter(input);
  const c = clone(input),
    previous = state.chapters[c.id];
  if (previous) {
    const nextById = new Map(c.questions.map((q) => [q.id, q]));
    for (const question of previous.questions) {
      const next = nextById.get(question.id);
      if (!next) throw new Error("Cannot remove existing question IDs");
      const { solution: oldSolution, ...oldPayload } = question,
        { solution: newSolution, ...newPayload } = next;
      if (
        canonical(oldPayload) !== canonical(newPayload) &&
        (!c.correctionReason || c.correctionReason.trim().length < 10)
      )
        throw new Error(
          `Question ${question.id} changed: provide a substantive correctionReason (at least 10 characters)`,
        );
    }
    // Keep the last documented correction visible when only solutions are deepened.
    if (
      c.correctionReason === undefined &&
      previous.correctionReason !== undefined
    )
      c.correctionReason = previous.correctionReason;
  }
  c.sourceHashes = {};
  for (const ref of c.sources) {
    const source = state.sources[ref.sourceId];
    if (!source) throw new Error(`Unknown source ${ref.sourceId}`);
    if (ref.pages.some((p) => p > source.pages))
      throw new Error("Source page out of range");
    c.sourceHashes[ref.sourceId] = source.hash;
  }
  c.dependencyHashes = {};
  for (const dep of c.dependsOn) {
    if (!state.chapters[dep])
      throw new Error(`Unknown chapter dependency ${dep}`);
    c.dependencyHashes[dep] = chapterContentHash(state.chapters[dep]);
  }
  c.contentHash = chapterContentHash(c);
  const candidate = clone(state);
  candidate.chapters[c.id] = c;
  validateState(candidate, { allowStalePages: true });
  state.chapters[c.id] = c;
  return state;
}
export function chapterStatus(state) {
  const result = {},
    visiting = new Set();
  function visit(key) {
    if (own(result, key)) return result[key];
    if (visiting.has(key))
      return { stale: true, reasons: ["Dependency cycle"] };
    const c = state.chapters[key];
    if (!c) return { stale: true, reasons: ["Missing chapter"] };
    visiting.add(key);
    const reasons = [];
    if (c.contentHash !== chapterContentHash(c))
      reasons.push("Chapter content hash mismatch");
    for (const ref of c.sources)
      if (
        !state.sources[ref.sourceId] ||
        c.sourceHashes?.[ref.sourceId] !== state.sources[ref.sourceId].hash
      )
        reasons.push(`Source changed: ${ref.sourceId}`);
    for (const dep of c.dependsOn) {
      if (
        !state.chapters[dep] ||
        c.dependencyHashes?.[dep] !== chapterContentHash(state.chapters[dep]) ||
        visit(dep).stale
      )
        reasons.push(`Dependency changed: ${dep}`);
    }
    visiting.delete(key);
    return (result[key] = { stale: reasons.length > 0, reasons });
  }
  Object.keys(state.chapters).forEach(visit);
  return result;
}
export function sourceCoverage(state, sourceId) {
  const s = state.sources[sourceId],
    covered = new Set(s.reviewedPages ?? []);
  for (const c of Object.values(state.chapters))
    for (const r of c.sources)
      if (r.sourceId === sourceId)
        for (const page of r.pages) covered.add(page);
  const missing = [];
  if (!s.exclusion?.reviewed)
    for (let page = 1; page <= s.pages; page++)
      if (!covered.has(page)) missing.push(page);
  const ranges = [];
  for (let i = 0; i < missing.length; ) {
    const start = missing[i];
    let end = start;
    while (i + 1 < missing.length && missing[i + 1] === end + 1)
      end = missing[++i];
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    i++;
  }
  return {
    coverage: s.exclusion?.reviewed
      ? "excluded"
      : missing.length
        ? "pending"
        : "covered",
    missingPageCount: missing.length,
    missingPageRanges: ranges.slice(0, 30),
    missingRangesTruncated: ranges.length > 30,
  };
}
export function summary(state) {
  const status = chapterStatus(state),
    covered = new Set(
      Object.values(state.chapters).flatMap((c) =>
        c.sources.map((s) => s.sourceId),
      ),
    );
  return {
    course: state.course,
    title: state.title,
    revision: state.revision,
    sources: Object.values(state.sources).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      hash: s.hash,
      pages: s.pages,
      warnings: s.warnings,
      warningsAcknowledged: s.warningsAcknowledged === true,
      ...sourceCoverage(state, s.id),
      ...(s.exclusion ? { exclusion: s.exclusion } : {}),
    })),
    chapters: Object.values(state.chapters)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        title: c.title,
        order: c.order,
        questionIds: c.questions.map((q) => q.id),
        ...(c.correctionReason !== undefined
          ? { correctionReason: c.correctionReason }
          : {}),
        ...status[c.id],
      })),
  };
}
export function validateForExport(state) {
  const errors = [],
    warnings = [];
  try {
    validateState(state, { allowStalePages: true });
  } catch (e) {
    return { ok: false, errors: [e.message], warnings };
  }
  const status = chapterStatus(state),
    covered = new Set();
  if (!Object.keys(state.sources).length) errors.push("Course has no sources");
  if (!Object.keys(state.chapters).length)
    errors.push("Course has no chapters");
  for (const c of Object.values(state.chapters)) {
    if (status[c.id].stale)
      errors.push(
        `Chapter ${c.id} is stale: ${status[c.id].reasons.join("; ")}`,
      );
    if (!c.sources.length)
      errors.push(`Chapter ${c.id} has no source references`);
    if (!c.notes.length) errors.push(`Chapter ${c.id} has no lecture notes`);
    if (!c.atlas.length) errors.push(`Chapter ${c.id} has no visual atlas`);
    if (!c.questions.length)
      errors.push(`Chapter ${c.id} has no paired questions and solutions`);
    for (const r of c.sources) {
      covered.add(r.sourceId);
      if (r.pages.some((p) => p > state.sources[r.sourceId].pages))
        errors.push(
          `Chapter ${c.id} references out-of-range pages for ${r.sourceId}`,
        );
    }
  }
  for (const s of Object.values(state.sources)) {
    const coverage = sourceCoverage(state, s.id);
    if (coverage.missingPageCount)
      errors.push(
        `Source ${s.id} has pending coverage: ${coverage.missingPageCount} pages (${coverage.missingPageRanges.join(", ")}${coverage.missingRangesTruncated ? ", …" : ""})`,
      );
    if (s.exclusion?.reviewed)
      warnings.push(`Source ${s.id} reviewed exclusion: ${s.exclusion.reason}`);
    for (const warning of s.warnings)
      warnings.push(`Source ${s.id}: ${warning}`);
    if (s.warnings.length && !s.warningsAcknowledged)
      errors.push(`Source ${s.id} has unacknowledged extraction warnings`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

async function lstatOptional(file) {
  try {
    return await fs.lstat(file);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function checkDirectory(
  dir,
  create = false,
  beforeWrite = async () => {},
) {
  let st = await lstatOptional(dir);
  if (!st && create) {
    await beforeWrite({ operation: "mkdir", path: dir });
    try {
      await fs.mkdir(dir);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    st = await fs.lstat(dir);
  }
  if (!st || st.isSymbolicLink() || !st.isDirectory())
    throw new Error(`Unsafe or missing directory: ${dir}`);
}
async function scan(dir, budget = { n: 0 }) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (++budget.n > 10000)
      throw new Error("Course directory entry limit exceeded");
    const file = path.join(dir, entry.name),
      st = await lstatOptional(file);
    if (!st) continue;
    if (st.isSymbolicLink()) throw new Error(`Symlink forbidden: ${file}`);
    if (st.isDirectory()) await scan(file, budget);
    else if (!st.isFile() || st.nlink > 1)
      throw new Error(`Unsafe file: ${file}`);
  }
}
export class CourseStore {
  constructor(workspace, { beforeWrite = async () => {} } = {}) {
    if (typeof workspace !== "string" || !workspace)
      throw new Error("Workspace required");
    if (typeof beforeWrite !== "function")
      throw new Error("beforeWrite must be a function");
    this.workspace = path.resolve(workspace);
    this.beforeWrite = beforeWrite;
  }
  async directory(course, create = false) {
    courseId(course);
    await checkDirectory(this.workspace);
    let current = this.workspace;
    for (const component of [".sea", "courses", course]) {
      current = path.join(current, component);
      await checkDirectory(current, create, this.beforeWrite);
    }
    await scan(current);
    return current;
  }
  async readState(course, dir) {
    const file = path.join(dir, "state.json"),
      st = await fs.lstat(file);
    if (
      st.isSymbolicLink() ||
      !st.isFile() ||
      st.nlink > 1 ||
      st.size > MAX_STATE_BYTES
    )
      throw new Error("Unsafe or oversized state file");
    const handle = await fs.open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const opened = await handle.stat();
      if (
        opened.ino !== st.ino ||
        opened.dev !== st.dev ||
        opened.size > MAX_STATE_BYTES
      )
        throw new Error("State changed during open");
      const buffer = Buffer.alloc(opened.size + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          total,
          buffer.length - total,
          total,
        );
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > MAX_STATE_BYTES || total !== opened.size)
        throw new Error("State changed during read");
      const state = JSON.parse(buffer.subarray(0, total).toString("utf8"));
      validateState(state, { allowStalePages: true });
      if (state.course !== course) throw new Error("Course identity mismatch");
      return state;
    } finally {
      await handle.close();
    }
  }
  async load(course) {
    return this.readState(course, await this.directory(course));
  }
  async locked(course, fn) {
    courseId(course);
    await this.beforeWrite({ operation: "lock", path: this.workspace });
    const dir = await this.directory(course, true),
      lock = path.join(dir, ".lock");
    let handle;
    const deadline = Date.now() + 5000;
    while (!handle) {
      await this.directory(course);
      await this.beforeWrite({ operation: "lock-open", path: lock });
      try {
        handle = await fs.open(lock, "wx", 0o600);
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const st = await lstatOptional(lock);
        if (!st) continue;
        if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1)
          throw new Error("Unsafe lock file");
        if (Date.now() >= deadline)
          throw new Error(
            "Course locked; if its writer crashed, an administrator must remove the abandoned .lock",
          );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const identity = await handle.stat();
    try {
      await this.beforeWrite({ operation: "lock-write", path: lock });
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token: randomUUID() }),
      );
      await handle.sync();
      await this.directory(course);
      return await fn(dir);
    } finally {
      await handle.close();
      const st = await lstatOptional(lock);
      if (
        st &&
        !st.isSymbolicLink() &&
        st.ino === identity.ino &&
        st.dev === identity.dev
      )
        await fs.unlink(lock);
    }
  }
  async writeState(course, dir, state) {
    validateState(state, { allowStalePages: true });
    await this.directory(course);
    const temp = path.join(dir, `.state-${randomUUID()}.tmp`),
      target = path.join(dir, "state.json");
    await this.beforeWrite({ operation: "temp-open", path: temp });
    const handle = await fs.open(temp, "wx", 0o600);
    let renamed = false;
    try {
      await this.beforeWrite({ operation: "state-write", path: temp });
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
      await handle.close();
      await this.directory(course);
      const st = await lstatOptional(target);
      if (st && (st.isSymbolicLink() || !st.isFile() || st.nlink > 1))
        throw new Error("Unsafe state target");
      await this.beforeWrite({ operation: "state-commit", path: target });
      await fs.rename(temp, target);
      renamed = true;
      // POSIX directory fsync makes the rename durable; Windows disallows directory handles.
      if (process.platform !== "win32") {
        const d = await fs.open(dir, "r");
        try {
          await d.sync();
        } finally {
          await d.close();
        }
      }
    } finally {
      await handle.close().catch(() => {});
      if (!renamed) {
        const st = await lstatOptional(temp);
        if (st && !st.isSymbolicLink()) await fs.unlink(temp);
      }
    }
  }
  async create(course, title) {
    courseId(course);
    text(title, "title", 300);
    return this.locked(course, async (dir) => {
      const st = await lstatOptional(path.join(dir, "state.json"));
      if (st) {
        const state = await this.readState(course, dir);
        if (state.title !== title)
          throw new Error("Course already exists with a different title");
        return state;
      }
      const state = {
        version: 1,
        course,
        title,
        revision: 0,
        sources: {},
        chapters: {},
      };
      await this.writeState(course, dir, state);
      return state;
    });
  }
  async transact(course, expectedRevision, mutate) {
    courseId(course);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error("Expected revision required");
    if (typeof mutate !== "function") throw new Error("Mutator required");
    return this.locked(course, async (dir) => {
      const before = await this.readState(course, dir);
      if (before.revision !== expectedRevision) {
        const e = new Error(
          `Revision conflict: expected ${expectedRevision}, current ${before.revision}`,
        );
        e.code = "REVISION_CONFLICT";
        e.currentRevision = before.revision;
        throw e;
      }
      const draft = clone(before),
        result = await mutate(draft),
        after = result === undefined ? draft : result;
      validateState(after, { allowStalePages: true });
      if (
        after.course !== before.course ||
        after.version !== before.version ||
        after.revision !== before.revision
      )
        throw new Error("Cannot mutate course identity or revision");
      const priorIds = new Set(
          Object.values(before.chapters).flatMap((c) =>
            c.questions.map((q) => q.id),
          ),
        ),
        nextIds = new Set(
          Object.values(after.chapters).flatMap((c) =>
            c.questions.map((q) => q.id),
          ),
        );
      for (const q of priorIds)
        if (!nextIds.has(q))
          throw new Error("Cannot remove existing question IDs");
      if (canonical(before) === canonical(after)) return before;
      after.revision = before.revision + 1;
      await this.writeState(course, dir, after);
      return after;
    });
  }
}
