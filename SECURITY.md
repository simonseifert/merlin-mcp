# Security

**TL;DR:** The server holds one person's Moodle token and exposes it to AI agents, so the design assumes the agent can be tricked (prompt injection from Merlin content) and that a bearer can leak. Reads are limited to an exact list of functions, nothing writes to Merlin except an optional message send that needs a tap on your phone, and the token never leaves the server.

## Reporting a problem

Open a private security advisory on this repository (GitHub > Security > Report a vulnerability), or email the maintainer listed in the repository profile. Please don't open a public issue for anything that could expose someone's token.

## Threat model

| Threat | What stops it |
|---|---|
| A Merlin message, forum post or notification tells the agent to do something | Every tool is read-only. The one write, `moodle_send_message`, only creates a pending send; it goes out after a `POST` with a 192-bit key that only your phone relay sees. The agent never gets the key. |
| A "read" call that actually writes | `/api/call` accepts an exact, reviewed list of 19 functions and nothing else. No `*_view_*` function (they log events and change completion), nothing that mints a credential (autologin keys, QR tokens, calendar export tokens). The MCP tools use fixed functions. `core_message_get_messages` is forced to `markasread=0`. |
| A leaked bearer | Three separate secrets: `MCP_BEARER` opens only `/mcp`, `API_BEARER` only `/api/*`, `RELAY_BEARER` only `/api/pending`. None of them can send a message. Bearers are compared in constant time. |
| The token leaking through responses | The token is added server-side and sent in a POST body. Errors have it redacted. Credential fields (`userprivateaccesskey`, keys inside `tokenpluginfile.php` URLs, in plain, HTML-entity, percent-encoded and JSON-escaped forms) are stripped from every response. Callers can't override `wstoken`, `wsfunction` or `moodlewsrestformat`, including through PHP-style array parameter names. |
| The server used as a proxy elsewhere | `/api/file` only fetches `https://moodle.srce.hr/...` (parsed host check) and refuses redirects. |
| Hammering Merlin | At most 120 Moodle calls a minute per process, and a pause for `Retry-After` after a 429 or 503. Callers get a 429 back and should cache. |
| Approval links leaking | They need `POST` (link previews can't approve), work once, expire after 30 minutes, and their responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. At most 10 sends a day and 5 undecided at once. |

## Known side effects (by design)

- `moodle_get_forum_discussion` (`mod_forum_get_discussion_posts`) marks the returned posts read on Moodle 5.2, the same as opening the thread in a browser.
- Calls show up in Merlin's logs under your account, with this server's User-Agent. That's intended: the client is honest about what it is. Set `MOODLE_CONTACT` so the site admins can reach you.

## Not covered

- Someone with shell access to the machine running the server or the relay can read its secrets.
- The token is the same one the official mobile app uses for your account. On Merlin, students usually can't revoke it themselves; if it leaks, ask SRCE to revoke it.
- There's no OAuth yet, so web connectors (claude.ai, ChatGPT) aren't supported.
