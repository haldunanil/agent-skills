---
"hal-agent-skills": minor
---

Rename plugin, marketplace, and npm package from `agent-skills` to `hal-agent-skills`.

The previous name collided with Anthropic's reserved marketplace namespace (`claude plugin marketplace add` rejected it with: "The name 'agent-skills' is reserved for official Anthropic marketplaces"). Existing installs from the old name will need to be removed and reinstalled under the new identifiers:

```bash
claude plugin marketplace add haldunanil/hal-agent-skills
claude plugin install hal-agent-skills@hal-agent-skills
```
