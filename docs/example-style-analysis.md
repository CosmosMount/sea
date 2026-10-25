# Example document style and depth analysis

## Evidence and limits

This is an observation-based specification of the **four target types**: `lecture_notes`, `visual_atlas`, `questions`, `detailed_solutions`. Expanded formula notes inform lecture-note depth; they are not a fifth required output. No course passages, exercise datasets, or solutions are reproduced here.

All 25 PDFs were text/geometry-extracted using privately installed PyMuPDF 2.0; both DOCX files were inspected with bundled python-docx. Installation was coordinated with the lead and confined to private analysis scratch. Product code was not modified. Word counts use Unicode alphanumeric tokens with internal apostrophes/hyphens, including headers, footers, TOCs and mathematical variable tokens. They are reproducible extraction metrics, **not** linguistic word counts or proof of complete mathematical extraction. Image counts mean embedded raster image resources; drawing counts are vector drawing paths, **not diagram counts**.

Representative pages were rendered exclusively through the installed LibreOffice Kit CLI at 144 DPI; manifests reported no missing fonts. Although the CLI reports its native PDF backend as PDFium, no independent renderer was installed or invoked. Visually inspected: data atlas physical pages 1, 3, 35; quantum atlas page 8; quantum questions page 3; quantum solutions pages 3, 17; lecture notes pages 5, 10. These checks establish representative appearance, not exhaustive whole-book layout certification. Additional batched preview pages were generated but not all inspected. Temporary inspection images were removed after inspection.

## Corpus inventory and source integrity

- Eight reference-output PDFs: three quantum-course outputs, five data-mining outputs.
- Seventeen source PDFs: eleven quantum-course files (435 pages, 88,388 extracted words), six data-mining files (527 pages, 32,444 words). Combined: **962 source pages**, 120,832 extracted words.
- Two DOCX assignments: Assignment 1 has 67 body paragraphs, 3 tables, 1,238 extracted words; Assignment 2 has 75 paragraphs, 5 tables, 1,171 words. DOCX counts include text from table cells but not an asserted pagination.
- All eight references have **zero extracted CJK characters**. Their observed language is English, not bilingual.
- **Important mismatch:** reference data-mining documents claim seven supplied lecture PDFs covering L2–L7, including L4. Actual present source inventory contains L2 (two versions), L3, L5, L6, L7: **L4 is absent**. Reference claims must not be treated as proof of available source coverage. L1 is also explicitly acknowledged as unavailable in question/solution scope notes. Quantum reference scope also mentions Week 06 worked quizzes, whereas present standalone worked-solution PDFs end at Week 05; do not fabricate a Week 06 solution file.
- The two L2 versions are related source variants, not automatically two independent topics. Resolve overlapping and conflicting material explicitly, retaining provenance for both.

## Quantitative reference baseline

All references are **A4 portrait, 595.28 × 841.89 pt**. All contain **zero embedded raster images**: the observed visual system is vector text, math, rules, tables, shapes, and connectors.

| Reference | Type | Physical pages | Extracted words | Median words/page | Vector paths |
|---|---|---:|---:|---:|---:|
| [Complete lecture notes](../examples/AIAA3111/AIAA3111_Complete_Data_Mining_Lecture_Notes.pdf) | lecture_notes | 57 | 13,801 | 275 | 568 |
| [Expanded formula notes](../examples/AIAA3111/AIAA3111_Data_Mining_Expanded_Formula_Notes.pdf) | lecture depth variant | 77 | 22,180 | 313 | 1,310 |
| [Quantum visual atlas](../examples/AIAA3072/AIAA3072_Visual_Review_Atlas_Simple_English.pdf) | visual_atlas | 102 | 32,523 | 318 | 2,419 |
| [Data visual atlas](../examples/AIAA3111/Data_Mining_Visual_Study_Atlas.pdf) | visual_atlas | 100 | 19,118 | 189 | 1,975 |
| [Quantum questions](../examples/AIAA3072/AIAA3072_Revision_Questions.pdf) | questions | 29 | 9,062 | 316 | 248 |
| [Data questions](../examples/AIAA3111/Data_Mining_Questions.pdf) | questions | 16 | 3,533 | 237 | 198 |
| [Quantum solutions](../examples/AIAA3072/AIAA3072_Revision_Detailed_Solutions.pdf) | detailed_solutions | 216 | 60,483 | 293.5 | 1,791 |
| [Data solutions](../examples/AIAA3111/Data_Mining_Detailed_Solutions.pdf) | detailed_solutions | 40 | 12,344 | 292.5 | 352 |

