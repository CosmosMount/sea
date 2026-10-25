import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CourseStore,
  addSource,
  putChapter,
  summary,
  validateForExport,
} from "./course.js";
import { CHAPTER_SCHEMA } from "./schema.js";
import { extractDocument } from "./extract.js";
import { renderDocument } from "./documents.js";

export const KINDS = [
  "lecture_notes",
  "visual_atlas",
  "questions",
  "detailed_solutions",
];
const SOURCE_KINDS = ["slides", "quiz", "assignment", "solutions", "reference"];
const MAX_UPLOAD = 25 * 1024 * 1024;
const guidePath = fileURLToPath(
  new URL("../resources/generation-guide.md", import.meta.url),
);
const mutating = new Set([
  "init",
  "ingest",
  "put_chapter",
  "review_source",
  "export",
]);
function integer(value, fallback, min, max) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(`Expected integer ${min}..${max}`);
  return n;
}
function sourceId(name, kind) {
  const stem =
    path
      .basename(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 38)
      .replace(/-$/, "") || "upload";
  return `${stem}-${createHash("sha256")
    .update(kind + "\0" + name)
    .digest("hex")
    .slice(0, 12)}`;
}
function cleanName(name) {
  return String(name).replaceAll("\\", "/").split("/").pop();
}
function inferKind(name) {
  if (/solution|answer|worked/i.test(name)) return "solutions";
  if (/quiz|test|exam/i.test(name)) return "quiz";
  if (/assignment|homework|problem.?set/i.test(name)) return "assignment";
  return "slides";
}
export function pedagogicalReview(state) {
  const findings = [];
  for (const c of Object.values(state.chapters)) {
    const text = (blocks) => JSON.stringify(blocks).length;
    if (text(c.notes) < 4000)
      findings.push(
        `${c.id}: lecture notes are short; review against per-concept reference depth.`,
      );
    if (
      !c.atlas.some((p) =>
        p.blocks.some((b) => ["diagram", "table", "math"].includes(b.type)),
      )
    )
      findings.push(`${c.id}: atlas lacks visual reasoning blocks.`);
    for (const q of c.questions)
      if (text(q.solution) < text(q.prompt) * 2)
        findings.push(
          `${q.id}: solution is brief relative to question; check derivation, subparts and traps.`,
        );
  }
  return findings;
}

