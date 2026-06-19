# CLAUDE.md

Read **[`AGENTS.md`](./AGENTS.md)** in this repo. All project rules and context live
there (and in `RULES.md`, which it points to). This file exists only so that
Claude-based tools have a first-class entry point.

On Linux you can replace this file with a symlink so there is only one real file to
maintain:

```bash
rm CLAUDE.md
ln -s AGENTS.md CLAUDE.md
```