Physical pages differ from printed page numbers because cover/front matter may use Roman numerals or no number. Never use a printed denominator as the PDF physical page count.

### Depth relationships

- Expanded lecture notes add **20 pages (+35.1%)** and **8,379 words (+60.7%)** over complete notes. This is deeper calculation/derivation work, not merely larger typography.
- Quantum solutions have **7.45×** question-book pages and **6.67×** its words. Data solutions have **2.50×** pages and **3.49×** words.
- Quantum bank: **96 questions**, split into two 32-item, 100-mark mocks; 24-item, 72-mark coverage supplement; 8-item, 32-mark optional appendix. Mocks target 120 minutes each.
- Data bank: **43 questions** = 9 in Mock A + 9 in Mock B + 20 coverage drills + 5 optional clustering questions. Core mocks each target 80 minutes, 100 marks; supplementary drill and clustering each have 40 marks, excluded from core scores.
- Quantum solutions contain the same four pedagogic stages **96 times each**: prerequisite knowledge; stepwise derivation; all-option diagnosis; verification/transfer. Data solutions contain prerequisite-stage heading 43 times and all-option diagnosis 33 times (corresponding to choice-oriented items); stage wording varies for worked problems.
- These figures are empirical full-course baselines, **not fixed minimum quotas for an arbitrary small upload**. A five-page summary cannot honestly be called equivalent in depth to the reference books, but imposing 100 pages on one short source would manufacture padding.

## Shared visual grammar

White page, high contrast, restrained navy/teal accents, small muted running headers and footers, thin horizontal rules, deliberate whitespace. Math is typeset with true fractions, matrices, superscripts, subscripts, Greek symbols and scalable delimiters, not raw LaTeX or screenshots. Long equations require layout-aware breaks. TOCs and source crosswalks are meaningful navigation devices, not decorative pages.

Text-bounding-box medians (including running furniture; not exact configured margins) show atlas left/right x ≈48/547 pt; lecture ≈68/529 pt; questions ≈53–59/536–543 pt; solutions ≈59/537 pt. Thus use approximately **48 pt atlas margins**, **68 pt lecture margins**, **54–59 pt assessment margins** when matching reference proportions. Headers and footers lie outside main text flow.

### Exact observed typography and text palettes

| Family | Dominant body | Display/secondary | Extracted text colors |
|---|---|---|---|
| Lecture notes + formula variant | Latin Modern Roman, dominant 10.91 pt (justification creates nearby 10.8–11.02 pt spans) | 14.35 pt sections, ~20.92 pt major headings; Latin Modern math | navy `#172b40`, teal `#087e91`, muted `#526a7b`, black |
| Quantum atlas | Lato Regular/Bold, 9.96 pt | 20.92 pt title; 11.96 pt subheads; 8.97 pt diagram text; 6.97 pt metadata; Computer Modern math | navy `#173b50`, teal `#007f89`, muted `#546b77`, trap amber `#a26510`, black/white |
| Data atlas | Nimbus Sans Regular, 9.96 pt | 20.92 pt title; 11.96 pt subheads; 8.97/7.47 pt small material; 6.97 pt furniture; Computer Modern math | same atlas palette; pale blue `#bfd9e2` appears in text |
| Quantum questions | Latin Modern Roman 10.91 pt; Latin Modern math | Latin Modern Sans headers, 14.35 pt section headings | black, muted `#526273`, navy `#17324d` |
| Quantum solutions | Latin Modern Roman 10.91 pt; Latin Modern math | Latin Modern Sans Bold section structure, 14.35 pt question titles, 11.96 pt stage headings | black, muted `#526273`, navy `#18374a`, teal `#216a70`, white |
| Data questions/solutions | Latin Modern Roman 10.91 pt; Latin Modern math | 11.96/14.35 pt headings | black, navy `#1b344c`, teal `#146c74`, muted `#5c6870` |

