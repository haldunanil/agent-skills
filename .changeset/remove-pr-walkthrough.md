---
"hal-agent-skills": minor
---

Remove the `pr-walkthrough` and `post-pr-review` skills. `pr-walkthrough` has moved to the standalone Difftrail plugin (https://github.com/difftrail/plugin), which hosts the walkthrough viewer and handles uploads via its own MCP server; `post-pr-review` only consumed pr-walkthrough's exported review JSON, so it goes with it.
