# Changelog

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