Font names are observations, not a redistribution license. Substitute only intentionally and validate mathematical glyph coverage and reflow. Exact text colors do not assert all box-fill colors; pale cyan/blue fills and orange warning fills are visually observed.

## Four target specifications

### 1. lecture_notes

**Purpose:** self-contained continuous learning path, not slide transcription and not a list of extracted bullet points.

Observed structure: cover and edition/scope; usage guidance; detailed hierarchical TOC; large topic parts; numbered chapters and subsections; definitions and assumptions; mathematical formulation; explanation and interpretation; worked examples; algorithm traces; comparison tables; self-checks; assignment-aligned calculations and error checks. Front matter and body may use separate page-number schemes.

Language: formal but accessible English, precise terminology, explicit notation conventions and prerequisites. Explain symbols before use and separate assumptions from conclusions. The expanded variant adds intermediate arithmetic, derivations and complete algorithm iterations, rather than merely repeating formulas. Avoid claims of complete coverage where sources are missing.

Visual character: predominantly serif textbook pages, navy headings/body accents, teal navigational accents and self-check labels, pale blue worked-example panels, restrained diagrams. Dense pages coexist with intentionally short chapter endings; whitespace alone is not a defect.

**Recommended QA contract (derived requirement, not claimed reference count):** every substantive algorithm/formula topic has inputs, outputs, assumptions, symbol definitions, mechanics, interpretation, an actual worked calculation where applicable, failure cases, and at least one validated source anchor. A single generic example copied across topics does not meet this contract.

### 2. visual_atlas

**Purpose:** visual reasoning and procedural review, not a decorative infographic collection or reduced-size lecture pages.

Observed page pattern: small uppercase topic/category kicker; large descriptive action/concept title; exact source line; flowchart/map/table or worked visual model; compact explanation; worked values/steps; stop condition or interpretation; common-trap callout. Pale cyan rounded nodes, navy selected/important nodes with white text, teal arrows, pale blue explanation panels and pale orange traps distinguish functions. Tables use disciplined alignment and mostly horizontal rules. Text remains selectable; diagrams are vector objects.

Language: simple/direct English with short action-oriented headings; simplicity does **not** remove assumptions or math. Both atlases contain substantive calculations, not just labels and summaries. They teach distinctions, validity conditions and mistakes.

Book structure extends beyond topic pages to practice, separated answers, source-to-topic indexing and scope notes. Source labels can reference PDF physical pages, named course sections, or assignment question identifiers. Reference citations are evidence to validate, not facts to reproduce blindly.

**Recommended QA contract:** every conceptual page needs a meaningful visual relation (flow, hierarchy, comparison, geometry, state transition, algorithm trace, or table), an explanatory takeaway, explicit limits/trap where relevant, and provenance. A repeated chain of generic boxes without topic-specific reasoning is not reference fidelity. Observed density range is broad: medians 189 and 318 words/page, so no one-density mandate.

### 3. questions

**Purpose:** independently attemptable assessment with **no answers, answer key, solution hints or leaked reasoning**.

Observed structure: cover with scope; timing/marks and scoring rules; answer recording; two mixed-context mocks; targeted coverage supplement; clearly separated optional material. Stable IDs, exact option labels and marks, all needed data tables and assumptions are present. Quantum questions deliberately mix chapter context rather than giving identifying chapter labels. Data questions mix single-choice, multiple-select and worked calculations.

Data mock composition: four single-choice items ×5 marks, one multiple-select ×10, four worked problems totaling70. Multi-select has explicit partial-credit rules. Questions specify threshold inclusivity, log bases, precision/rounding and data constraints where needed. Times and marks are described as practice-design choices, not examination predictions.

