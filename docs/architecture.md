# Architecture

1. `index.js` registers the `sea` model tool, concise discovery prompt and `/sea` upload command. All resources are owned by Cordis effects. The command queues the current agent rather than creating an untracked background model loop.
2. `src/service.js` is the shared operation boundary. It resolves session policy and canonical local workspace, imports attachment streams or workspace files, provides bounded reads, and coordinates complete-edition export.
3. `src/extract.js` parses bounded PDF/OOXML/plain-text inputs. It returns page/segment text and explicit warnings, never a claim of visual understanding.
4. `src/course.js` and `src/schema.js` implement schema/version validation, source deduplication, source/page coverage, chapter dependency snapshots, stable question IDs, revision compare-and-set, and locked atomic JSON persistence.
5. `src/documents.js` turns typed blocks into byte buffers. The question book reads prompts only; solutions share the same question objects. Formulas and diagrams are vectors, with bounded pagination and explicit failures for unsupported content.
6. `resources/generation-guide.md` supplies deferred authoring instructions. It is deliberately not always loaded into the model context.

## Invariants

- A source ID is stable across byte replacements; hashes identify revisions. Name-based IDs include a short filename/role digest to reduce collisions.
- Every source page is cited by a chapter or has an explicit reviewed exclusion. Coverage is structural, not proof that the prose captures every fact on the page.
- Source/dependency snapshots determine freshness. The agent cannot set a trusted `stale:false` flag.
- Chapters and questions have stable IDs; unknown fields and unsafe object keys fail validation.
- A mutation uses the current revision, changes state atomically, and cannot delete an existing question ID.
- All four PDFs are rendered from one immutable in-memory revision. Revision is rechecked under lock before publication; the edition manifest is written last.
- Cancellation before publication preserves the prior complete edition. Incomplete artifact directories are distinguishable by the missing manifest.

## Model context budget

Before installation SEA contributes zero prompt characters. The first-turn discovery section plus tool name/description/schema totals 2,849 characters (approximately 713 tokens using a transparent characters/4 estimate). The 21,144-character guide and complete chapter schema (approximately 5,286 tokens by the same estimate) are loaded only on `guide`, not every unrelated request. These are comparative estimates, not exact provider tokenizer or wire-prompt counts. Reproduce from a source checkout with `node scripts/context-budget.mjs`.

## Scope choices

The first release intentionally uses the existing Harness composer/commands rather than introducing a separate web server or bespoke upload page. This keeps attachment admission, session attribution and model credentials with Harness. Course content is workspace-owned, while chat/session records remain Harness-owned; plugin unload does not erase either.

Local native persistence is guarded by the session policy and canonical-path checks, not a general filesystem virtualization layer. SSH support requires a provider-owned binary write/persistence abstraction and is explicitly refused rather than silently using Host paths. Cross-user adversarial filesystem races require stronger OS-level isolation than this portable implementation supplies.
