import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { StudyService } from "../src/service.js";
import { CourseStore } from "../src/course.js";
import { apply } from "../index.js";

async function fixture(t) {
  const parent = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sea-review-")),
  );
  const root = path.join(parent, "original"),
    other = path.join(parent, "replacement");
  await fs.mkdir(root);
  await fs.mkdir(other);
  t.after(async () => {
    assert.equal(path.dirname(parent), await fs.realpath(os.tmpdir()));
    await fs.rm(parent, { recursive: true, force: true });
  });
  let cwd = root,
    mode = "workspace-write",
    readHook = () => {},
    streamHook = () => {};
  const commands = [],
    messages = [];
  const ctx = {
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: cwd }) },
    workingDirectory: { ensure: async () => cwd },
    fs: {
      processPathFromHostPath: (p) => p,
      resolve: async (p, { cwd: base = cwd } = {}) => ({
        path: path.resolve(base, p),
      }),
      processPath: (t) => t.path,
      contains: (a, b) => {
        const r = path.relative(a.path, b.path);
        return (
          r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r)
        );
      },
      readBytes: async (target, _signal, max) => {
        const data = await fs.readFile(target.path);
        assert.ok(data.length <= max);
        await readHook();
        return data;
      },
    },
    attachments: {
      async *readFileStream(ref) {
        yield Buffer.from(ref.content);
        await streamHook();
      },
    },
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    commands: {
      register: (d) => {
        commands.push(d);
        return () => {};
      },
    },
    effect: (fn) => fn(),
  };
  const agent = {
    session: { id: "security-review" },
    followup: (message) => {
      // Match the actual driver: it expects a complete identified UserMessage.
      assert.equal(message.role, "user");
      assert.match(message.id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
      assert.deepEqual(message.source, { kind: "user" });
      assert.ok(Array.isArray(message.content));
      assert.ok(!messages.some((m) => m.id === message.id));
      messages.push(message);
    },
  };
  const service = new StudyService(ctx),
    exec = (args) =>
      service.execute(
        { course: "course", ...args },
        agent,
        new AbortController().signal,
      );
  await exec({ action: "init" });
  return {
    root,
    other,
    ctx,
    agent,
    service,
    exec,
    commands,
    messages,
    setMode: (v) => {
      mode = v;
    },
    setCwd: (v) => {
      cwd = v;
    },
    onRead: (fn) => {
      readHook = fn;
    },
    onStream: (fn) => {
      streamHook = fn;
    },
  };
}
const paragraph = (text) => ({ type: "paragraph", text });
async function seedEdition(f) {
  await fs.writeFile(
    path.join(f.root, "source.txt"),
    "A fair coin has two equally likely outcomes.",
  );
  const imported = await f.exec({
    action: "ingest",
    revision: 0,
    path: "source.txt",
  });
  const sourceId = imported.sources[0].id;
  await f.exec({
    action: "put_chapter",
    revision: 1,
    chapter: {
      id: "coin",
      title: "Coin probabilities",
      order: 0,
      sources: [{ sourceId, pages: [1] }],
      dependsOn: [],
      notes: [paragraph("List outcomes before counting favorable events.")],
      atlas: [
        {
          title: "Two outcomes",
          blocks: [
            {
              type: "table",
              headers: ["Outcome", "Probability"],
              rows: [
                ["Heads", "0.5"],
                ["Tails", "0.5"],
              ],
            },
          ],
        },
      ],
      questions: [
        {
          id: "Q01",
          prompt: [paragraph("What is the probability of heads?")],
          solution: [
            paragraph(
              "One of the two equally likely outcomes is heads, so the probability is one half.",
            ),
          ],
        },
      ],
    },
  });
}
async function editionNames(root) {
  return (
    await fs.readdir(path.join(root, ".sea", "courses", "course"))
  ).filter((name) => name.startsWith("edition-"));
}

test("review: prototype identifiers cannot mutate process prototypes or read inherited records", async (t) => {
  const f = await fixture(t);
  // Restore in finally even against a vulnerable build; one failing test must not poison other tests.
  const keys = [
    "reviewReason",
    "warningsAcknowledged",
    "exclusion",
    "reviewedPages",
  ];
  const before = new Map(
    keys.map((k) => [k, Object.getOwnPropertyDescriptor(Object.prototype, k)]),
  );
  try {
    for (const sourceId of ["__proto__", "constructor", "toString"]) {
      await assert.rejects(
        f.exec({
          action: "review_source",
          revision: 0,
          sourceId,
          reason: "Regression input is not an actual course source.",
          acknowledgeWarnings: true,
          exclude: true,
          reviewedPages: [],
        }),
      );
      for (const k of keys)
        assert.deepEqual(
          Object.getOwnPropertyDescriptor(Object.prototype, k),
          before.get(k),
        );
      await assert.rejects(f.exec({ action: "read_source", sourceId }));
      await assert.rejects(
        f.exec({ action: "read_chapter", chapterId: sourceId }),
      );
    }
  } finally {
    for (const [k, descriptor] of before) {
      if (descriptor) Object.defineProperty(Object.prototype, k, descriptor);
      else delete Object.prototype[k];
    }
  }
  assert.equal((await f.exec({ action: "status" })).revision, 0);
});

test("review: slash submits complete user messages with unique identities", async (t) => {
  const f = await fixture(t);
  apply(f.ctx);
  const invoke = () =>
    f.commands[0].handler({
      rawInput: "course",
      attachments: [],
      agent: f.agent,
      signal: new AbortController().signal,
    });
  assert.equal((await invoke()).kind, "success");
  assert.equal((await invoke()).kind, "success");
  assert.equal(f.messages.length, 2);
});

test("review: ingest rechecks policy after asynchronous file read", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "input.txt"), "Source content.");
  f.onRead(() => f.setMode("read-only"));
  await assert.rejects(
    f.exec({ action: "ingest", revision: 0, path: "input.txt" }),
  );
  assert.equal((await new CourseStore(f.root).load("course")).revision, 0);
});

test("review: attachment imports recheck policy after streaming", async (t) => {
  const f = await fixture(t);
  f.onStream(() => f.setMode("read-only"));
  await assert.rejects(
    f.service.importAttachments(
      f.agent,
      "course",
      [
        {
          type: "file",
          attachment: { name: "upload.txt", bytes: 7, content: "Example" },
        },
      ],
      undefined,
      new AbortController().signal,
    ),
  );
  assert.equal((await new CourseStore(f.root).load("course")).revision, 0);
});

for (const change of ["policy", "workspace"])
  test(`review: export rejects ${change} change after admission and publishes no edition`, async (t) => {
    const f = await fixture(t);
    await seedEdition(f);
    // Let initial admission complete, then change the session before render/publication.
    // Hook the service boundary, not timers: deterministic even with fast renderers.
    const original = f.service.environment.bind(f.service);
    let admitted = false;
    f.service.environment = async (...args) => {
      const result = await original(...args);
      if (!admitted) {
        admitted = true;
        if (change === "policy") f.setMode("read-only");
        else f.setCwd(f.other);
      }
      return result;
    };
    await assert.rejects(f.exec({ action: "export", revision: 2 }));
    assert.deepEqual(await editionNames(f.root), []);
    assert.equal((await new CourseStore(f.root).load("course")).revision, 2);
  });