Language is precise assessment English; changed conditions and plausible misconception-based distractors test transfer. Original practice can be grounded in course material without copying original exercise wording.

**Recommended QA contract:** globally unique stable IDs; exactly one intended answer for single-choice; explicit multiple-select semantics; deterministic marks totals; all referenced tables present; no solution-only fields passed to the question renderer; no correct-option color/bold/position signal. Coverage checks must span topics and difficulty, not merely question count.

### 4. detailed_solutions

**Purpose:** teach how and why from first principles, not only give correct letters or final numbers.

Observed structure: cover/scope and use guidance; detailed TOC/bookmarks; prerequisite/dependency guide; compact answer key; item-by-item lessons; original question/options reproduced without changing IDs/order/marks; highlighted correct result; prerequisite explanation; reason for method; intermediate algebra/arithmetic/algorithm trace; every distractor explained; checks, boundary cases and transfer; source/coverage crosswalk.

Quantum per-item sequence has four consistent stages, repeated for all96 items. Each item is often a roughly two-page lesson. Data style is more compact but still distinguishes prerequisites, detailed working and choice diagnosis. Solution depth is dependent on task complexity; do not force identical paragraph counts for proofs and short definitions.

Visual character: serif math-rich working with strong sans/navy/teal stage hierarchy, shaded original-question box with dark header band, separate result box, aligned equations and small source/context metadata. Reproducing the generated companion question is appropriate; reproducing copyrighted source questions is not required by this style specification.

**Recommended QA contract:** question/solution ID bijection and immutable question payload; derivation supports final answer; diagnosis for every supplied option; explicit assumptions; numerical or logical verification; all subparts answered; no answer that depends on an omitted diagram/data table; no dangling source labels. Number of solved items equals number of questions including optional sections, while optional scores remain separate.

## Incremental implications

These are **implementation recommendations inferred from observations**, not claims that the PDFs expose an incremental system.

1. Store typed source records and stable page/section/assignment anchors, with content hashes and availability status. Index actual inventory, not reference-front-matter claims. Source gaps, duplicate versions and conflicting conventions must be visible.
2. Build a topic/prerequisite graph and source-to-topic-to-artifact dependency map. New material can deepen an existing topic or alter a convention; simple append-only page concatenation is insufficient.
3. Separate semantic content, assessment bank and renderer. The question booklet and solution booklet must share one immutable question object. Rewriting a solution must not silently change the question. Expanded explanations can be updated independently of scored items.
4. Preserve stable topic/question IDs across rebuilds. Existing page numbers may shift, so regenerate TOCs/bookmarks, printed references, answer keys and source crosswalks after pagination. Store semantic anchors rather than treating output page numbers as identity.
5. On changed source content, invalidate affected notes, diagrams, questions, answers and prerequisite dependents. Unaffected artifact content should retain identity and be reused; affected conventions may require wider recomputation than one chapter.
6. Maintain explicit edition, source revision, changed-topic summary and coverage delta. Distinguish added explanation from new scored questions. Preserve optional/out-of-scope status; do not silently promote optional material into the core mock.
7. Re-run cross-artifact QA after every incremental update: source links resolve; covered/unsupported claims match inventory; question IDs/marks/options match solutions; all computations and diagrams remain coherent; no answers leak into questions; page navigation matches final pagination.
8. Generate fresh pedagogic prose and datasets, using references for design/depth only. Private extracted text and previews are analysis intermediates, not distributable fixtures, demo content or application assets. Never embed course PDFs or long extracted passages in a product bundle.

## Acceptance interpretation

Reference equivalence requires **content depth, mathematical reliability, meaningful visuals and traceable source coverage**, not only matching colors or creating four valid PDFs. Report actual generated counts and structural coverage honestly. Prefer configurable depth tied to source scope; use the quantitative table as a comparison baseline and warning signal, not a license to pad. Simple English applies to expression, not simplification away of prerequisites, derivations, assumptions or caveats.
