# SEA · Study Edition Atlas

A DeepSeek Harness plugin that turns **incrementally uploaded course materials** into four coherent study books:

| Output | Purpose |
| --- | --- |
| `lecture_notes.pdf` | Self-contained explanations, notation, derivations, worked examples and pitfalls |
| `visual_atlas.pdf` | Vector diagrams, comparison tables, algorithm traces and visual reasoning |
| `questions.pdf` | Mixed-topic practice papers with stable IDs, marks and no answer leakage |
| `detailed_solutions.pdf` | Matching problems, prerequisites, step-by-step working, option diagnosis and checks |

**中文：** 上传课件、quiz、作业，不必一次上传全部。使用同一课程标识追加材料，插件保存来源、章节和题目，标记受影响内容并重新导出四份 PDF。默认使用与参考成品一致的清晰英文；中文交互不会自动把文档翻译成中文。

## Install

Requires a local workspace, Node.js 22.16+ and DeepSeek Harness with tools, commands, filesystem, attachments, working-directory and sandbox-policy services. Developed against **DSH 0.2.1-rc.2**; other versions are not certified. No separate model key, Python, browser server, LaTeX installation or Office installation is required to generate PDFs. Rendering for visual QA is separate.

1. Clone this repository to a stable local directory.
2. Install dependencies with `pnpm install --frozen-lockfile --ignore-scripts` (pnpm 11), or use your package-manager equivalent. No build scripts are needed.
3. In Harness, ask the agent to install this directory as a plugin bundle using Plugin Manager. Equivalent tool request:

   ```json
   {"action":"install_bundle","target":"/absolute/path/to/sea"}
   ```

   On Windows use an absolute Windows directory. The package is `dsh-study-edition-atlas`; the row is `study-edition-atlas`. Installation is profile-wide and may require your approval. Do not manually edit the profile files. A local install links this directory, so keep it in place. Follow Plugin Manager's restart instructions after upgrades.
4. In an ordinary chat, select the course's local workspace and use the command below.

## Upload and generate

Attach PDF / DOCX / PPTX / TXT / MD files in the normal Harness composer and submit:

```text
/sea my-course
```

The command imports the batch and queues the current agent to author, validate and export the four PDFs. By default, names containing `quiz/test/exam`, `assignment/homework`, or `solution/answer` determine the source role; other names default to slides. To explicitly classify a whole batch:

```text
/sea my-course slides
/sea my-course quiz
/sea my-course assignment
/sea my-course solutions
```

For additional weeks, **reuse `my-course`**. You can also ask the agent in natural language to import workspace-local paths, change a source role, review coverage or resume interrupted work. Run `/sea my-course` without attachments to resume. Generated paths appear in the conversation; ask the agent to present all four PDFs if its response does not include file cards.

- The selected Harness model does the pedagogical authoring. PDF layout, source indexing, revision checks and export are deterministic code.
- Generation consumes normal model tokens and can take many steps for a substantial course. Cancellation preserves completed chapters. No hidden external AI endpoint is used by this plugin.
- Read-only sessions cannot import, change or export. SSH workspaces are deliberately rejected in v0.1.
- Same original filename and inferred role identify the same source. Same bytes are a no-op; changed bytes replace that source and invalidate dependents. For renamed replacements, explicitly ask the agent to ingest using the existing `sourceId` rather than creating a new source.
- Automatic role inference is a convenience, not a semantic classifier. Inspect `status`; specify a role explicitly for ambiguous filenames.

## Incremental model

Each local workspace owns `.sea/courses/<course>/state.json`. It stores source SHA-256 hashes, bounded extracted page text, page coverage, chapter source/dependency snapshots and a shared question/solution bank. All four documents are projections of those same chapter records, preventing separate question/answer numbering from drifting.

Adding a source leaves unrelated chapters unchanged but blocks export until every new page is covered or explicitly reviewed/excluded. Replacing a source makes affected chapters and their transitive prerequisite dependents stale. The agent must update these chapters in dependency order, preserving question IDs. A revision check prevents concurrent overwrites; failed mutations retain the previous state. Changes to existing question wording or assessment metadata require an explicit recorded `correctionReason`; IDs cannot silently disappear. Cross-process lock files fail closed; see [security notes](SECURITY.md) for interrupted-writer recovery.

