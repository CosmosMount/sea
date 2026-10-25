import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/js/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "@mathjax/src/js/util/asyncLoad/esm.js";

export const DOCUMENT_KINDS = Object.freeze([
  "lecture_notes",
  "visual_atlas",
  "questions",
  "detailed_solutions",
]);
const LABELS = {
  lecture_notes: "Lecture Notes",
  visual_atlas: "Visual Study Atlas",
  questions: "Revision Questions",
  detailed_solutions: "Detailed Solutions",
};
const C = {
  ink: "#173B50",
  teal: "#007F89",
  muted: "#546B77",
  line: "#D5E5EA",
  pale: "#EEF7F9",
};
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const math = mathjax.document("", {
  InputJax: new TeX({
    packages: [
      "base",
      "ams",
      "newcommand",
      "configmacros",
      "boldsymbol",
      "braket",
      "mathtools",
      "cancel",
      "textmacros",
    ],
    maxBuffer: 16384,
    maxMacros: 1000,
    formatError: (_jax, error) => {
      throw new Error(`Invalid mathematical expression: ${error.message}`);
    },
  }),
  OutputJax: new SVG({ fontCache: "none" }),
});
// V4 splits New Computer Modern glyphs into local dynamic modules. Preload once
// before synchronous layout so formulas never fetch network assets or emit retries.
let mathReady;
const prepareMath = () =>
  (mathReady ??= math.outputJax.font.loadDynamicFiles());
const abort = (signal) => {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Rendering aborted");
};
function text(value, label = "Text") {
  if (typeof value !== "string")
    throw new TypeError(`${label} must be a string`);
  if (value.length > 100000) throw new Error(`${label} exceeds the text limit`);
  // Built-in PDF Helvetica is intentionally limited; do not silently substitute missing glyphs.
  const bad = [...value].find(
    (c) =>
      !/[\x20-\x7e\n\r\t\xa0-\xff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac]/.test(
        c,
      ),
  );
  if (bad)
    throw new Error(
      `${label} contains unsupported Unicode U+${bad.codePointAt(0).toString(16).toUpperCase()}; use simple English/Latin text and a math block for symbols`,
    );
  return value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}
function validateBlock(b) {
  if (!b || typeof b !== "object")
    throw new TypeError("Block must be an object");
  switch (b.type) {
    case "paragraph":
    case "heading":
      text(b.text);
      break;
    case "bullets":
      if (!Array.isArray(b.items)) throw new Error("Bullets require items");
      b.items.forEach((x) => text(x));
      break;
    case "callout":
      text(b.title);
      text(b.text);
      break;
    case "math":
      if (typeof b.tex !== "string" || !b.tex.trim() || b.tex.length > 8000)
        throw new Error("Math requires 1-8000 TeX characters");
      break;
    case "table":
      if (
        !Array.isArray(b.headers) ||
        !b.headers.length ||
        b.headers.length > 8 ||
        !Array.isArray(b.rows)
      )
        throw new Error("Table requires 1-8 headers and rows");
      b.headers.forEach((x) => text(x));
      b.rows.forEach((r) => {
        if (!Array.isArray(r) || r.length !== b.headers.length)
          throw new Error("Table rows must match headers");
        r.forEach((x) => text(x));
      });
      break;
    case "diagram": {
      if (
        !Array.isArray(b.nodes) ||
        !Array.isArray(b.edges) ||
        !b.nodes.length ||
        b.nodes.length > 100 ||
        b.edges.length > 200
      )
        throw new Error("Diagram requires 1-100 nodes and up to 200 edges");
      const ids = new Set();
      b.nodes.forEach((n) => {
        if (typeof n.id !== "string" || !n.id || ids.has(n.id))
          throw new Error("Diagram node IDs must be unique");
        ids.add(n.id);
        text(n.label);
      });
      b.edges.forEach((e) => {
        if (!ids.has(e.from) || !ids.has(e.to))
          throw new Error("Diagram edge refers to an unknown node");
        if (e.label !== undefined) text(e.label);
      });
      if (b.caption !== undefined) text(b.caption);
      break;
    }
    default:
      throw new Error(`Unsupported block type: ${b.type}`);
  }
}

