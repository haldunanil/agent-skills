---
"hal-agent-skills-build": minor
---

post-pr-review now honors a `viewedFiles` array in the exported review: after posting comments it marks each listed file viewed on the PR's "Files changed" tab via GitHub's `markFileAsViewed` mutation. A review may contain only `viewedFiles` (no comments). Mark-only — it never unmarks.