Exports are complete **immutable editions**:

```text
.sea/courses/my-course/
  state.json
  edition-r12-<unique-id>/
    lecture_notes.pdf
    visual_atlas.pdf
    questions.pdf
    detailed_solutions.pdf
    manifest.json
```

A manifest is written only after all four PDFs. Older editions are retained; a failed export never replaces one. Incomplete directories without a manifest are not valid editions. Full PDF pagination is rebuilt after edits; semantic content is incremental, not PDF-page concatenation. Output page numbers may shift, while chapter and question IDs remain stable.

## Fidelity and quality

The private examples were analyzed for language, typography, page structure, source tracing and explanation depth; the factual measurements are in [the style analysis](docs/example-style-analysis.md). Runtime authoring follows [the generation guide](resources/generation-guide.md), so users do **not** need the original examples.

The references are substantial English study books, not four short summaries: their solution text is approximately 3.49–6.67 times their question text. SEA uses these observations as calibration, not a fixed page quota. A partial course should produce a smaller book with the same depth per topic. The renderer intentionally substitutes built-in serif/sans fonts rather than redistributing the examples' fonts.

**Not a guarantee of equivalent educational quality.** Automated checks cover schema, page coverage, stale dependencies and pairing, not mathematical truth or every visual defect. The agent must inspect source figures, validate computations and review representative rendered pages. The report explicitly says semantic correctness is not machine-certified. Short notes/solutions and nonvisual atlases produce review findings. Actual quality also depends on the selected model and available source material.

### Current limitations

- Extraction is text-oriented, not OCR or figure understanding. Scanned/image-heavy pages, equations and reading order require manual/agent visual verification. Warnings block export until reviewed. The plugin does not pretend missing text is complete.
- DOCX/PPTX extraction does not reproduce original layouts. DOCX/TXT “pages” are logical segments, not physical pagination. Embedded equation/figure interpretation must be verified.
- Prose output supports English/Latin characters; unsupported glyphs fail explicitly. Put mathematical symbols in TeX math blocks. CJK document output is not supported in this release.
- Diagrams currently express labeled node-to-node relations; arbitrary charts, circuit geometry and image reproduction are not supported. Use tables and math when those convey the concept faithfully, or report the unmet visual requirement.
- Limits include 25 MiB/source, 500 extracted pages/source, 2 million extracted characters/source, 20 attachments and 120 MiB/batch, 16 MiB state, 200 chapters and 600 pages/document. A limit fails clearly rather than silently dropping content. Split large courses into sensible editions.
- Source content, extracted text and generated PDFs are private local data but can enter your configured model's context and Harness logs. Review your provider's retention policy.

## Agent tool

The `sea` tool exposes `guide`, `init`, `status`, `ingest`, `read_source`, `read_chapter`, `put_chapter`, `review_source`, `check`, and `export`. `guide` returns the full chapter/block schema on demand rather than inserting it into every model prompt. Mutations require the current revision. Read results use explicit continuation offsets and a 24,000-character window. Source review requires a substantive reason; the application cannot independently certify that the review occurred.

## Develop and test

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm run check
pnpm run pack:check
```

Tests use original synthetic materials, exercise all four PDF outputs, incremental invalidation, stable IDs, partial source reads, optimistic concurrency, permission checks, hostile archives, unsupported glyphs and answer separation. CI runs the suite on Windows and Linux. No course PDFs are required for tests. See [architecture](docs/architecture.md) and [contribution guidelines](CONTRIBUTING.md).

## Public repository and licensing

Code and original icon: MIT. Third-party packages retain their licenses; see [third-party notes](THIRD_PARTY_NOTICES.md). Private examples, course uploads, extracted text, model credentials and generated editions are excluded from version control and npm packaging. The code license grants **no rights to third-party course materials**. Obtain permission before publishing uploads or generated content derived from them; follow your institution's assessment rules. Never place credentials in this repository.
