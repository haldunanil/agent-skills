---
name: review-pr-comments
description: Use when fetching unresolved PR review comments for the current branch, checking what reviewers said, or getting a summary of open feedback before addressing it
---

# Review PR Comments

Fetches all unresolved review comments on the current branch's PR, classifies them as Questions or Change Requests, and presents a structured summary.

**Announce at start:** "I'm using the review-pr-comments skill to fetch all unresolved PR comments."

## When to Use

- Checking what reviewers said on your PR
- Getting a summary of unresolved feedback before addressing it
- Seeing how many comments are Questions vs Change Requests
- Quick triage of PR feedback without a full code review

## Controller Steps

Follow these steps exactly. Do not skip or reorder.

### Step 1: Get branch name

```bash
BRANCH_NAME=$(git branch --show-current)
```

Store `BRANCH_NAME` for use in later steps.

### Step 2: Find PR for current branch

```bash
gh pr view --json number,url,baseRefName,title,body 2>/dev/null
gh repo view --json owner,name -q '"\(.owner.login)/\(.name)"'
```

- If a PR exists, note the PR number, URL, title, and owner/repo. Store the owner/repo string as `OWNER_REPO`.
- If no PR exists, tell the user: "No open PR found for branch `{BRANCH_NAME}`. Cannot fetch PR comments." and **stop**.

### Step 3: Dispatch PR Comments Fetcher agent

- **Tool:** Agent with `subagent_type: "general-purpose"`
- **Prompt:** Fill the template from `pr-comments-prompt.md` in this skill directory, replacing `{BRANCH_NAME}`, `{PR_NUMBER}`, `{PR_TITLE}`, `{PR_URL}`, and `{OWNER_REPO}` with the actual values from Steps 1-2

### Step 4: Present results

Display the agent's output to the user. Highlight:

- Total number of unresolved comments
- Breakdown of Questions vs Change Requests
- Suggest: "Use `comprehensive-review` for a full review with code analysis and action plan, or address these comments directly."

## Red Flags

**Never:**

- Modify any files — this is a read-only operation
- Resolve or respond to any comments
- Continue past Step 2 if no PR exists

**If the agent fails:**

- Report the failure to the user with the error details
