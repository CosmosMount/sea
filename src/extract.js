import { unzipSync } from "fflate";

export const EXTRACTION_LIMITS = Object.freeze({
  inputBytes: 25 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entryBytes: 16 * 1024 * 1024,
  entries: 2048,
  pages: 500,
  textChars: 2_000_000,
});
const abort = (signal) => {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Extraction aborted");
};
const decode = (bytes) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
function entities(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, e) => {
    if (e[0] === "#") {
      const n =
        e[1].toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : "";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
      e.toLowerCase()
    ];
  });
}
function officeText(bytes) {
  const xml = decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("XML entities and document types are not supported");
  return xml
    .replace(/<(?:w|a):(?:tab)\b[^>]*\/?\s*>/g, "\t")
    .replace(/<(?:w|a):(?:br)\b[^>]*\/?\s*>/g, "\n")
    .replace(/<\/(?:w|a):(?:p|tr)>/g, "\n")
    .replace(/<\/(?:w|a):tc>/g, "\t")
    .split(/(<(?:w|a):t(?:\s[^>]*)?>[\s\S]*?<\/(?:w|a):t>)/g)
    .map((s) =>
      /^<(?:w|a):t(?:\s|>)/.test(s)
        ? entities(s.replace(/<[^>]*>/g, ""))
        : s.replace(/<[^>]*>/g, "").replace(/[^\n\t]/g, ""),
    )
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function zipEntries(bytes, extension) {
  // Validate all central-directory declarations before allocating decompression output.
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (
      v.getUint32(p, true) === 0x06054b50 &&
      p + 22 + v.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  if (end < 0) throw new Error("Invalid ZIP document");
  const count = v.getUint16(end + 10, true),
    offset = v.getUint32(end + 16, true);
  if (
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true) ||
    count > EXTRACTION_LIMITS.entries ||
    count === 65535
  )
    throw new Error(
      "ZIP entry limit or unsupported multi-volume/ZIP64 archive",
    );
  let p = offset,
    expanded = 0;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50)
      throw new Error("Invalid ZIP directory");
    const size = v.getUint32(p + 24, true),
      nameLen = v.getUint16(p + 28, true),
      extraLen = v.getUint16(p + 30, true),
      commentLen = v.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen > end)
      throw new Error("Invalid ZIP entry");
    const name = decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (names.has(name)) throw new Error("Duplicate ZIP entry");
    names.add(name);
    expanded += size;
    if (
      size > EXTRACTION_LIMITS.entryBytes ||
      expanded > EXTRACTION_LIMITS.expandedBytes
    )
      throw new Error("ZIP expansion limit exceeded");
    if (v.getUint16(p + 8, true) & 1)
      throw new Error("Encrypted ZIP documents are unsupported");
    p += 46 + nameLen + extraLen + commentLen;
  }
  return unzipSync(bytes, {
    filter: (f) => {
      if (f.originalSize > EXTRACTION_LIMITS.entryBytes)
        throw new Error("ZIP entry expansion limit exceeded");
      return extension === "docx"
        ? f.name === "word/document.xml"
        : /^ppt\/slides\/slide\d+\.xml$/.test(f.name) ||
            [
              "ppt/presentation.xml",
              "ppt/_rels/presentation.xml.rels",
            ].includes(f.name);
    },
  });
}

