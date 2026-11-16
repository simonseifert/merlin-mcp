# Changelog

## 0.5.1 (2026-11-16)

- Updates no longer fail a whole course because of one broken activity. Merlin's `core_course_get_updates_since` answered "Error reading from database" on 8 of 18 courses; testing activity by activity showed the cause is specific quizzes, while every other activity answers fine. Why those quizzes fail is not known: since 5.2.2 Moodle hides error details from web-service callers, so only the site's own logs show the failing query. Moodle checks all activities in one pass, so one bad quiz fails the course. On that error the server now uses `core_course_check_updates`, the same read-only code for named activities: other activities in one batch (up to 300, sent in the POST body; a failing batch is split in half until the broken one stands alone), then all quizzes not yet proven fine in one batch, and one by one only if that batch fails. What it learns is kept for a day, in memory and as one note in the approval store (Durable Object on Workers, SQLite on Node), so a fresh isolate doesn't start over and later calls take one or two requests per course. Budget: at most 25 such calls for one course (`moodle_get_updates_since`, `/api/call`) and 10 shared across all courses in `moodle_get_all_updates_since` (at most 4 single-quiz checks per course there), because a Worker on the free plan may make only about 50 outgoing requests per invocation. Courses are worked through one at a time; a course the remaining budget can't cover falls back to file times and is narrowed down on a later call, and activities left over are counted as `notchecked`.
- Only Moodle's `dmlreadexception` starts the fallback or marks an activity broken; other Moodle errors, HTTP failures and the rate brake are passed on as before. The token is now the first field of every request body.
- `moodle_get_updates_since` lists skipped activities in `warnings` (`merlinerror` / `notchecked`). `moodle_get_all_updates_since` lists them once in `skipped_activities` (per course: `broken` and `not_checked_yet`) and shows real changes for those courses instead of only new files; the file-time fallback stays as a last resort.
- `/api/call` with `core_course_get_updates_since` (courseid and since only) goes through the same fallback, so scripts get it without changes. `core_course_check_updates` is not on the `/api/call` list itself.

## 0.5.0 (2026-11-16)

- `moodle_get_quiz_details`: quiz rules without starting an attempt (open/close, time limit, attempts allowed, used and left, grading method, max grade).
- `moodle_get_my_groups`: your groups per course. Groupings are left out: Moodle only shows them to teachers.
- `moodle_get_new_forum_posts`: new discussions across every course since a time (announcement forums by default), through the same non-marking discussion list as `moodle_get_recent_forum_posts`.
- `moodle_get_choices`: sign-ups and polls with options, fill level and your pick. Read-only.
- `moodle_get_all_updates_since`: changes in every course in one call, with activity names. Merlin's `core_course_get_updates_since` fails with a database error on about half the courses (both years, 16 Nov 2026); those are marked `partial` and show new or changed files from the content tree instead.
- `moodle_get_upcoming_deadlines`: quiz items carry the time limit and attempts left.
- Not built: attendance (`mod_attendance` is not in Merlin's mobile service).
- The fake Merlin in `examples/` covers groups, choices and quiz settings.
- Pre-release review fixes: deadline quiz context matches by cmid and course (quiz ids and cmids never share a key); one failing forum no longer blanks a year in `moodle_get_new_forum_posts` (reported in `forum_errors`, at most 30 forums per year); the rate brake surfaces as an error instead of "partial" courses; choice `full` comes from the answer counts; attempt lists are cached for a minute and deadlines look up at most 15 quizzes; PDFs stop cleanly at `max_chars` with a `next_page` to continue from.
- `moodle_read_file`: the text of one course file (PDF page by page via unpdf, plain text, Markdown, CSV, JSON, HTML), with a page range, a character cap, a 20 MB limit and at most 200 PDF pages per call. It shares `/api/file`'s checks (Moodle file URLs only, server-side token, no redirects, no error pages).

## 0.4.2 (2026-11-15)

- Built-in notifier: set `NOTIFY_NTFY_URL` (+ `NOTIFY_NTFY_TOKEN`) or `NOTIFY_WEBHOOK_URL` (+ `NOTIFY_WEBHOOK_FORMAT=json|discord`) and a new send request pushes the recipient, full text and Send / Reject links to your phone, with a short outcome message after. No relay script needed; `RELAY_BEARER` and `/api/pending` still work.
- `GET /api/approve/<id>` and `/api/reject/<id>` now show a confirm page (one `POST` button, strict CSP, never acts) instead of 405.
- The send tool is offered when `RELAY_BEARER` or a notifier is configured.
- The Worker passes `ctx` through so notifications finish after the response.
- `scripts/get-token.mjs` and a step-by-step "Getting your token" guide in the README.
- Tests for every MCP tool through `/mcp`, plus a guard that fails if any tool sends a Moodle function that isn't a plain read (249 tests in total now).
- A fake Merlin for demos and local development (`examples/`), a docker-compose file, a Mermaid architecture diagram and a demo GIF in the README.
- Node: approval links are built from `MERLIN_PUBLIC_URL` or localhost and the listening port, never from the request's Host header or target.
- Worker: the unused `MerlinMCP` Durable Object stub is deleted (migration `v3`). Rolling back to a Worker version before 0.4.2 is no longer possible.
- Hono 4.13.18 and @hono/node-server 2.1.8 (moderate advisories; none affected features used here), TypeScript 7, newer Actions.

## 0.4.1 (2026-10-26)

First tagged release.

- Read tools carry `readOnlyHint: true`, so clients can run them without a confirm prompt; the send tool still asks.
- `moodle_get_assignments` no longer fetches feedback by default (`include_feedback=false`): each feedback read logs a "feedback viewed" event teachers can see.
- A clear error when Moodle rejects the token (`invalidtoken`), pointing to the token guide.
- `GET /healthz` (no auth, no Moodle call) and a Docker `HEALTHCHECK`.
- `/api/file` counts against the rate brake, only proxies Moodle's file scripts, drops caller-supplied tokens and never streams error pages.
- Node: listens on `127.0.0.1` unless `HOST` is set; handles broken response streams; no database file in stdio mode; clean shutdown on SIGTERM.
- The User-Agent carries the version and the repository URL.
- Removed the ignored `approved_by_simon` parameter from `moodle_send_message`.
- `MCP_BEARER` opens `/api/*` only when `LEGACY_API_BEARER="1"` (closed by default).
- MCP SDK 1.32.2; CI (typecheck, tests, Node build, dependency audit) and Dependabot.

## 0.4.0 (2026-10-24)

First public version: stateless Streamable HTTP on Cloudflare Workers and Node/Docker (HTTP or stdio), 16 tools across every active academic year, an exact allow-list for `/api/call`, rate brakes, credential stripping, and message sends gated by a phone approval.