/** Pure byte-returning renderer. It never reads source documents or writes files. */
export async function renderDocument(input, { signal } = {}) {
  abort(signal);
  await prepareMath();
  abort(signal);
  if (!input || !DOCUMENT_KINDS.includes(input.kind))
    throw new Error("Unknown document kind");
  text(input.course, "Course");
  text(input.title, "Title");
  const revision = text(String(input.revision ?? 1), "Revision");
  if (
    !Array.isArray(input.chapters) ||
    !input.chapters.length ||
    input.chapters.length > 200
  )
    throw new Error("Document requires 1-200 chapters");
  if (JSON.stringify(input).length > 8_000_000)
    throw new Error("Document content exceeds the 8 MB limit");
  const chapters = [...input.chapters].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const ch of chapters) {
    text(ch.title, "Chapter title");
    if (
      !Array.isArray(ch.notes) ||
      !Array.isArray(ch.atlas) ||
      !Array.isArray(ch.questions)
    )
      throw new Error("Chapters require notes, atlas, and questions arrays");
    ch.notes.forEach(validateBlock);
    if (ch.solutionIntro !== undefined) {
      if (!Array.isArray(ch.solutionIntro))
        throw new Error("solutionIntro must be blocks");
      ch.solutionIntro.forEach(validateBlock);
    }
    ch.questions.forEach((q) => {
      if (q.mock !== undefined) text(q.mock, "Mock");
      for (const key of ["marks", "minutes", "order"])
        if (q[key] !== undefined && (!Number.isFinite(q[key]) || q[key] < 0))
          throw new Error(`Question ${key} must be a nonnegative number`);
    });
    ch.atlas.forEach((a) => {
      text(a.title);
      if (!Array.isArray(a.blocks)) throw new Error("Atlas requires blocks");
      a.blocks.forEach(validateBlock);
    });
    ch.questions.forEach((q) => {
      text(String(q.id), "Question ID");
      if (!Array.isArray(q.prompt) || !Array.isArray(q.solution))
        throw new Error("Questions require prompt and solution arrays");
      q.prompt.forEach(validateBlock);
      q.solution.forEach(validateBlock);
    });
  }
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 55, bottom: 52, left: 48, right: 48 },
    autoFirstPage: false,
    compress: true,
    info: {
      Title: `${input.title} - ${LABELS[input.kind]}`,
      Author: "Study Pack",
      Subject: input.course,
      CreationDate: new Date("2000-01-01T00:00:00Z"),
      ModDate: new Date("2000-01-01T00:00:00Z"),
    },
  });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  // Install rejection handling immediately, including synchronous drawing failures.
  done.catch(() => {});
  const L =
      input.kind === "visual_atlas"
        ? 48
        : input.kind === "lecture_notes"
          ? 68
          : 56,
    W = 595.28 - 2 * L,
    B = 778,
    T = 66;
  let y = T,
    pageNo = 0,
    shaded = false;
  const font = (size = 10, bold = false, color = C.ink) =>
    doc
      .font(
        input.kind !== "visual_atlas" && !bold && size >= 9 && size <= 11
          ? "Times-Roman"
          : bold
            ? "Helvetica-Bold"
            : "Helvetica",
      )
      .fontSize(size)
      .fillColor(color);
  const line = (s, x, yy, width, size = 10, bold = false, color = C.ink) => {
    font(size, bold, color);
    doc.text(s, x, yy, { width, height: size * 1.4, lineBreak: false });
  };
  function wrap(s, width, size = 10, bold = false) {
    font(size, bold);
    const out = [];
    for (const para of String(s).split("\n")) {
      let current = "";
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const candidate = current ? `${current} ${word}` : word;
        if (doc.widthOfString(candidate) <= width) {
          current = candidate;
          continue;
        }
        if (current) {
          out.push(current);
          current = "";
        }
        for (const char of word) {
          if (current && doc.widthOfString(current + char) > width) {
            out.push(current);
            current = "";
          }
          current += char;
        }
      }
      out.push(current);
    }
    return out;
  }
  function page() {
    abort(signal);
    if (++pageNo > 600) throw new Error("Rendered document exceeds 600 pages");
    doc.addPage();
    y = T;
    line(
      wrap(`${input.course}  |  ${LABELS[input.kind]}`, W, 7)[0],
      L,
      29,
      W,
      7,
      false,
      C.muted,
    );
    doc
      .strokeColor(C.line)
      .lineWidth(0.7)
      .moveTo(L, 44)
      .lineTo(L + W, 44)
      .stroke();
    line(`Revision ${revision}`.slice(0, 100), L, 806, 360, 7, false, C.muted);
    line(String(pageNo), L + W - 35, 806, 35, 7, false, C.muted);
  }
  function room(h) {
    abort(signal);
    if (y + h > B) page();
  }
  function prose(
    s,
    { size = 10, bold = false, color = C.ink, indent = 0, gap = 9, link } = {},
  ) {
    for (const l of wrap(s, W - indent - (shaded ? 16 : 0), size, bold)) {
      room(size * 1.45);
      if (shaded) doc.rect(L, y - 2, W, size * 1.45 + 2).fill(C.pale);
      line(
        l,
        L + indent + (shaded ? 8 : 0),
        y,
        W - indent - (shaded ? 16 : 0),
        size,
        bold,
        color,
      );
      if (link) doc.goTo(L + indent, y, W - indent, size * 1.45, link);
      y += size * 1.45;
    }
    y += gap;
  }
  function heading(s, size = 16) {
    room(size * 1.5 + 35);
    prose(s, { size, bold: true, color: C.teal, gap: 12 });
  }
  function table(b) {
    const width = W / b.headers.length,
      pad = 7,
      lh = 13;
    const header = b.headers.map((s) => wrap(s, width - 2 * pad, 9, true));
    const hh = Math.max(...header.map((a) => a.length)) * lh + 14;
    if (hh > 180)
      throw new Error("Table header is too long; shorten its labels");
    function drawHeader() {
      room(hh + lh + 14);
      doc.rect(L, y, W, hh).fill(C.ink);
      header.forEach((a, i) =>
        a.forEach((s, j) =>
          line(
            s,
            L + i * width + pad,
            y + 7 + j * lh,
            width - 2 * pad,
            9,
            true,
            "#FFFFFF",
          ),
        ),
      );
      y += hh;
    }
    drawHeader();
    b.rows.forEach((r, index) => {
      const cells = r.map((s) => wrap(s, width - 2 * pad, 9));
      let start = 0,
        total = Math.max(...cells.map((a) => a.length));
      while (start < total) {
        let count = Math.min(total - start, Math.floor((B - y - 14) / lh));
        if (count < 1) {
          page();
          drawHeader();
          count = Math.min(total - start, Math.floor((B - y - 14) / lh));
        }
        const h = count * lh + 14;
        doc.rect(L, y, W, h).fill(index % 2 === 0 ? C.pale : "#FFFFFF");
        for (let i = 0; i < cells.length; i++) {
          doc
            .rect(L + i * width, y, width, h)
            .lineWidth(0.4)
            .strokeColor(C.line)
            .stroke();
          cells[i]
            .slice(start, start + count)
            .forEach((s, j) =>
              line(s, L + i * width + pad, y + 7 + j * lh, width - 2 * pad, 9),
            );
        }
        y += h;
        start += count;
        if (start < total) {
          page();
          drawHeader();
        }
      }
    });
    y += 14;
  }
  function equation(tex) {
    abort(signal);
    const node = math.convert(tex, { display: true });
    const svg = adaptor.innerHTML(node);
    if (/data-mjx-error|<merror/.test(svg))
      throw new Error("Invalid mathematical expression");
    if (/<text\b/.test(svg))
      throw new Error(
        "Mathematical expression contains unsupported font glyphs; use supported TeX symbols and Latin text",
      );
    const vb = svg.match(/viewBox="([^"]+)"/);
    if (!vb) throw new Error("Math SVG has no dimensions");
    const [, , vw, vh] = vb[1].split(/\s+/).map(Number);
    const naturalWidth = Math.max(24, (vw / 1000) * 13),
      w = Math.min(W - 24, naturalWidth),
      h = (w * vh) / vw;
    if (!Number.isFinite(h) || h > 350 || h < 0 || w / naturalWidth < 0.55)
      throw new Error(
        "Mathematical expression is too large; split it into multiple math blocks",
      );
    room(h + 24);
    doc.rect(L, y, W, h + 16).fill(C.pale);
    // svg-to-pdfkit 0.1.8 drops inherited currentColor strokes (e.g. \\boxed).
    // Resolve MathJax's default ink explicitly before converting vector shapes.
    const printableSvg = svg.replace(
      /(fill|stroke)="currentColor"/g,
      '$1="#000000"',
    );
    // MathJax emits ex dimensions; normalize the SVG viewport to PDF points.
    const sizedSvg = printableSvg
      .replace(/(<svg\b[^>]*\bwidth=")[^"]+"/, `$1${w}"`)
      .replace(/(<svg\b[^>]*\bheight=")[^"]+"/, `$1${h}"`);
    SVGtoPDF(doc, sizedSvg, L + (W - w) / 2, y + 8, {
      width: w,
      height: h,
      assumePt: true,
    });
    y += h + 26;
  }
  function diagram(b) {
    // One vector relation per row keeps every label legible, including cyclic/dense graphs.
    const nodes = new Map(b.nodes.map((n) => [n.id, n.label]));
    const relations = b.edges.length
      ? b.edges.map((e) => [nodes.get(e.from), nodes.get(e.to), e.label || ""])
      : b.nodes.map((n) => [n.label, null, ""]);
    const referenced = new Set(b.edges.flatMap((e) => [e.from, e.to]));
    if (b.edges.length)
      for (const n of b.nodes)
        if (!referenced.has(n.id)) relations.push([n.label, null, ""]);
    for (const [a, bLabel, label] of relations) {
      const bw = 160,
        gap = W - 2 * bw,
        left = wrap(a, bw - 16, 9),
        right = bLabel === null ? [] : wrap(bLabel, bw - 16, 9),
        middle = wrap(label, gap - 16, 8);
      const h = Math.max(
        42,
        Math.max(left.length, right.length) * 13 + 16,
        middle.length * 11 + 30,
      );
      if (h > B - T - 20)
        throw new Error("Diagram label is too long; shorten node/edge labels");
      room(h + 12);
      function box(x, lines) {
        doc.roundedRect(x, y, bw, h, 5).fillAndStroke(C.pale, C.line);
        lines.forEach((s, i) =>
          line(s, x + 8, y + (h - lines.length * 13) / 2 + i * 13, bw - 16, 9),
        );
      }
      box(L, left);
      if (bLabel !== null) {
        box(L + W - bw, right);
        const ay = y + h - 14;
        doc
          .strokeColor(C.teal)
          .lineWidth(1.2)
          .moveTo(L + bw + 4, ay)
          .lineTo(L + W - bw - 5, ay)
          .stroke();
        doc
          .moveTo(L + W - bw - 5, ay)
          .lineTo(L + W - bw - 11, ay - 4)
          .lineTo(L + W - bw - 11, ay + 4)
          .closePath()
          .fill(C.teal);
        middle.forEach((s, i) =>
          line(s, L + bw + 8, y + 7 + i * 11, gap - 16, 8, false, C.muted),
        );
      }
      y += h + 10;
    }
    if (b.caption) prose(b.caption, { size: 9, color: C.muted });
    y += 5;
  }
  function blocks(list) {
    for (const b of list) {
      abort(signal);
      switch (b.type) {
        case "paragraph":
          prose(b.text);
          break;
        case "heading":
          heading(b.text, 13);
          break;
        case "bullets":
          for (const item of b.items)
            prose(`- ${item}`, { indent: 10, gap: 5 });
          y += 5;
          break;
        case "math":
          equation(b.tex);
          break;
        case "table":
          table(b);
          break;
        case "diagram":
          diagram(b);
          break;
        case "callout":
          heading(b.title, 11);
          for (const s of wrap(b.text, W - 20, 10)) {
            room(15);
            doc.rect(L, y - 2, 3, 15).fill(C.teal);
            line(s, L + 12, y, W - 20);
            y += 15;
          }
          y += 12;
          break;
      }
    }
  }
  try {
    page();
    y = 145;
    prose(input.course, { size: 12, bold: true, color: C.teal, gap: 20 });
    prose(input.title, { size: 30, bold: true, gap: 18 });
    prose(LABELS[input.kind], { size: 23, color: C.teal, gap: 22 });
    const groups = new Map();
    for (const ch of chapters)
      for (const q of ch.questions) {
        const key = q.mock || "Mixed-topic practice";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(q);
      }
    prose(
      `Revision ${revision}${input.kind === "questions" ? "" : ` | ${chapters.length} chapters`}`,
      { size: 10, color: C.muted, gap: 32 },
    );
    heading("Contents", 14);
    const assessment =
      input.kind === "questions" || input.kind === "detailed_solutions";
    if (assessment) {
      if (
        input.kind === "detailed_solutions" &&
        chapters.some((ch) => ch.solutionIntro?.length)
      )
        prose("Foundations", { size: 11, gap: 6, link: "foundations" });
      for (const [i, key] of [...groups.keys()].entries())
        prose(key, { size: 11, gap: 6, link: `mock-${i}` });
    } else
      chapters.forEach((ch, i) =>
        prose(`${i + 1}. ${ch.title}`, {
          size: 11,
          gap: 6,
          link: `chapter-${i}`,
        }),
      );
    if (
      input.kind === "detailed_solutions" &&
      chapters.some((ch) => ch.solutionIntro?.length)
    ) {
      page();
      doc.addNamedDestination("foundations");
      doc.outline.addItem("Foundations");
      heading("Foundations", 22);
      for (const ch of chapters)
        if (ch.solutionIntro?.length) {
          heading(ch.title);
          blocks(ch.solutionIntro);
        }
    }
    if (assessment)
      for (const [mock, questions] of groups) {
        page();
        doc.addNamedDestination(`mock-${[...groups.keys()].indexOf(mock)}`);
        doc.outline.addItem(mock);
        heading(mock, 22);
        const marks = questions.reduce((n, q) => n + (q.marks || 0), 0),
          minutes = questions.reduce((n, q) => n + (q.minutes || 0), 0);
        if (marks || minutes)
          prose(
            `${marks ? `${marks} marks` : ""}${marks && minutes ? " | " : ""}${minutes ? `${minutes} minutes` : ""}`,
            { color: C.muted },
          );
        for (const q of questions.sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0),
        )) {
          const qtitle = `Question ${q.id}${q.marks !== undefined ? ` (${q.marks} marks)` : ""}${q.minutes !== undefined ? ` - ${q.minutes} minutes` : ""}`;
          if (input.kind === "detailed_solutions") {
            const titleLines = wrap(qtitle, W - 16, 12, true);
            room(titleLines.length * 17 + 40);
            for (const s of titleLines) {
              doc.rect(L, y, W, 23).fill(C.ink);
              line(s, L + 8, y + 4, W - 16, 12, true, "#FFFFFF");
              y += 23;
            }
            y += 6;
            shaded = true;
            blocks(q.prompt);
            shaded = false;
          } else {
            heading(qtitle, 14);
            blocks(q.prompt);
          }
          if (input.kind === "detailed_solutions") {
            heading("Worked solution", 12);
            blocks(q.solution);
            const ch = chapters.find((ch) => ch.questions.includes(q));
            prose(`Topic: ${ch.title}`, { size: 8, color: C.muted, gap: 4 });
            for (const s of ch.sources || [])
              prose(
                `${text(String(s.sourceId), "Source ID")}: pages ${(s.pages || []).join(", ")}`,
                { size: 8, color: C.muted, gap: 4 },
              );
          } else {
            room(50);
            doc.strokeColor(C.line).lineWidth(0.5);
            for (let k = 0; k < 3; k++)
              doc
                .moveTo(L, y + 12 + k * 15)
                .lineTo(L + W, y + 12 + k * 15)
                .stroke();
            y += 62;
          }
        }
        await new Promise((resolve) => setImmediate(resolve));
        abort(signal);
      }
    for (const [i, ch] of (assessment ? [] : chapters).entries()) {
      page();
      doc.addNamedDestination(`chapter-${i}`);
      doc.outline.addItem(ch.title);
      heading(`${i + 1}. ${ch.title}`, 22);
      if (input.kind === "lecture_notes") blocks(ch.notes);
      if (input.kind === "visual_atlas")
        for (const section of ch.atlas) {
          heading(section.title);
          blocks(section.blocks);
        }
      if (Array.isArray(ch.sources) && ch.sources.length) {
        heading("Source references", 10);
        for (const s of ch.sources)
          prose(
            `${text(String(s.sourceId), "Source ID")}: pages ${(s.pages || []).join(", ")}`,
            { size: 8, color: C.muted, gap: 4 },
          );
      }
      // Yield between chapters so AbortSignal can interrupt long asynchronous jobs.
      await new Promise((resolve) => setImmediate(resolve));
      abort(signal);
    }
    doc.end();
    return await done;
  } catch (error) {
    doc.destroy(error);
    throw error;
  }
}