/** Extract local source text without executing macros, external links, or embedded files. */
export async function extractDocument(input, name, { signal } = {}) {
  abort(signal);
  if (!(input instanceof Uint8Array))
    throw new TypeError("Document bytes must be a Uint8Array");
  if (!input.length || input.length > EXTRACTION_LIMITS.inputBytes)
    throw new Error("Document is empty or exceeds the 25 MiB input limit");
  const bytes = new Uint8Array(input),
    extension = String(name).split(".").pop().toLowerCase();
  let pages = [],
    warnings = [];
  if (extension === "pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    abort(signal);
    warnings.push(
      "PDF extraction is text-only; verify diagrams, mathematical notation and reading order against the original before authoring.",
    );
    const task = getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    });
    const onAbort = () => {
      void task.destroy();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > EXTRACTION_LIMITS.pages)
        throw new Error("PDF exceeds the 500-page extraction limit");
      let chars = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        abort(signal);
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            item.str === undefined ? "" : item.str + (item.hasEOL ? "\n" : " "),
          )
          .join("")
          .trim();
        chars += text.length;
        if (chars > EXTRACTION_LIMITS.textChars)
          throw new Error("Extracted text limit exceeded");
        pages.push({ page: n, text });
        page.cleanup();
        if (!text)
          warnings.push(
            `Page ${n} has no extractable text; scanned/image pages require OCR, which is not included.`,
          );
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await task.destroy();
    }
  } else if (extension === "docx" || extension === "pptx") {
    const files = zipEntries(bytes, extension);
    abort(signal);
    if (extension === "docx") {
      if (!files["word/document.xml"])
        throw new Error("DOCX main document is missing");
      const text = officeText(files["word/document.xml"]);
      pages = [{ page: 1, text }];
      warnings.push(
        "DOCX page 1 denotes the document text, not a physical page; layout, equations, and images may need manual review.",
      );
    } else {
      let slides = Object.keys(files)
        .filter((key) => /^ppt\/slides\/slide\d+\.xml$/.test(key))
        .sort(
          (a, b) =>
            Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]),
        );
      if (
        files["ppt/presentation.xml"] &&
        files["ppt/_rels/presentation.xml.rels"]
      ) {
        const presentation = decode(files["ppt/presentation.xml"]),
          rels = decode(files["ppt/_rels/presentation.xml.rels"]);
        if (/<!DOCTYPE|<!ENTITY/i.test(presentation + rels))
          throw new Error("XML entities and document types are not supported");
        const targets = new Map();
        const attr = (tag, name) =>
          entities(
            tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1] || "",
          );
        for (const match of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
          const tag = match[0],
            target = attr(tag, "Target");
          if (attr(tag, "TargetMode") === "External") continue;
          targets.set(
            attr(tag, "Id"),
            target.startsWith("/ppt/")
              ? target.slice(1)
              : `ppt/${target.replace(/^\.\//, "")}`,
          );
        }
        const ordered = [
          ...presentation.matchAll(/<(?:\w+:)?sldId\b[^>]*>/g),
        ].map((m) => targets.get(attr(m[0], "r:id")));
        if (
          !ordered.length ||
          ordered.some((key) => !key || !files[key]) ||
          new Set(ordered).size !== ordered.length
        )
          throw new Error(
            "PPTX slide order references missing or duplicate slides",
          );
        slides = ordered;
      } else
        warnings.push(
          "PPTX presentation order metadata is missing; slides are ordered by part number.",
        );
      if (!slides.length) throw new Error("PPTX contains no slides");
      if (slides.length > EXTRACTION_LIMITS.pages)
        throw new Error("PPTX exceeds the 500-slide limit");
      pages = slides.map((key, i) => ({
        page: i + 1,
        text: officeText(files[key]),
      }));
      warnings.push(
        "PPTX extracts slide text only; images, equations, charts, and speaker notes require manual review.",
      );
    }
  } else if (["txt", "md"].includes(extension)) {
    pages = decode(bytes)
      .replace(/^\uFEFF/, "")
      .split("\f")
      .map((text, i) => ({ page: i + 1, text: text.trim() }));
  } else
    throw new Error(
      "Unsupported source format; use PDF, DOCX, PPTX, TXT, or MD",
    );
  abort(signal);
  if (
    pages.length > EXTRACTION_LIMITS.pages ||
    pages.reduce((n, p) => n + p.text.length, 0) > EXTRACTION_LIMITS.textChars
  )
    throw new Error("Extracted text/page limit exceeded");
  if (!pages.some((p) => p.text.trim()))
    warnings.push("This source contains no extractable text.");
  return { pages, warnings };
}