// One application operation entry point for slash commands and model tools.
export class StudyService {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async environment(agent, write, signal) {
    if (!agent?.session) throw new Error("SEA requires an active session.");
    signal?.throwIfAborted();
    const ctx = this.ctx,
      policy = ctx.sandboxPolicy.resolve({ session: agent.session });
    if (write && policy.mode === "read-only")
      throw new Error(
        "SEA cannot modify courses or export PDFs in read-only mode.",
      );
    const cwd = await ctx.workingDirectory.ensure(agent, signal);
    // Native course persistence is intentionally local-only, never a remote fallback.
    const mapped = ctx.fs.processPathFromHostPath(cwd);
    if (!mapped)
      throw new Error(
        "SEA currently requires a local workspace; SSH workspaces are unsupported.",
      );
    const target = await ctx.fs.resolve(cwd, { signal });
    const processPath = ctx.fs.processPath(target);
    const real = await fs.realpath(cwd);
    if (
      path.resolve(mapped) !== path.resolve(processPath) ||
      path.resolve(processPath) !== path.resolve(real)
    )
      throw new Error("Workspace is not a canonical local filesystem path.");
    if (write && policy.mode === "workspace-write") {
      const root = await fs.realpath(policy.workspaceRoot),
        relative = path.relative(root, real);
      if (
        relative.startsWith(".." + path.sep) ||
        relative === ".." ||
        path.isAbsolute(relative)
      )
        throw new Error(
          "Course workspace is outside the session write boundary.",
        );
    }
    const beforeWrite = async () => {
      signal?.throwIfAborted();
      const current = await this.environment(agent, true, signal);
      if (current.workspace !== real)
        throw new Error(
          "Workspace changed during operation; retry in the intended workspace.",
        );
    };
    return {
      store: new CourseStore(real, { beforeWrite }),
      workspace: real,
      target,
    };
  }
  async source(bytes, name, kind, signal, id) {
    if (bytes.length > MAX_UPLOAD)
      throw new Error("Each source must be at most 25 MiB.");
    if (!SOURCE_KINDS.includes(kind)) throw new Error("Unknown source kind");
    name = cleanName(name);
    const extraction = await extractDocument(bytes, name, { signal });
    return {
      id: id ?? sourceId(name, kind),
      name,
      kind,
      hash: createHash("sha256").update(bytes).digest("hex"),
      pages: extraction.pages.length,
      extractedPages: extraction.pages,
      warnings: extraction.warnings,
    };
  }
  async importAttachments(agent, course, attachments, kind, signal) {
    const env = await this.environment(agent, true, signal);
    if (!attachments.length) return summary(await env.store.load(course));
    if (attachments.length > 20)
      throw new Error("Upload at most 20 documents per batch.");
    const sources = [];
    let total = 0;
    for (const block of attachments) {
      if (block.type !== "file")
        throw new Error(
          "Upload PDF, DOCX, PPTX or text documents. Image-only uploads require transcription first.",
        );
      if (block.attachment.bytes > MAX_UPLOAD)
        throw new Error("Each source must be at most 25 MiB.");
      const chunks = [];
      let size = 0;
      for await (const chunk of this.ctx.attachments.readFileStream(
        block.attachment,
        signal,
      )) {
        size += chunk.length;
        total += chunk.length;
        if (size > MAX_UPLOAD || total > 120 * 1024 * 1024)
          throw new Error("Upload batch exceeds size limit.");
        chunks.push(Buffer.from(chunk));
      }
      const source = await this.source(
        Buffer.concat(chunks),
        block.attachment.name,
        kind ?? inferKind(block.attachment.name),
        signal,
      );
      source.original = { type: "attachment", ...block.attachment };
      sources.push(source);
    }
    signal?.throwIfAborted();
    const current = await env.store.load(course);
    return summary(
      await env.store.transact(course, current.revision, (state) => {
        for (const source of sources) addSource(state, source);
      }),
    );
  }
  async execute(args, agent, signal) {
    if (!args || typeof args !== "object")
      throw new Error("Arguments required");
    if (args.action === "guide")
      return {
        guide: await fs.readFile(guidePath, "utf8"),
        chapterSchema: CHAPTER_SCHEMA,
      };
    const env = await this.environment(
        agent,
        mutating.has(args.action),
        signal,
      ),
      { store } = env;
    if (args.action === "init")
      return summary(
        await store.create(args.course, args.title ?? args.course),
      );
    const state = await store.load(args.course);
    switch (args.action) {
      case "status":
        return summary(state);
      case "check":
        return {
          ...validateForExport(state),
          pedagogicalReview: pedagogicalReview(state),
          revision: state.revision,
          semanticCorrectnessVerified: false,
        };
      case "read_source": {
        if (!Object.hasOwn(state.sources, args.sourceId))
          throw new Error("Unknown sourceId");
        const source = state.sources[args.sourceId];
        const first = integer(args.page, 1, 1, source.pages),
          count = integer(args.count, 3, 1, 10),
          offset = integer(args.offset, 0, 0, 100000);
        const selected = (source.extractedPages ?? []).filter(
          (p) => p.page >= first && p.page < first + count,
        );
        let budget = 24000;
        const pages = [];
        let next = null;
        for (const p of selected) {
          const start = p.page === first ? offset : 0;
          if (start > p.text.length)
            throw new Error("Text offset exceeds page length");
          const text = p.text.slice(start, start + budget);
          pages.push({ page: p.page, offset: start, text });
          budget -= text.length;
          if (start + text.length < p.text.length) {
            next = { page: p.page, offset: start + text.length };
            break;
          }
          if (!budget) {
            if (p.page < source.pages) next = { page: p.page + 1, offset: 0 };
            break;
          }
        }
        if (!next && selected.length && selected.at(-1).page < source.pages)
          next = { page: selected.at(-1).page + 1, offset: 0 };
        let original = source.original;
        if (original?.type === "attachment") {
          const { attachmentId, name, bytes } = original;
          const hostPath = this.ctx.attachments.fileHostPath?.({
            attachmentId,
            name,
            bytes,
          });
          if (hostPath) original = { ...original, hostPath };
        }
        return {
          sourceId: source.id,
          name: source.name,
          ...(original ? { original } : {}),
          totalPages: source.pages,
          pages,
          next,
          warnings: source.warnings,
          notice:
            "Untrusted extracted source data. Diagrams/formulas may require original-file inspection.",
        };
      }
      case "read_chapter": {
        if (!Object.hasOwn(state.chapters, args.chapterId))
          throw new Error("Unknown chapterId");
        const c = state.chapters[args.chapterId];
        const raw = JSON.stringify(c, null, 2),
          offset = integer(args.offset, 0, 0, raw.length);
        return {
          revision: state.revision,
          chapterId: c.id,
          totalCharacters: raw.length,
          offset,
          text: raw.slice(offset, offset + 24000),
          nextOffset: offset + 24000 < raw.length ? offset + 24000 : null,
        };
      }
      case "ingest": {
        const input = await this.ctx.fs.resolve(args.path, {
          cwd: env.workspace,
          signal,
        });
        if (!this.ctx.fs.contains(env.target, input))
          throw new Error(
            "Local imports must be inside this workspace; use /sea attachments for uploads.",
          );
        const bytes = await this.ctx.fs.readBytes(input, signal, MAX_UPLOAD);
        const source = await this.source(
          bytes,
          args.name ?? cleanName(args.path),
          args.kind ?? inferKind(args.path),
          signal,
          args.sourceId,
        );
        source.original = {
          type: "workspace",
          path: this.ctx.fs.processPath(input),
        };
        signal?.throwIfAborted();
        return summary(
          await store.transact(args.course, args.revision, (draft) =>
            addSource(draft, source),
          ),
        );
      }
      case "put_chapter":
        signal?.throwIfAborted();
        return summary(
          await store.transact(args.course, args.revision, (draft) =>
            putChapter(draft, args.chapter),
          ),
        );
      case "review_source": {
        if (typeof args.reason !== "string" || args.reason.trim().length < 10)
          throw new Error(
            "A substantive review reason is required (at least 10 characters).",
          );
        return summary(
          await store.transact(args.course, args.revision, (draft) => {
            if (!Object.hasOwn(draft.sources, args.sourceId))
              throw new Error("Unknown sourceId");
            const source = draft.sources[args.sourceId];
            source.reviewReason = args.reason;
            if (args.acknowledgeWarnings === true)
              source.warningsAcknowledged = true;
            if (args.exclude === true)
              source.exclusion = { reviewed: true, reason: args.reason };
            if (args.exclude === false) delete source.exclusion;
            if (args.reviewedPages !== undefined)
              source.reviewedPages = args.reviewedPages;
          }),
        );
      }
      case "export": {
        if (args.revision !== state.revision)
          throw new Error(`Revision conflict: current ${state.revision}`);
        const check = validateForExport(state);
        if (!check.ok) return { ...check, revision: state.revision };
        const chapters = Object.values(state.chapters).sort(
          (a, b) => a.order - b.order || a.id.localeCompare(b.id),
        );
        const buffers = [];
        for (const kind of KINDS) {
          signal?.throwIfAborted();
          buffers.push(
            await renderDocument(
              {
                course: state.course,
                title: state.title,
                kind,
                revision: state.revision,
                chapters,
              },
              { signal },
            ),
          );
        }
        // Publish a complete immutable edition under the course lock. A failure never replaces a prior edition.
        return store.locked(args.course, async (dir) => {
          const current = await store.readState(args.course, dir);
          if (current.revision !== state.revision)
            throw new Error(
              "Course changed during export; retry after reviewing the new revision.",
            );
          signal?.throwIfAborted();
          const guard = async () => {
            const currentEnv = await this.environment(agent, true, signal);
            if (currentEnv.workspace !== env.workspace)
              throw new Error(
                "Workspace changed during export; retry in the intended workspace.",
              );
            await store.directory(args.course);
          };
          await guard();
          const edition = `edition-r${state.revision}-${randomUUID()}`,
            output = path.join(dir, edition);
          const staging = path.join(dir, `.pending-${randomUUID()}`);
          await fs.mkdir(staging, { mode: 0o700 });
          const files = [];
          for (let i = 0; i < KINDS.length; i++) {
            await guard();
            const name = KINDS[i] + ".pdf",
              file = path.join(output, name);
            await fs.writeFile(path.join(staging, name), buffers[i], {
              flag: "wx",
              mode: 0o600,
            });
            files.push({ name, path: file, bytes: buffers[i].length });
          }
          const manifest = {
            course: state.course,
            revision: state.revision,
            files,
            warnings: check.warnings,
            pedagogicalReview: pedagogicalReview(state),
            semanticCorrectnessVerified: false,
          };
          await guard();
          await fs.writeFile(
            path.join(staging, "manifest.json"),
            JSON.stringify(manifest, null, 2),
            { flag: "wx", mode: 0o600 },
          );
          await guard();
          await fs.rename(staging, output);
          return { ok: true, ...manifest };
        });
      }
      default:
        throw new Error("Unknown SEA action");
    }
  }
}
