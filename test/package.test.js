import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));

test("release metadata and allowlist exclude private course data", async () => {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(pkg.exports["./icon"], "./icon.svg");
  for (const excluded of [
    "examples",
    ".analysis",
    ".sea",
    "node_modules",
    "test",
  ])
    assert.ok(
      !pkg.files.some((f) => f === excluded || f.startsWith(excluded + "/")),
    );
  for (const locale of ["en", "zh"]) {
    const value = JSON.parse(
      await readFile(path.join(root, "locale", locale + ".json"), "utf8"),
    );
    assert.ok(value.meta.title.length > 4);
    assert.ok(value.meta.description.length > 20);
  }
  const icon = await readFile(path.join(root, "icon.svg"), "utf8");
  assert.match(icon, /<svg\s/);
  assert.doesNotMatch(icon, /<script|href=|<foreignObject/i);
  assert.ok(Buffer.byteLength(icon) < 256 * 1024);
  for (const resource of [
    "index.js",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "resources/generation-guide.md",
  ])
    assert.ok((await readFile(path.join(root, resource))).length > 0);
  for (const hook of ["preinstall", "install", "postinstall", "prepare"])
    assert.equal(pkg.scripts[hook], undefined);
});

test("model context defers the full chapter schema and authoring guide", async () => {
  const index = await readFile(path.join(root, "index.js"), "utf8");
  assert.match(index, /action=.guide./);
  assert.doesNotMatch(index, /CHAPTER_SCHEMA/);
  const guide = await readFile(
    path.join(root, "resources/generation-guide.md"),
    "utf8",
  );
  assert.match(guide, /untrusted/i);
  assert.match(guide, /3\.49/);
  assert.match(guide, /missing/i);
});
