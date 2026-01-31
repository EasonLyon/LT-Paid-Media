---
name: npm-lint-build-fix
description: When asked to fix lint/build, run `npm run lint` then `npm run build`, fix failures with minimal diffs, and report PASS/FAIL plus commands.
---

## Rules
- Use npm only.
- Keep diffs minimal; don’t refactor unless required.
- Don’t disable lint rules globally unless there is no safe alternative.
- Never add/commit real secrets. If build fails due to missing env vars, update `.env.example` with empty keys or add safe runtime guards.

## Steps (always in this order)
1) Install
- Run: `npm ci`
- If it fails, fix dependency/lockfile/tooling issues first (don’t blindly delete lockfiles).

2) Lint
- Run: `npm run lint`
- Fix lint errors with smallest change possible.

3) Build
- Run: `npm run build`
- Fix build errors (Next.js: client/server boundary, window/document usage, import/export mistakes).

4) Verify
- Re-run the failed command first.
- Then ensure both pass:
  - `npm run lint`
  - `npm run build`

## Response format (always)
Gates:
- npm ci: PASS/FAIL
- lint: PASS/FAIL
- build: PASS/FAIL

Changes made:
- list files changed + 1-line reason

Commands run:
- list exact commands executed

If still failing:
- key error lines + 2–3 next-step options
