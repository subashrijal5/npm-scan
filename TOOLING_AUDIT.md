# Tooling & Process Audit — npm-scan

Findings from a pass over the repo (`package.json`, `tsconfig.json`, `.gitignore`, `src/`, `bin/`, and git history) looking for missing dev tooling, CI/CD gaps, and process issues. Each section is written so it can be pasted directly into a GitHub issue.

---

## 1. No CI pipeline at all
There is no `.github/workflows` directory (and no CI config for any other provider). Nothing currently runs on push/PR — not tests, not a build, not type-checking. `333bb65` (PR #1) merged with no automated check having run against it.

**Suggested fix:** Add `.github/workflows/ci.yml` that on push/PR:
- installs deps with `bun install --frozen-lockfile`
- runs `bun run build` (or `tsc --noEmit`, see #4)
- runs `bun test`
- (once added) runs lint + format check

## 2. No linter configured
No ESLint (flat config or legacy), no `.eslintrc*`, no lint script, no eslint packages in `devDependencies`. Nothing enforces code style or catches common bugs (unused vars, unsafe `any`, etc.) beyond what `tsc --strict` catches.

**Suggested fix:** Add `eslint` + `typescript-eslint` (flat config, `eslint.config.js`), add a `"lint": "eslint ."` script, wire into CI.

## 3. No Prettier / formatting config
No `.prettierrc*`, no `.editorconfig`, no format script. Code style is currently whatever each contributor's editor produces (already visible: inconsistent quote/semicolon usage between files is not checked anywhere).

**Suggested fix:** Add Prettier config + `"format": "prettier --write ."` / `"format:check": "prettier --check ."` scripts, run the check in CI.

## 4. No standalone type-check script
`tsconfig.json` has `strict: true` and several stricter flags, but nothing runs `tsc --noEmit` directly — the only build path is `bun build ./src/index.ts --outdir ./dist --target node` (`build` script), which is a bundler/transpiler step, not a full type-check. Type errors in files not reached by the bundler's entry graph (e.g. orphaned code, test files) can silently pass.

**Suggested fix:** Add `"typecheck": "tsc --noEmit"` and run it in CI alongside the build.

## 5. No pre-commit hooks
No Husky, no `lint-staged`, no `simple-git-hooks`. Nothing stops a commit with lint errors, unformatted code, or failing tests from landing locally before it even reaches CI.

**Suggested fix:** Add Husky + lint-staged running `eslint --fix` / `prettier --write` on staged files pre-commit (once #2/#3 exist).

## 6. Stale `.gitignore` entry from the project rename
`.gitignore` still ignores `.npm-check-cache.json` (the tool's old pre-rename name — see `999d7ae feat: rename project from npm-check to npm-scan`), but the actual cache file the code writes is `.npm-scan-cache.json` (`src/index.ts:43`, `getDefaultCachePath`). Right now that cache file is **not** gitignored, so running the scanner in this repo risks accidentally `git add`-ing a scan-result cache file.

**Suggested fix:** Update `.gitignore`:
```diff
-.npm-check-cache.json
+.npm-scan-cache.json
```

## 7. `package.json` has a stray, meaningless field
```json
"entry point": "src/index.ts",
```
`"entry point"` (with a literal space) is not a valid `package.json` field (the real entry fields are `main`/`module`/`exports`/`bin`, already set separately). It does nothing and just leaves confusing metadata for future readers.

**Suggested fix:** Remove the `"entry point"` line entirely (or replace usages of it with `exports`, if the intent was to declare an ESM entry point).

## 8. `package.json` is missing standard publish metadata
No `repository`, `bugs`, or `homepage` fields, despite the project being published to npm and hosted on GitHub (`origin` → `github.com/subashrijal5/npm-scan`). This is what makes the "npm" package page link back to the repo/issues.

**Suggested fix:**
```json
"repository": { "type": "git", "url": "git+https://github.com/subashrijal5/npm-scan.git" },
"bugs": { "url": "https://github.com/subashrijal5/npm-scan/issues" },
"homepage": "https://github.com/subashrijal5/npm-scan#readme"
```

## 9. No `engines` field / no Node or Bun version pinned
The project requires Bun to build and test (`build`/`test`/`prepare` scripts all shell out to `bun`), and requires Node to run the published CLI (`bin/npm-scan.js` shebang is `#!/usr/bin/env node`), but nothing declares supported version ranges for either. There's also no `.nvmrc` / `.bun-version` for contributors.

**Suggested fix:** Add an `engines` field (`"node": ">=18"`) and consider a `.bun-version` (or document the required Bun version in the README's contributing section).

## 10. `prepare` script hard-depends on Bun being globally installed
```json
"prepare": "bun run build",
```
`prepare` runs automatically on `npm install` for git/monorepo installs and for local dev clones. Anyone who runs `npm install` (or `yarn`/`pnpm install`) on a fresh clone without Bun installed will get the install itself fail, even though the published npm package doesn't require Bun to *run* (only `node` is needed per `bin/npm-scan.js`).

**Suggested fix:** Either document a hard Bun requirement prominently (README + `engines`), or make `prepare` degrade gracefully / use a Node-based build (`tsc`) so `npm install` works without Bun present.

## 11. No test coverage reporting
`"test": "bun test"` runs the suite but nothing collects or enforces coverage. There's no coverage threshold, and no coverage badge/report artifact from CI (which also doesn't exist yet, see #1).

**Suggested fix:** Add `"test:coverage": "bun test --coverage"`, wire it into CI, optionally enforce a minimum threshold.

## 12. No SECURITY.md
Notably ironic for a project whose entire purpose is dependency **security** scanning: there's no `SECURITY.md` describing how to report a vulnerability in npm-scan itself.

**Suggested fix:** Add a minimal `SECURITY.md` with a contact/reporting process.

## 13. No CONTRIBUTING.md / issue & PR templates
No `.github/ISSUE_TEMPLATE/`, no `PULL_REQUEST_TEMPLATE.md`, no `CONTRIBUTING.md`. The one existing PR (#1, `333bb65`) merged with no template to guide it.

**Suggested fix:** Add basic issue templates (bug/feature) and a PR template checklist (tests pass, lint passes, etc. — ties back into #1/#2/#3).

## 14. Stale/inconsistent authorship metadata
`package.json` `"author": "Ankur Singh"` — but the repo's remote is `github.com/subashrijal5/npm-scan` and the only merged PR (`333bb65`) came from `ankur700` as a contributor, not the primary author. Worth a quick manual check that `author`/contributor credit in `package.json` and README reflect who actually owns/maintains the project now.

**Suggested fix:** Confirm and correct the `author` field (and consider a `contributors` array) to match actual project ownership.

## 15. `.agents/skills/...` directory is committed to the repo
`.agents/skills/cli-best-practices/SKILL.md` is tracked in git. This looks like local AI-assistant tooling config rather than project source — worth a deliberate decision on whether it belongs in version control or should be gitignored/moved to a personal config location.

**Suggested fix:** Confirm intent; if it's personal tooling, add `.agents/` to `.gitignore` and remove it from the repo.

## 16. Minor: `isGithubUrl` regex isn't end-anchored
`src/utils.ts:27`:
```ts
if (/^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(trimmed)) return true;
```
This has no `$` anchor, so a string like `https://github.com/foo/bar and-then-anything-else` still matches and gets passed as a single argument to `git clone` via `execa` (`src/utils.ts:52`). `execa` doesn't invoke a shell, so this isn't directly exploitable as command injection, but it's a validation gap — it'll produce a confusing "failed to clone" error instead of a clear "invalid URL" one, and is worth tightening defensively.

**Suggested fix:** Anchor the regex (`...[\w.-]+\/?$/i`) or otherwise validate the parsed URL more strictly before passing it to `git clone`.

---

## Suggested issue breakdown
If filing these as separate GitHub issues, a reasonable grouping is:
1. **CI**: #1 (pipeline), bundling in lint/format/typecheck/coverage checks once they exist
2. **Tooling**: #2 (ESLint), #3 (Prettier), #4 (typecheck script), #5 (pre-commit hooks), #11 (coverage)
3. **Package hygiene**: #6 (gitignore), #7 (stray field), #8 (repo metadata), #9 (engines), #10 (prepare/Bun dependency), #14 (author)
4. **Repo process**: #12 (SECURITY.md), #13 (CONTRIBUTING + templates), #15 (.agents dir)
5. **Code correctness (low severity)**: #16 (regex anchoring)
