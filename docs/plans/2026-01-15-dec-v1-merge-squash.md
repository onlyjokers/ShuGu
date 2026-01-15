# DecentralizationV1 Merge-Squash Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Squash-merge `master` (node-graph architecture) into `DecentralizationV1`, reapply local lint fixes, and produce a single combined commit.

**Architecture:** No code changes beyond integration; preserve node-graph architecture from `master` and layer local lint fixes on top. Resolve conflicts by preferring `master` structure, then reapply lint fixes.

**Tech Stack:** Git (merge --squash), pnpm, SvelteKit/TS monorepo.

### Task 1: Snapshot and stash local changes

**Files:**
- Modify: none (git state only)

**Step 1: Confirm branch and status**

Run:
```bash
git status -sb
```
Expected: `## DecentralizationV1` with local changes listed.

**Step 2: Stash all local changes (including untracked)**

Run:
```bash
git stash push -u -m "temp: decv1 lint + work"
```
Expected: `Saved working directory and index state`.

### Task 2: Squash-merge master and reapply lint fixes

**Files:**
- Modify: merge result (varies)

**Step 1: Squash-merge master into current branch**

Run:
```bash
git merge --squash master
```
Expected: `Squash commit -- not updating HEAD` and staged changes.

**Step 2: Reapply local lint fixes**

Run:
```bash
git stash pop
```
Expected: stash applied; resolve conflicts if any.

**Step 3: Resolve any conflicts**

Guideline: Prefer `master` for structure/architecture, then reapply lint fixes on top. Confirm no unmerged paths.

Run:
```bash
git status -sb
```
Expected: no `both modified` or `unmerged` entries.

### Task 3: Verification

**Files:**
- Modify: none

**Step 1: Run lint**

Run:
```bash
pnpm lint
```
Expected: `0 errors`.

**Step 2: Build protocol (if needed by tests)**

Run:
```bash
pnpm --filter @shugu/protocol build
```
Expected: success.

**Step 3: Run node-core tests**

Run:
```bash
pnpm --filter @shugu/node-core test
```
Expected: PASS.

**Step 4: Run node-canvas tests**

Run:
```bash
pnpm test:node-canvas
```
Expected: PASS.

### Task 4: Single combined commit

**Files:**
- Modify: repo-wide (merge + lint fixes)

**Step 1: Stage all changes**

Run:
```bash
git add -A
```
Expected: staged changes only.

**Step 2: Commit**

Run:
```bash
git commit -m "refactor: merge node-graph architecture with lint fixes"
```
Expected: one combined commit on `DecentralizationV1`.
