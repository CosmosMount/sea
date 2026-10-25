import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { StudyService } from "../src/service.js";
import { apply } from "../index.js";

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sea-service-")),
  );
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const registrations = { tools: [], commands: [], prompts: [] },
    cleanups = [],
    followups = [];
  let policy = { mode: "workspace-write", workspaceRoot: root },
    remote = false;
  const ctx = {
    sandboxPolicy: { resolve: () => policy },
    workingDirectory: { ensure: async () => root },
    fs: {
      processPathFromHostPath: (p) => (remote ? null : p),
      resolve: async (p, { cwd = root } = {}) => ({
        path: path.resolve(cwd, p),
      }),
      processPath: (t) => t.path,
      contains: (a, b) => {
        const rel = path.relative(a.path, b.path);
        return (
          !rel.startsWith(".." + path.sep) &&
          rel !== ".." &&
          !path.isAbsolute(rel)
        );
      },
      readBytes: async (target, _signal, max) => {
        const bytes = await fs.readFile(target.path);
        if (bytes.length > max) throw Error("Input exceeds limit");
        return bytes;
      },
    },
    attachments: {
      async *readFileStream(attachment) {
        yield Buffer.from(attachment.content);
      },
    },
    tools: {
      register: (value) => {
        registrations.tools.push(value);
        return () =>
          registrations.tools.splice(registrations.tools.indexOf(value), 1);
      },
    },
    commands: {
      register: (value) => {
        registrations.commands.push(value);
        return () =>
          registrations.commands.splice(
            registrations.commands.indexOf(value),
            1,
          );
      },
    },
    systemPrompt: {
      section: (value) => {
        registrations.prompts.push(value);
        return () =>
          registrations.prompts.splice(registrations.prompts.indexOf(value), 1);
      },
    },
    effect: (callback) => cleanups.push(callback()),
  };
  const agent = {
    session: { id: "integration" },
    followup: async (value) => followups.push(value),
  };
  return {
    root,
    ctx,
    agent,
    service: new StudyService(ctx),
    registrations,
    followups,
    dispose: () => cleanups.reverse().forEach((fn) => fn()),
    setPolicy: (p) => (policy = p),
    setRemote: (v) => (remote = v),
  };
}
const para = (text) => ({ type: "paragraph", text });
function chapter(sourceId) {
  return {
    id: "basics",
    title: "Foundations of Counting",
    order: 0,
    sources: [{ sourceId, pages: [1] }],
    dependsOn: [],
    notes: [
      para(
        "A finite sample space lists every possible outcome. For equally likely outcomes, divide favorable outcomes by the total. State assumptions before applying this rule.",
      ),
    ],
    atlas: [
      {
        title: "Counting decision table",
        blocks: [
          {
            type: "table",
            headers: ["Condition", "Method"],
            rows: [
              ["Equally likely", "Count outcomes"],
              ["Unequal probabilities", "Sum probabilities"],
            ],
          },
        ],
      },
    ],
    questions: [
      {
        id: "Q-001",
        marks: 3,
        mock: "Paper A",
        minutes: 4,
        order: 1,
        prompt: [
          para(
            "A fair die has six numbered faces. What is the probability of an even result?",
          ),
        ],
        solution: [
          para(
            "The sample space is {1,2,3,4,5,6}. The favorable outcomes are {2,4,6}. All six outcomes are equally likely, so P(even)=3/6=1/2. A common error is to count only the number 2 as even; instead test divisibility by two. The complementary odd outcomes also number three, confirming the result.",
          ),
        ],
      },
    ],
    solutionIntro: [
      para(
        "This answer key uses finite sample spaces and explicitly states the equally likely assumption.",
      ),
    ],
  };
}
const attachment = (name, content) => {
  const value = {
    type: "file",
    attachment: {
      attachmentId: `upload-${name}`,
      name,
      bytes: Buffer.byteLength(content),
    },
  };
  Object.defineProperty(value.attachment, "content", {
    value: content,
    enumerable: false,
  });
  return value;
};
const exec = (f, args) =>
  f.service.execute({ course: "probability", ...args }, f.agent);

