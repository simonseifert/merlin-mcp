# Contributing

Thanks for helping. This is a small, careful project: it holds a student's Moodle token, so the bar for new behaviour is "safe by default".

## Before you open a pull request

- `npm ci && npm run typecheck && npm test` must pass (CI runs the same).
- Touching `dashboard/`: `npm --prefix dashboard ci && npm --prefix dashboard run build && npm --prefix dashboard run build:direct` must pass too. The direct build imports `src/dashboard-build.ts` and `src/lib.ts`, so keep those free of Node and Workers APIs.
- Docs state counts and settings that tests check (`test/docs.test.ts`): if you add a tool, an `/api/call` function or an environment variable, update README.md, SECURITY.md and `merlin.env.example` with it.
- New tools and new `/api/call` functions are read-only. Read the Moodle source of a function first: no writes, no `*_view_*` calls (they log events), nothing that marks things read unless documented, nothing that mints a credential.
- Add a test for every new tool or route.
- Never put a real token, real names, grades or messages in code, tests, issues or screenshots. Use obviously fake data.

## Will not be merged

Features that act on graded work or speak for the student without them: quiz attempts or answers, assignment save/submit/upload, forum posts, grading anything, or sends without the phone approval. They risk academic-integrity problems and the user's account.

## Releasing (maintainer)

1. Merge or close open Dependabot PRs, then `npm audit --omit=dev`.
2. CHANGELOG: rename "Unreleased" to `## X.Y.Z (YYYY-MM-DD)` and check it covers `git log vPREV..main`.
3. Bump the version in `package.json` (and `package-lock.json`, via `npm version X.Y.Z --no-git-tag-version`) and `VERSION` in `src/lib.ts`. `test/docs.test.ts` fails until all three and the CHANGELOG heading agree.
4. `npm run typecheck && npm test && npm run build:node && npm run build:dashboard && npm --prefix dashboard run build:direct`.
5. Smoke test against the fake Merlin (examples/README.md): `/healthz`, a tool call, `/dashboard/?demo`, the dashboard with `DASHBOARD_KEY=demo`.
6. Commit "Release X.Y.Z", `git tag -a vX.Y.Z -m "X.Y.Z"`, push main and the tag, `gh release create vX.Y.Z` with the CHANGELOG section as notes.
7. Deploy (`npm run deploy`) and check `/healthz` shows the new version, `moodle_whoami` answers for each year, and `/dashboard/` loads.

## Reporting security problems

Privately, see [SECURITY.md](SECURITY.md). Not in a public issue.
