# Contributing

Use Node.js 22.16+ and pnpm 11. Run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm test`, `pnpm run check`, `pnpm run format:check`, `pnpm audit --prod`, and `pnpm run pack:check` before proposing changes. Do not add install scripts or dependencies without documenting necessity, licenses and security impact.

Keep source parsing, course state, Harness integration and PDF rendering separate. Add regression tests for every integrity or permission bug. Use original synthetic fixtures, never private course extracts. Update the generation guide and schema together. Changes to persisted state require an explicit version/migration plan; reject unknown versions instead of guessing.

Inspect current Harness Service contracts before changing integration methods. Own registrations through context effects and clean them up on unload. Do not hardcode profile paths, keys, machine-specific runtimes or GUI ports. Test on Windows and Linux. A renderer change needs representative visual checks for dense math, long text, tables and diagrams; disclose unavailable checks.

Reference-style claims must be backed by measured output, not only successful PDF creation. Do not impose page-count padding to make a small course look like a full-semester reference. Keep source gaps and limitations visible.
