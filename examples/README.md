# Try it without a Merlin account

**TL;DR:** `fake-moodle.mjs` is a dependency-free stand-in for Merlin with invented data (student "Ana Test", two courses in two academic years, deadlines, grades, a forum thread, a notification, a tiny PDF). Point merlin-mcp at it with `MOODLE_BASE` and you get a working server in three commands. Nothing leaves your machine and any token is accepted.

## Three commands (Node 22.13+)

```bash
npm ci && npm run build:node
node examples/fake-moodle.mjs &                  # fake Merlin on http://127.0.0.1:8790
MOODLE_BASE=http://127.0.0.1:8790 MERLIN_YEARS=2025-2026,2026-2027 MOODLE_TOKEN=anything \
  MCP_BEARER=demo-mcp-bearer MERLIN_DB=/tmp/merlin-demo.sqlite node dist/node.js   # merlin-mcp on :8787
```

Or with Docker: `docker compose -f examples/docker-compose.yml up --build`.

## Check it

```bash
curl -s localhost:8787/healthz
# {"ok":true,"name":"merlin-mcp","version":"0.4.1"}

curl -s localhost:8787/mcp \
  -H 'Authorization: Bearer demo-mcp-bearer' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"moodle_get_grades","arguments":{}}}'

node examples/ask.mjs                        # whoami + deadlines + grades, pretty-printed
node examples/ask.mjs moodle_get_courses     # any tool; JSON arguments as a second argument
```

Point a real MCP client at `http://127.0.0.1:8787/mcp` with the header `Authorization: Bearer demo-mcp-bearer` (see [CLIENTS.md](../CLIENTS.md)).

## Files

- `fake-moodle.mjs`: the fake Merlin. Serves `/<yyyy-yyyy>/webservice/rest/server.php` for the web-service functions the tools use, and `pluginfile.php` for one PDF. Dates are relative to now. `PORT`, `HOST` (default `127.0.0.1`) and `FAKE_MOODLE_QUIET=1` are the only knobs.
- `ask.mjs`: a small MCP client over `/mcp` (`MERLIN_URL`, `MCP_BEARER` override the defaults).
- `docker-compose.yml`: merlin-mcp plus the fake, bound to localhost.
- `dev.vars.example`: for the Cloudflare Worker (`npm run dev`); copy to `.dev.vars`.
- `../docs-assets/demo.tape`: the script behind the README GIF (`vhs docs-assets/demo.tape`, needs vhs, ttyd, ffmpeg).

## Notes

- The ids in the two fake years are different on purpose, so id tools (`moodle_get_course_contents`, forum and quiz tools) find the right year by themselves.
- `/api/file` only proxies `https://moodle.srce.hr` file URLs, so it will not fetch from the fake. `moodle_list_files` still lists the PDF; fetch it straight from the fake if you want to see it.
- Never use this with a real token. The real thing is configured without `MOODLE_BASE`.
