# Contributing

Thanks for helping. This is a small, careful project: it holds a student's Moodle token, so the bar for new behaviour is "safe by default".

## Before you open a pull request

- `npm ci && npm run typecheck && npm test` must pass (CI runs the same).
- New tools and new `/api/call` functions are read-only. Read the Moodle source of a function first: no writes, no `*_view_*` calls (they log events), nothing that marks things read unless documented, nothing that mints a credential.
- Add a test for every new tool or route.
- Never put a real token, real names, grades or messages in code, tests, issues or screenshots. Use obviously fake data.

## Will not be merged

Features that act on graded work or speak for the student without them: quiz attempts or answers, assignment save/submit/upload, forum posts, grading anything, or sends without the phone approval. They risk academic-integrity problems and the user's account.

## Reporting security problems

Privately, see [SECURITY.md](SECURITY.md). Not in a public issue.
