---
"hal-agent-skills": patch
---

Fix pr-walkthrough hunk header rendering: the `@@ … @@` separator was laid out with `display:flex` directly on the `<td>`, which voids its `colSpan` under `table-layout:fixed` and collapsed the header into a one-character-per-line column. The flex layout now lives on an inner wrapper so the cell spans the full width. Also: checking a file's "Viewed" control (or its sidebar checkbox) now collapses the whole file block GitHub-style, and unchecking expands it.
