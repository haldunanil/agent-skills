---
"hal-agent-skills": minor
---

**pr-walkthrough now generates a self-contained HTML viewer** instead of a markdown file. Each changed file renders as a GitHub-style side-by-side diff with markdown narratives, syntax highlighting, a chapter sidebar, and collapsible sections.

Under the hood, the walkthrough agent writes a compact pointer JSON (prose + `file`/`lines` pointers, never copied diffs); a stdlib-only Node build step resolves the real diffs from `gh pr diff` — correct for open, merged, and fork PRs — and inlines a reusable, versioned UI (highlight.js + markdown-it via pinned CDNs) into one file you open in a browser. Validation enforces full changed-file coverage, rename/header-only diffs render their metadata, and CI now runs the `node:test` suite.
