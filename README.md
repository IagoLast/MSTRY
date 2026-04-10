# Electree

A terminal with superpowers for orchestrating AI agents across your projects.

## The problem

As a developer you work on multiple projects simultaneously, and within each project you often run several AI agents in parallel — each on its own git branch so they don't step on each other. Managing all of this with plain terminal windows and manual `git worktree` commands gets messy fast.

## The idea

Electree organizes your work in a simple hierarchy:

```
Project
└── Worktree (git branch in isolation)
    └── Agent (independent terminal)
```

- **Project** — a git repository you're working on.
- **Worktree** — a git worktree linked to its own branch, so multiple agents can work on the same repo without conflicts.
- **Agent** — an independent terminal session running inside a worktree. This is where you launch `claude`, `codex`, `aider`, or any CLI agent.

You can have N projects, each with M worktrees, each with K terminal tabs — all managed from a single window.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+T` / `Ctrl+T` | New terminal tab in current worktree |
| `Cmd+W` / `Ctrl+W` | Close current terminal tab |

## Tech stack

- **Electron** + **electron-vite** — desktop shell
- **React 19** + **TypeScript** — UI
- **xterm.js** + **node-pty** — real terminal emulation
- **Tailwind CSS v4** — styling
- **TanStack Query** — state management

## Getting started

```bash
npm install
npm run dev
```

## How it works

1. Open a project folder (it auto-detects if it's a git repo).
2. If it's a git repo, the sidebar shows all existing worktrees.
3. Create new worktrees from the sidebar — Electree runs `git worktree add` with a new branch for you.
4. Select a worktree to open a terminal session rooted in that worktree's directory.
5. Open multiple terminal tabs per worktree (`Cmd+T`) to run agents in parallel.
6. Delete worktrees when done — Electree cleans up with `git worktree remove` + `prune`.

## Notes

- Workspace config is persisted in Electron's user data directory.
- New worktrees are created under `.claude-worktrees/<repo>/<branch>`.
- Worktree deletion uses `git worktree remove` (without `--force`) — git will block the operation if there are unsaved changes.
