---
"hal-agent-skills": patch
---

post-pr-review: recover from transient/bare 422 GitHub API failures. SKILL.md now tells the agent to rerun with network escalation on sandbox failures, and to rerun once with `GH_DEBUG=api` on a bare `422 Unprocessable Entity` (only when nothing was posted yet), without ever re-posting a payload whose review already landed. The script prints a matching hint on bare 422s.
