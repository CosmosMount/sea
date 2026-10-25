# Verification record

Checked on 2026-10-25 using Windows, Node 24.21.0, pnpm 11.28.5 and DeepSeek Harness 0.2.1-rc.2.

## Passed

- 50 automated tests: course persistence/concurrency, source/page coverage, transitive invalidation, explicit question corrections, schema/renderer bounds, permission changes during pending writes, prototype-key rejection, source parsing, four-document rendering, question/solution order, answer separation, local mathematical fonts, vector boxed formulas and packaging metadata.
- Source formatting and plugin syntax checks.
- Production dependency audit: no known vulnerabilities at the time of this check. This is a time-specific advisory lookup, not a security guarantee. XML and ZIP dependencies were upgraded after initial audit findings.
- Installed the local bundle with Plugin Manager; activation returned `application: applied`. Confirmed the mounted entry and invoked its real `sea` tool.
- Live synthetic run: initialized a course, imported original probability teaching text, read it through the bounded source API, authored a shared chapter, and exported four independently saved PDFs. Replacing the source marked the chapter stale and correctly blocked export. Restoring matching source content allowed a new immutable edition without changing question IDs.
- Remounted the final source after visual fixes; the live tool rejected a nine-column table under the final eight-column schema limit and generated a new edition.
- Visually inspected representative atlas and solution pages from the actual live export through the installed LibreOffice Kit CLI. No missing fonts, clipped labels, overflowing text or formula clipping was observed on those pages. A lost MathJax `currentColor` box stroke was discovered, fixed and regression-tested; the final remounted export was checked again.
- Separate renderer tests inspect long tables, long text, matrices, fractions, uncommon local math glyphs, PDF bookmarks and destinations. Representative reference PDFs were inspected as documented in the style analysis.
- Public package allowlist excludes private examples, extracted scratch, course state, generated PDFs, tests and node_modules.

## Not established

- No whole-semester regenerated book has undergone page-by-page semantic/fidelity acceptance against the private reference corpus. The synthetic verification is intentionally small and is not a demonstration of full-course teaching depth.
- Browser automation was unavailable. Slash-command behavior and uploaded attachment streams were integration-tested against the exact inspected Host contracts, but the actual browser upload interaction and Plugin Manager's rendered localized icon were not visually exercised. Installed icon/localization resources were checked.
- Linux and Node 22 are configured in CI but were not executed in this local Windows session.
- OCR, arbitrary geometric diagrams/circuit layouts, CJK prose and SSH workspace persistence remain unsupported, as documented in the README.

The user-facing result should distinguish reliable infrastructure checks from model-authored educational quality. A successful export does not certify mathematics, source interpretation or equal depth to a reference book.
