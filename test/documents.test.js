import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import PDFDocument from "pdfkit";
import { renderDocument, DOCUMENT_KINDS } from "../src/documents.js";
import { extractDocument, EXTRACTION_LIMITS } from "../src/extract.js";

const p = (text) => ({ type: "paragraph", text });
const fixture = () => ({
  course: "SYN101",
  title: "Original Synthetic Study Pack",
  revision: 2,
  chapters: [
    {
      id: "ch-1",
      title: "SECRET Topic Chapter",
      order: 1,
      sources: [{ sourceId: "synthetic-source", pages: [1] }],
      notes: [
        { type: "heading", text: "Counting toy tokens" },
        p(
          "A box has three amber tokens and two blue tokens. Every token has an equal chance of selection.",
        ),
        { type: "math", tex: "P(A)=\\frac{3}{5}" },
        {
          type: "table",
          headers: ["Color", "Count"],
          rows: [
            ["Amber", "3"],
            ["Blue", "2"],
          ],
        },
        { type: "callout", title: "Check", text: "Counts must add to five." },
      ],
      atlas: [
        {
          title: "A token experiment",
          blocks: [
            {
              type: "diagram",
              nodes: [
                { id: "box", label: "Box of five tokens" },
                { id: "draw", label: "Draw one token" },
                { id: "count", label: "Count amber outcomes" },
              ],
              edges: [
                { from: "box", to: "draw", label: "Random selection" },
                { from: "draw", to: "count", label: "Record result" },
              ],
              caption: "A small labeled relation map.",
            },
            {
              type: "bullets",
              items: ["State the sample space.", "Count favorable outcomes."],
            },
          ],
        },
      ],
      questions: [
        {
          id: "Q1",
          mock: "Mock A",
          marks: 4,
          minutes: 6,
          order: 1,
          prompt: [
            p(
              "A toy bag contains six green tokens and four red tokens. Find the chance of selecting a red token.",
            ),
          ],
          solution: [
            p(
              "SOLUTION_SENTINEL: Ten outcomes are equally likely. Four are red.",
            ),
            { type: "math", tex: "P(R)=\\frac{4}{10}=0.4" },
          ],
        },
      ],
    },
  ],
});
const allText = (result) => result.pages.map((p) => p.text).join("\n");
async function blankPDF() {
  const d = new PDFDocument();
  const chunks = [];
  const done = new Promise((r) => {
    d.on("data", (c) => chunks.push(c));
    d.on("end", () => r(new Uint8Array(Buffer.concat(chunks))));
  });
  d.end();
  return done;
}

