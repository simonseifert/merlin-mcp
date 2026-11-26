# Security

**TL;DR:** The server holds one person's Moodle token and exposes it to AI agents, so the design assumes the agent can be tricked (prompt injection from Merlin content) and that a bearer can leak. Reads are limited to an exact list of functions, nothing writes to Merlin except an optional message send that needs a tap on your phone, and the token never leaves the server. The web dashboard adds one read-only route with its own key, and a direct build where each student's token stays in their own browser.

## Reporting a problem

Report privately through GitHub: [Security > Report a vulnerability](https://github.com/simonseifert/merlin-mcp/security/advisories/new). Please don't open a public issue for anything that could expose someone's token. You'll get an answer within a week.

## Threat model

| Threat | What stops it |
|---|---|
| A Merlin message, forum post or notification tells the agent to do something | Every tool is read-only. The one write, `moodle_send_message`, only creates a pending send; it goes out after a `POST` with a 192-bit key that only your notifier (or your own relay) sees. The agent never gets the key. |
| A "read" call that actually writes | `/api/call` accepts an exact, reviewed list of 22 functions and nothing else. No `*_view_*` function (they log events and change completion), nothing that mints a credential (autologin keys, QR tokens, calendar export tokens). The MCP tools use fixed functions. `core_message_get_messages` is forced to `markasread=0`. |
| A leaked bearer | Three separate secrets: `MCP_BEARER` opens only `/mcp`, `API_BEARER` only `/api/*`, `RELAY_BEARER` only `/api/pending`. None of them can send a message. Bearers are compared in constant time. |
| The token leaking through responses | The token is added server-side and sent in a POST body. Errors have it redacted. Credential fields (`userprivateaccesskey`, keys inside `tokenpluginfile.php` URLs, in plain, HTML-entity, percent-encoded and JSON-escaped forms) are stripped from every response. Callers can't override `wstoken`, `wsfunction` or `moodlewsrestformat`, including through PHP-style array parameter names. |
| The server used as a proxy elsewhere | `/api/file` and `moodle_read_file` only fetch Moodle's file scripts (`https://moodle.srce.hr/<year>/webservice/pluginfile.php/...` or `/pluginfile.php/...`, default port only), drop any token the caller adds, refuse redirects, and never pass an error page back. `moodle_read_file` also stops reading past 20 MB and parses at most 200 PDF pages per call. |
| Hammering Merlin | At most 120 Moodle calls a minute per process (file downloads included), and a pause for `Retry-After` after a 429 or 503. Callers get a 429 back and should cache. |
| Approval links leaking | Acting needs `POST`; a `GET` only shows a confirm page, so link previews can't approve. Links work once, expire after 30 minutes, and responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; the confirm page adds a strict `Content-Security-Policy` and `X-Frame-Options: DENY`. The key travels to the channel you configure (ntfy topic, webhook): use a long random topic or a protected server. At most 10 sends a day and 5 undecided at once. |

## Dashboard

| Threat | What stops it |
|---|---|
| The dashboard key leaks | `DASHBOARD_KEY` opens `GET /api/dashboard` and nothing else: not `/mcp`, `/api/call`, files or sends. It reads your points, calendar and announcements, so treat the `#key=` link like a password. The page keeps the key in local storage and strips it from the address bar, so it never reaches server logs. |
| Another website reads a local dashboard | A Node server that listens only on loopback (and has no `MERLIN_PUBLIC_URL`) serves the dashboard without a key, but only to requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]`, and whose `Origin`, if sent, is local too. A page that points its own domain at your machine (DNS rebinding) gets 401. `DASHBOARD_OPEN=0` turns key-less mode off. |
| One account seeing another's data | Every server cache entry is keyed by a hash of the token as well as the year, so two tokens never share an answer. The server build always reads the server's own token. |
| Merlin text running as code in the page | Moodle HTML is stripped server-side or in the client and rendered as text. There is no `dangerouslySetInnerHTML`. |

**Direct build.** Each student signs in with their own Merlin account and the browser calls Merlin itself. No server sees the token.

- **The token can do more than the page does.** SRCE's app sign-in hands out a mobile-app token, which Merlin also accepts for sending messages and submitting work. The page's client calls an allow-list of eight read-only functions and refuses everything else in code, but script running in the page could use the token fully. So the build ships a Content-Security-Policy (`connect-src 'self' https://moodle.srce.hr`, scripts only from the site itself, no inline scripts), loads nothing from other sites, and a `_headers` file forbids framing where the host supports it.
- **Where the token lives.** In that browser's local storage, until the student signs out (which also deletes every saved page). It travels only in the POST body to Merlin, never in a URL, with no cookies and no redirects followed.
- **Sign-in links.** A token arriving in the address bar (`#tok=`, the desktop auto-return) is accepted only within 15 minutes of a sign-in this browser started, and once. A link carrying someone else's token cannot sign a student in as that account.
- **Who you trust.** Students trust whoever hosts the page not to change its code. Host it only from a repo you control.

## Known side effects (by design)

- `moodle_get_forum_discussion` (`mod_forum_get_discussion_posts`) marks the returned posts read on Moodle 5.2, the same as opening the thread in a browser.
- `moodle_get_assignments` with `include_feedback=true` (off by default) calls `mod_assign_get_submission_status`, which logs a "feedback viewed" event for each assignment. Course teachers can see it in their logs, marked as a web-service call from the server's IP.
- Calls show up in Merlin's logs under your account, with this server's User-Agent. That's intended: the client is honest about what it is. Set `MOODLE_CONTACT` so the site admins can reach you.

## Not covered

- Someone with shell access to the machine running the server or the relay can read its secrets.
- Anyone who can read your ntfy topic or webhook sees the message text and the approval links, and can approve. Treat `NOTIFY_*` as secrets. Notifications never contain the Moodle token or any bearer.
- The token is the same one the official mobile app uses for your account. On Merlin, students usually can't revoke it themselves; if it leaks, ask SRCE to revoke it.
- There's no OAuth yet, so web connectors (claude.ai, ChatGPT) aren't supported.
- The direct dashboard build cannot protect a token from malware or extensions in the student's own browser.
