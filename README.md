# fracture

A lightweight CLI for managing git worktrees. Create isolated working directories instantly and work on multiple branches in parallel.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/segersniels/fracture/master/install.sh | bash
```

<details>
<summary>Build from source</summary>

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/segersniels/fracture.git
cd fracture
bun install
make install
```

</details>

## Usage

```bash
# Create a new worktree - interactive branch selection with search
fracture

# Create a new worktree with a new branch off the selected base
fracture -b my-feature

# List all active worktrees
fracture ls

# Delete a worktree
fracture delete
fracture delete -f  # force delete with uncommitted changes
```

## How it works

Fracture wraps `git worktree` with a simpler interface. When you run `fracture`:

1. Select a branch (type to search)
2. A worktree is created at `~/.fracture/<repo>/<id>/`
3. `node_modules` and `.env` files are copied from your source
4. Dependencies are installed
5. You're dropped into a subshell in the new directory

Worktrees share git history, remotes, and objects with the original repo. Commits are immediately visible across all worktrees. When you're done, `exit` the shell or close the terminal.

## Use cases

- **Parallel debugging** - Run two branches side by side to compare behavior
- **Quick hotfixes** - Start a fix without disrupting your current work
- **Code review** - Check out a PR branch while keeping your work intact
- **Long-running tasks** - Let CI or builds run in one worktree while you continue elsewhere
- **AI pair programming** - Let an AI agent work on one branch while you continue on another

## License

MIT