test("all four variants produce independently extractable A4 PDFs", async () => {
  for (const kind of DOCUMENT_KINDS) {
    const data = await renderDocument({ ...fixture(), kind });
    assert.ok(data instanceof Uint8Array);
    assert.equal(Buffer.from(data.subarray(0, 5)).toString(), "%PDF-");
    const result = await extractDocument(data, `${kind}.pdf`);
    assert.ok(result.pages.length >= 2);
    const t = allText(result);
    assert.match(t, /SYN101/);
    if (kind === "questions") {
      assert.doesNotMatch(
        t,
        /SOLUTION_SENTINEL|SECRET Topic Chapter|synthetic-source/,
      );
      assert.match(t, /Mock A/);
      assert.match(t, /4 marks/);
    }
    if (kind === "detailed_solutions") assert.match(t, /SOLUTION_SENTINEL/);
    if (kind === "visual_atlas") assert.match(t, /Random selection/);
  }
});
test("MathJax v4 local dynamic glyphs produce vector fractions matrices and uncommon symbols", async () => {
  const f = fixture();
  f.chapters[0].notes = [
    String.raw`M=\begin{bmatrix}1&2\\3&4\end{bmatrix},\quad\sum_{i=1}^n i=\frac{n(n+1)}2`,
    String.raw`\mathbb{R}\supset\mathbb{Q},\quad\mathfrak{g},\quad\oint_C z\,dz=0`,
    String.raw`\braket{\psi|\phi}=\alpha,\quad\cancel{x}+\boldsymbol{\beta}`,
    String.raw`\begin{aligned}a&=b+c\\d&=e+f\end{aligned}`,
  ].map((tex) => ({ type: "math", tex }));
  const data = await renderDocument({ ...f, kind: "lecture_notes" });
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: data.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const ops = await (await pdf.getPage(2)).getOperatorList();
    assert.ok(ops.fnArray.includes(OPS.constructPath));
    assert.ok(!ops.fnArray.includes(OPS.paintImageXObject));
    assert.ok(!ops.fnArray.includes(OPS.paintInlineImageXObject));
  } finally {
    await task.destroy();
  }
  f.chapters[0].notes = [{ type: "math", tex: String.raw`\text{中文}` }];
  await assert.rejects(
    renderDocument({ ...f, kind: "lecture_notes" }),
    /unsupported font glyphs/,
  );
});
test("boxed math preserves its vector rectangle stroke instead of dropping currentColor", async () => {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  async function strokeCount(tex) {
    const f = fixture();
    f.chapters[0].notes = [{ type: "math", tex }];
    const task = getDocument({
      data: await renderDocument({ ...f, kind: "lecture_notes" }),
      verbosity: 0,
    });
    const pdf = await task.promise;
    try {
      const ops = await (await pdf.getPage(2)).getOperatorList();
      return ops.fnArray.filter(
        (fn, i) =>
          fn === OPS.stroke ||
          (fn === OPS.constructPath && ops.argsArray[i][0] === OPS.stroke),
      ).length;
    } finally {
      await task.destroy();
    }
  }
  assert.equal(
    await strokeCount(String.raw`\boxed{\frac12}`),
    (await strokeCount(String.raw`\frac12`)) + 1,
  );
});
test("question and solution books share mock ordering, outlines, and TOC destinations", async () => {
  const f = fixture();
  const first = f.chapters[0];
  first.questions[0].order = 3;
  const second = structuredClone(first);
  second.id = "ch-2";
  second.title = "Another topic";
  second.order = 2;
  second.questions = [
    {
      id: "Q2",
      mock: "Mock A",
      order: 1,
      marks: 2,
      minutes: 3,
      prompt: [p("SECOND_PROMPT")],
      solution: [p("SECOND_SOLUTION")],
    },
  ];
  second.solutionIntro = [p("FOUNDATION_SENTINEL")];
  f.chapters.push(second);
  for (const kind of ["questions", "detailed_solutions"]) {
    const data = await renderDocument({ ...f, kind });
    const t = allText(await extractDocument(data, "book.pdf"));
    assert.ok(t.indexOf("Question Q2") < t.indexOf("Question Q1"));
    if (kind === "questions")
      assert.doesNotMatch(t, /FOUNDATION_SENTINEL|SECOND_SOLUTION/);
    else assert.match(t, /FOUNDATION_SENTINEL/);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: data.slice(), verbosity: 0 });
    const pdf = await task.promise;
    try {
      assert.ok((await pdf.getOutline()).some((x) => x.title === "Mock A"));
      assert.ok(await pdf.getDestination("mock-0"));
      const annotations = await (await pdf.getPage(1)).getAnnotations();
      assert.ok(annotations.some((x) => x.dest === "mock-0"));
    } finally {
      await task.destroy();
    }
  }
});
test("WinAnsi typographic punctuation renders and extracts without substitution", async () => {
  const f = fixture();
  f.chapters[0].notes = [p("“Quoted” — contrast – detail… €5")];
  const t = allText(
    await extractDocument(
      await renderDocument({ ...f, kind: "lecture_notes" }),
      "punctuation.pdf",
    ),
  );
  assert.match(t, /“Quoted” — contrast – detail… €5/);
});
test("renderer is byte deterministic for the same input", async () => {
  const f = { ...fixture(), kind: "lecture_notes" };
  assert.deepEqual(await renderDocument(f), await renderDocument(f));
});
test("long tables split cells across pages and repeat headers without losing tails", async () => {
  const f = fixture();
  f.chapters[0].notes = [
    {
      type: "table",
      headers: ["TOKEN_HEADER", "Explanation"],
      rows: [
        [
          "x".repeat(7000) + " FINAL_TOKEN",
          "Step ".repeat(2000) + " FINAL_STEP",
        ],
      ],
    },
  ];
  const data = await renderDocument({ ...f, kind: "lecture_notes" });
  const result = await extractDocument(data, "long.pdf");
  assert.ok(result.pages.length > 3);
  const t = allText(result);
  assert.match(t, /FINAL_TOKEN/);
  assert.match(t, /FINAL_STEP/);
  assert.ok((t.match(/TOKEN_HEADER/g) || []).length > 2);
});
test("long words, paragraphs, and diagrams paginate; PDF text remains in page bounds", async () => {
  const f = fixture();
  f.chapters[0].notes = [
    p(("Longword".repeat(80) + " ").repeat(30) + " PARAGRAPH_END"),
  ];
  const data = await renderDocument({ ...f, kind: "lecture_notes" });
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: data.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    assert.ok(pdf.numPages > 2);
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n);
      assert.ok(Math.abs(pg.view[2] - 595.28) < 1);
      assert.ok(Math.abs(pg.view[3] - 841.89) < 1);
      const content = await pg.getTextContent();
      for (const item of content.items)
        if (item.str?.trim()) {
          assert.ok(item.transform[4] >= 47, `left page ${n}`);
          assert.ok(
            item.transform[4] + item.width <= 549,
            `right page ${n}: ${item.str}`,
          );
          assert.ok(
            item.transform[5] > 20 && item.transform[5] < 825,
            `vertical page ${n}`,
          );
        }
    }
  } finally {
    await task.destroy();
  }
});
test("validation rejects unsupported Unicode, bad math, invalid diagrams, and malformed tables", async () => {
  const f = fixture();
  f.title = "English 中文";
  await assert.rejects(
    renderDocument({ ...f, kind: "lecture_notes" }),
    /unsupported Unicode/,
  );
  for (const block of [
    { type: "math", tex: "\\notarealcommand{a}" },
    {
      type: "diagram",
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "missing" }],
    },
    { type: "table", headers: ["a"], rows: [["one", "two"]] },
  ]) {
    const f = fixture();
    f.chapters[0].notes = [block];
    await assert.rejects(renderDocument({ ...f, kind: "lecture_notes" }));
  }
});
test("abort signals stop both extraction and rendering", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Canceled test"));
  await assert.rejects(
    renderDocument(
      { ...fixture(), kind: "questions" },
      { signal: controller.signal },
    ),
    /Canceled/,
  );
  await assert.rejects(
    extractDocument(strToU8("hello"), "a.txt", { signal: controller.signal }),
    /Canceled/,
  );
});
test("text and markdown preserve content and logical form-feed pages", async () => {
  const r = await extractDocument(strToU8("# Notes\nAlpha\fBeta"), "a.md");
  assert.deepEqual(r.pages, [
    { page: 1, text: "# Notes\nAlpha" },
    { page: 2, text: "Beta" },
  ]);
  await assert.rejects(
    extractDocument(new Uint8Array([255]), "a.txt"),
    /encoded data/,
  );
});
test("DOCX decodes entities and makes synthetic page semantics explicit", async () => {
  const zip = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="urn:w"><w:p><w:r><w:t>Original &amp; synthetic &lt;sample&gt;</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:document>',
    ),
  });
  const r = await extractDocument(zip, "test.docx");
  assert.match(r.pages[0].text, /Original & synthetic <sample>/);
  assert.match(r.pages[0].text, /\nSecond paragraph/);
  assert.match(r.warnings[0], /not a physical page/);
});
test("PPTX extracts slide order, not ZIP entry order", async () => {
  const xml = (s) =>
    strToU8(
      `<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>${s}</a:t></a:r></a:p></p:sld>`,
    );
  const zip = zipSync({
    "ppt/slides/slide10.xml": xml("Ten"),
    "ppt/slides/slide2.xml": xml("Two"),
    "ppt/slides/slide1.xml": xml("One"),
  });
  const r = await extractDocument(zip, "test.pptx");
  assert.deepEqual(
    r.pages.map((p) => p.text),
    ["One", "Two", "Ten"],
  );
});
test("PPTX uses presentation relationships for true physical slide order", async () => {
  const xml = (s) => strToU8(`<a:p><a:r><a:t>${s}</a:t></a:r></a:p>`);
  const zip = zipSync({
    "ppt/slides/slide1.xml": xml("One"),
    "ppt/slides/slide2.xml": xml("Two"),
    "ppt/presentation.xml": strToU8(
      '<p:presentation><p:sldIdLst><p:sldId id="8" r:id="rId2"/><p:sldId id="7" r:id="rId1"/></p:sldIdLst></p:presentation>',
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
    ),
  });
  const r = await extractDocument(zip, "reordered.pptx");
  assert.deepEqual(
    r.pages.map((p) => p.text),
    ["Two", "One"],
  );
});
test("bounded ZIP parser rejects bombs before decompression and rejects DTDs", async () => {
  const zip = zipSync({ "word/document.xml": strToU8("<w:t>test</w:t>") });
  const v = new DataView(zip.buffer);
  for (let i = 0; i < zip.length - 46; i++)
    if (v.getUint32(i, true) === 0x02014b50) {
      v.setUint32(i + 24, EXTRACTION_LIMITS.entryBytes + 1, true);
      break;
    }
  await assert.rejects(extractDocument(zip, "bad.docx"), /expansion limit/);
  const dtd = zipSync({
    "word/document.xml": strToU8("<!DOCTYPE foo><w:t>test</w:t>"),
  });
  await assert.rejects(extractDocument(dtd, "bad.docx"), /document types/);
});
test("empty/scanned PDFs report OCR warning, unsupported sources reject", async () => {
  const r = await extractDocument(await blankPDF(), "scan.pdf");
  assert.match(r.warnings.join(" "), /OCR/);
  await assert.rejects(extractDocument(strToU8("a"), "bad.exe"), /Unsupported/);
  await assert.rejects(extractDocument(strToU8("not zip"), "bad.docx"), /ZIP/);
});
