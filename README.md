# fracture

Work on multiple git branches simultaneously without the complexity of git worktrees or submodules.

## Why?

When an AI tool (Claude Code, Codex, etc.) is grinding on a branch, you're stuck waiting. You can't switch branches without disrupting it. Fracture lets you spin up an isolated working directory in seconds so you can keep working on something else.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/segersniels/fracture/master/install.sh | bash
```

## Usage

```bash
# Create a new fracture - shows branch selector
fracture

# Create a new fracture with a new branch off the selected base
fracture -b my-feature

# List all fractures for current repo
fracture list
fracture ls

# Delete a fracture - shows selector if no name provided
fracture delete
fracture delete <id>
```

## How it works

Fracture is a thin wrapper around `git worktree`. When you run `fracture`:

1. Shows a branch selector
2. Creates a worktree at `~/.fracture/<repo>/<id>/`
3. Drops you into a subshell in that directory

The worktree shares the same git history, remotes, and objects as your original repo. Commits made in a fracture are immediately visible in the original repo. You can push, pull, and do whatever you normally do with git.

When you're done, just `exit` the shell or close the terminal tab.

## Example

```bash
~/projects/myapp (feat/ai-working) $ fracture
# Select "develop" from the list
entering fracture: 1733912345

~/.fracture/myapp/1733912345 (develop) $ git checkout -b hotfix/urgent-bug
# ... fix the bug, commit, push ...
~/.fracture/myapp/1733912345 (hotfix/urgent-bug) $ exit

exited fracture: 1733912345
~/projects/myapp (feat/ai-working) $ # AI is still working, undisturbed
```

## Cleanup

```bash
# Interactive delete
fracture delete

# Delete specific fracture
fracture delete 1733912345

# Manual cleanup (if needed)
git worktree remove ~/.fracture/myapp/1733912345
```