test("service performs init, incremental ingest, bounded reads, review, check and four-PDF export", async (t) => {
  const f = await fixture(t);
  let state = await exec(f, { action: "init", title: "Probability" });
  assert.equal(state.revision, 0);
  await fs.writeFile(
    path.join(f.root, "lecture.txt"),
    "A".repeat(30000) + "\fAdministrative cover",
  );
  state = await exec(f, {
    action: "ingest",
    path: "lecture.txt",
    kind: "slides",
    revision: 0,
  });
  const sourceId = state.sources[0].id;
  assert.equal(state.revision, 1);
  assert.equal(state.sources[0].missingPageCount, 2);
  const first = await exec(f, {
    action: "read_source",
    sourceId,
    page: 1,
    count: 2,
  });
  assert.equal(first.pages[0].text.length, 24000);
  assert.deepEqual(first.next, { page: 1, offset: 24000 });
  const next = await exec(f, {
    action: "read_source",
    sourceId,
    ...first.next,
    count: 2,
  });
  assert.equal(next.pages[0].text.length, 6000);
  assert.equal(next.pages[1].text, "Administrative cover");
  assert.equal(next.next, null);
  state = await exec(f, {
    action: "put_chapter",
    revision: 1,
    chapter: chapter(sourceId),
  });
  assert.equal(state.revision, 2);
  assert.equal((await exec(f, { action: "check" })).ok, false);
  state = await exec(f, {
    action: "review_source",
    revision: 2,
    sourceId,
    reviewedPages: [2],
    reason:
      "Page two is the administrative cover and has no instructional content.",
  });
  assert.equal(state.sources[0].coverage, "covered");
  const check = await exec(f, { action: "check" });
  assert.equal(check.ok, true);
  assert.equal(check.semanticCorrectnessVerified, false);
  assert.ok(check.pedagogicalReview.length > 0);
  const read = await exec(f, { action: "read_chapter", chapterId: "basics" });
  assert.equal(JSON.parse(read.text).questions[0].id, "Q-001");
  const result = await exec(f, { action: "export", revision: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 4);
  assert.equal(result.semanticCorrectnessVerified, false);
  for (const file of result.files) {
    assert.ok(file.path.startsWith(f.root + path.sep));
    const bytes = await fs.readFile(file.path);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(bytes.length > 1000);
  }
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(path.dirname(result.files[0].path), "manifest.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.revision, 3);
  const repeated = await exec(f, { action: "export", revision: 3 });
  assert.notEqual(
    path.dirname(result.files[0].path),
    path.dirname(repeated.files[0].path),
  );
  assert.equal((await exec(f, { action: "status" })).revision, 3);
});

test("service warns on empty extraction, requires reviewed acknowledgment and reports exclusions", async (t) => {
  const f = await fixture(t);
  await exec(f, { action: "init" });
  await fs.writeFile(path.join(f.root, "empty.txt"), "   ");
  let state = await exec(f, {
    action: "ingest",
    path: "empty.txt",
    revision: 0,
  });
  const sourceId = state.sources[0].id;
  assert.ok(state.sources[0].warnings.length);
  assert.ok(
    (await exec(f, { action: "check" })).errors.some((e) =>
      /unacknowledged/.test(e),
    ),
  );
  await assert.rejects(
    exec(f, {
      action: "review_source",
      revision: 1,
      sourceId,
      acknowledgeWarnings: true,
      reason: "yes",
    }),
    /substantive/,
  );
  state = await exec(f, {
    action: "review_source",
    revision: 1,
    sourceId,
    acknowledgeWarnings: true,
    exclude: true,
    reason:
      "Original document verified blank and deliberately excluded from course coverage.",
  });
  assert.equal(state.sources[0].warningsAcknowledged, true);
  assert.equal(state.sources[0].coverage, "excluded");
  const check = await exec(f, { action: "check" });
  assert.ok(check.warnings.some((w) => /no extractable/.test(w)));
  assert.ok(check.warnings.some((w) => /exclusion/.test(w)));
  assert.ok(
    !check.errors.some((e) => /unacknowledged|pending coverage/.test(e)),
  );
});

test("service replacement stales chapters, rejects outdated revisions and preserves original edition", async (t) => {
  const f = await fixture(t);
  await exec(f, { action: "init" });
  const file = path.join(f.root, "notes.txt");
  await fs.writeFile(file, "Original");
  let state = await exec(f, {
    action: "ingest",
    path: "notes.txt",
    revision: 0,
  });
  const sourceId = state.sources[0].id;
  state = await exec(f, {
    action: "put_chapter",
    revision: 1,
    chapter: chapter(sourceId),
  });
  const original = await exec(f, { action: "export", revision: 2 });
  assert.equal(original.ok, true);
  await fs.writeFile(file, "Revised");
  state = await exec(f, {
    action: "ingest",
    path: "notes.txt",
    sourceId,
    revision: 2,
  });
  assert.equal(state.chapters[0].stale, true);
  await assert.rejects(
    exec(f, { action: "export", revision: 2 }),
    /Revision conflict/,
  );
  assert.equal((await exec(f, { action: "export", revision: 3 })).ok, false);
  await assert.rejects(
    exec(f, { action: "put_chapter", revision: 2, chapter: chapter(sourceId) }),
    { code: "REVISION_CONFLICT" },
  );
  for (const item of original.files)
    assert.ok((await fs.stat(item.path)).size > 1000);
});

test("service denies read-only mutation, remote paths, escaped imports and outside workspace roots", async (t) => {
  const f = await fixture(t);
  await exec(f, { action: "init" });
  f.setPolicy({ mode: "read-only", workspaceRoot: f.root });
  assert.equal((await exec(f, { action: "status" })).course, "probability");
  for (const action of [
    "init",
    "ingest",
    "put_chapter",
    "review_source",
    "export",
  ])
    await assert.rejects(exec(f, { action, revision: 0 }), /read-only/);
  f.setPolicy({ mode: "workspace-write", workspaceRoot: f.root });
  await assert.rejects(
    exec(f, { action: "ingest", path: "../outside.txt", revision: 0 }),
    /inside this workspace/,
  );
  const other = await fs.mkdtemp(path.join(os.tmpdir(), "sea-other-"));
  t.after(async () => {
    assert.equal(path.dirname(other), os.tmpdir());
    await fs.rm(other, { recursive: true, force: true });
  });
  f.setPolicy({ mode: "workspace-write", workspaceRoot: other });
  await assert.rejects(
    exec(f, { action: "init" }),
    /outside the session write boundary/,
  );
  f.setRemote(true);
  await assert.rejects(exec(f, { action: "status" }), /local workspace/);
  await assert.rejects(
    f.service.execute({ action: "status", course: "probability" }, {}),
    /active session/,
  );
});

test("plugin registration has deterministic effect cleanup and tool dispatch", async (t) => {
  const f = await fixture(t);
  apply(f.ctx);
  assert.equal(f.registrations.tools.length, 1);
  assert.equal(f.registrations.commands.length, 1);
  assert.equal(f.registrations.prompts.length, 1);
  const tool = f.registrations.tools[0];
  assert.equal(tool.name, "sea");
  assert.equal(tool.isConcurrencySafe({ action: "status" }), true);
  assert.equal(tool.isConcurrencySafe({ action: "export" }), false);
  const guide = await tool.execute({ action: "guide" }, { agent: f.agent });
  assert.match(guide.guide, /source/i);
  assert.equal(guide.chapterSchema.type, "object");
  const result = await tool.execute(
    { action: "init", course: "probability" },
    { agent: f.agent },
  );
  assert.equal(result.course, "probability");
  assert.equal(tool.output.render({}, result)[0].type, "text");
  f.dispose();
  assert.deepEqual(f.registrations, { tools: [], commands: [], prompts: [] });
});

test("slash validates syntax, imports attachments with inferred source roles and queues user followup", async (t) => {
  const f = await fixture(t);
  apply(f.ctx);
  const handler = f.registrations.commands[0].handler,
    invoke = (rawInput, attachments = []) =>
      handler({ rawInput, attachments, agent: f.agent });
  for (const raw of [
    "",
    "../escape",
    "course unsupported",
    "course slides extra",
  ]) {
    assert.equal((await invoke(raw)).kind, "error");
  }
  assert.equal(f.followups.length, 0);
  const result = await invoke("probability", [
    attachment("Week 1 slides.txt", "Definitions"),
    attachment("Mock exam.txt", "Questions"),
    attachment("Homework.txt", "Exercises"),
    attachment("Worked answers.txt", "Solutions"),
  ]);
  assert.equal(result.kind, "success");
  assert.equal(f.followups.length, 1);
  assert.deepEqual(f.followups[0].source, { kind: "user" });
  assert.match(f.followups[0].content[0].text, /four|lecture_notes/);
  const state = await exec(f, { action: "status" });
  assert.deepEqual(state.sources.map((s) => s.kind).sort(), [
    "assignment",
    "quiz",
    "slides",
    "solutions",
  ]);
  assert.equal(state.revision, 1);
  assert.equal(
    (
      await invoke("probability reference", [
        attachment("Appendix.txt", "A formula"),
      ])
    ).kind,
    "success",
  );
  assert.equal(
    (await exec(f, { action: "status" })).sources.find(
      (s) => s.name === "Appendix.txt",
    ).kind,
    "reference",
  );
  const before = f.followups.length;
  assert.equal(
    (
      await invoke("probability", [
        {
          type: "image",
          attachment: { name: "scan.png", bytes: 2, content: "xx" },
        },
      ])
    ).kind,
    "error",
  );
  assert.equal(f.followups.length, before);
  f.setPolicy({ mode: "read-only", workspaceRoot: f.root });
  assert.equal(
    (await invoke("probability", [attachment("Denied.txt", "Do not import")]))
      .kind,
    "error",
  );
  assert.equal(f.followups.length, before);
  f.dispose();
});
