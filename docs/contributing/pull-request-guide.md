# Pull Request Guide

This guide covers the complete workflow for contributing code via pull requests.

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable production releases |
| `develop` | Integration branch — **all PRs target here** |
| `feat/*` | New features |
| `fix/*` | Bug fixes |
| `chore/*` | Tooling, deps, refactors |
| `docs/*` | Documentation only |

## Step-by-Step Workflow

### 1. Sync your local develop

Before creating a branch, make sure your local `develop` is up to date:

```bash
git checkout develop
git pull origin develop
```

### 2. Create a feature branch

Branch off from `develop`:

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/the-bug-description
```

Keep branch names lowercase and hyphenated. Examples:
- `feat/telegram-channel`
- `fix/scheduler-stuck-detection`
- `chore/upgrade-hono`

### 3. Make your changes

Work on your branch. Commit often with clear messages following [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git add .
git commit -m "feat(scheduler): add backoff for stuck tasks"
```

Common commit types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.

### 4. Push your branch

```bash
git push origin feat/your-feature-name
```

### 5. Open a Pull Request

Go to the repository on GitHub. You'll see a banner prompting you to open a PR — click **Compare & pull request**.

**Key settings:**
- **Base branch**: `develop` (not `main`)
- **Title**: Follow the same Conventional Commits style, e.g. `feat(agent): add skill hot reload`
- **Description**: Fill in the PR template (see below)

### 6. Pass CI checks

The PR CI will automatically run:
- `bun typecheck` — TypeScript type checking
- `bun test` — Unit tests

All checks must pass before merging. Fix any failures on your branch and push again.

### 7. Request a review

Assign at least one reviewer. Address feedback by pushing additional commits — don't force-push after review has started.

### 8. Merge

Once approved and CI is green, use **Squash and merge** to keep `develop` history clean.

---

## PR Description Template

When opening a PR, use this structure:

```markdown
## What

Short description of what this PR does.

## Why

Why is this change needed? Link to issue if applicable.

## How

Key implementation decisions, if non-obvious.

## Testing

How did you verify this works?
- [ ] Manual test: describe steps
- [ ] Unit tests added/updated
```

---

## Tips

- **One concern per PR.** Keep PRs focused — easier to review and revert.
- **Draft PRs are fine.** Open a draft early to get early feedback or block CI.
- **Rebase before review.** If `develop` moved ahead, rebase your branch: `git rebase origin/develop`.
- **Self-review first.** Read your own diff before requesting review. Catch obvious issues yourself.
- **Link issues.** Use `Closes #123` in the PR description to auto-close related issues on merge.
