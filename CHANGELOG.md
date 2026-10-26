# Changelog

## Unreleased

- Built-in notifier: set `NOTIFY_NTFY_URL` (+ `NOTIFY_NTFY_TOKEN`) or `NOTIFY_WEBHOOK_URL` (+ `NOTIFY_WEBHOOK_FORMAT=json|discord`) and a new send request pushes the recipient, full text and Send / Reject links to your phone, with a short outcome message after. No relay script needed; `RELAY_BEARER` and `/api/pending` still work.
- `GET /api/approve/<id>` and `/api/reject/<id>` now show a confirm page (one `POST` button, strict CSP, never acts) instead of 405.
- The send tool is offered when `RELAY_BEARER` or a notifier is configured.
- The Worker passes `ctx` through so notifications finish after the response.
- `scripts/get-token.mjs` and a step-by-step "Getting your token" guide in the README.
- Tests for every MCP tool through `/mcp`, plus a guard that fails if any tool sends a Moodle function that isn't a plain read (222 tests).
- A fake Merlin for demos and local development (`examples/`), a docker-compose file, a Mermaid architecture diagram and a demo GIF in the README.

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
