---
"hal-agent-skills": minor
---

The pr-walkthrough HTML viewer can now leave **GitHub-style review comments**: drag the line-number gutter to comment on a range (or click a single line), or comment on a whole file. Comments render as inline threads, persist in `localStorage`, and **Copy review** exports them as JSON. A new **post-pr-review** skill posts that exported review to the PR via `gh` as one batched review.
