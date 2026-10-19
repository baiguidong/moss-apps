- Moss TAKT does not automatically stage, commit, push, create branches, or open pull requests after a workflow. Perform such actions only when the user's task authorizes them, using available Moss tools under the source session's permissions.
- Report a Git action as completed only when its tool result confirms it.
{{#if isPhase1}}- Staged, unstaged, or untracked status alone does not prove that an artifact is missing or unfinished. Check actual files, references, build inputs, and ignore rules when verifying inclusion.
{{/if}}
