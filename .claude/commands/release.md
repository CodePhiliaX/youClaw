---
description: "Create a release — stable or beta. Usage: /release [beta]"
argument-hint: "[beta]"
---

# Release Command

Create a new YouClaw release (stable or beta) with auto-generated changelog.

## Arguments

The user's arguments are: $ARGUMENTS

- If arguments contain "beta" or "测试" → **Beta release**
- Otherwise → **Stable release**

## Step 1: Determine Release Type & Version

Run these commands to compute the next version:

```bash
# Get latest stable tag
git fetch --tags
LATEST_STABLE=$(git tag --sort=-v:refname | grep -E '^v0\.0\.[0-9]+$' | head -1)
echo "Latest stable: $LATEST_STABLE"
```

**For stable release:**
- Extract X from `v0.0.X`, compute `v0.0.(X+1)`

**For beta release:**
- Compute next stable version `v0.0.(X+1)`
- Find existing betas: `git tag -l "v0.0.(X+1)-beta.*" --sort=-v:refname | head -1`
- If exists: increment N → `v0.0.(X+1)-beta.(N+1)`
- If none: `v0.0.(X+1)-beta.1`

## Step 2: Pre-flight Checks

Run these checks and abort if any fail:

1. **Branch check**: Must be on `main` branch (for stable) or any branch (for beta)
   ```bash
   git branch --show-current
   ```

2. **Clean working tree**:
   ```bash
   git status --porcelain
   ```
   If not clean, warn the user and ask whether to proceed.

3. **Tag doesn't exist**:
   ```bash
   git tag -l "vX.Y.Z"
   ```

4. **Has new commits** since last stable tag:
   ```bash
   git log $LATEST_STABLE..HEAD --oneline | grep -v "^.*Merge " | head -20
   ```
   If no commits, abort.

## Step 3: Generate Changelog

Read commits since last stable tag:
```bash
git log $LATEST_STABLE..HEAD --oneline --no-merges
```

Generate a changelog in Chinese following this format:

```markdown
> One-line English summary of this release

## ✨ New Features
- **Feature name**：Chinese description of what it does

## 🚀 Improvements
- **Improvement name**：Chinese description of what changed

## 🐛 Bug Fixes
- Chinese description of the fix

## 🔧 CI/CD
- Chinese description of CI changes
```

**Rules:**
- Map commit prefixes: `feat` → ✨ New Features, `fix` → 🐛 Bug Fixes, `refactor`/`perf`/`style` → 🚀 Improvements, `ci`/`build` → 🔧 CI/CD
- Group related commits by feature/topic — do NOT list every commit individually
- Write meaningful Chinese summaries, not just translations of commit messages
- Omit empty sections
- Do NOT include a Contributors section (GitHub shows contributor avatars automatically)
- For beta releases, still include all changes since last stable

## Step 4: Confirm with User

Show the user:
- Release type (stable / beta)
- Version tag: `vX.Y.Z`
- Changelog preview

Ask for explicit confirmation before proceeding. This is a destructive operation (creates a tag and pushes it).

## Step 5: Create Tag & Push

```bash
# Create annotated tag
git tag -a vX.Y.Z -m "YouClaw vX.Y.Z

CHANGELOG_CONTENT_HERE"

# Push tag to trigger CI
git push origin vX.Y.Z
```

## Step 6: Update GitHub Release

CI automatically creates a GitHub Release when the tag is pushed. Wait for it and update with the changelog:

```bash
# Poll until release exists (max 3 minutes)
for i in $(seq 1 18); do
  if gh release view vX.Y.Z --json tagName -q .tagName 2>/dev/null; then
    break
  fi
  sleep 10
done

# Update release notes
gh release edit vX.Y.Z --title "YouClaw vX.Y.Z" --notes "CHANGELOG_CONTENT"
```

## Step 7: Report

Print:
- ✅ Release URL: `https://github.com/CodePhiliaX/youclaw/releases/tag/vX.Y.Z`
- CI builds are in progress — artifacts will appear when complete
- For stable releases: OSS upload and updater manifest will be generated after builds complete
