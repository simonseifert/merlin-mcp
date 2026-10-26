# Renders docs-assets/demo.gif. Run from the repo root after `npm ci && npm run build:node`:
#   vhs docs-assets/demo.tape
# Needs vhs (charmbracelet), ttyd and ffmpeg. Everything shown is fake data from examples/fake-moodle.mjs.
Output docs-assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 960
Set Height 600
Set Padding 16
Set Theme "Dracula"
Set TypingSpeed 40ms
Set Framerate 20

Hide
Type "export PS1='$ ' MOODLE_BASE=http://127.0.0.1:8790 MERLIN_YEARS=2025-2026,2026-2027 MOODLE_TOKEN=anything MCP_BEARER=demo-mcp-bearer MERLIN_DB=/tmp/merlin-demo.sqlite NODE_NO_WARNINGS=1 FAKE_MOODLE_QUIET=1" Enter
Type "node examples/fake-moodle.mjs >/dev/null 2>&1 &" Enter
Type "node dist/node.js >/dev/null 2>&1 &" Enter
Type "sleep 2; clear" Enter
Show

Type "# a fake Merlin and merlin-mcp are running locally" Enter
Sleep 800ms
Type "curl -s localhost:8787/healthz; echo" Enter
Sleep 1500ms
Type "node examples/ask.mjs" Enter
Sleep 7s
Hide
Type "kill %1 %2" Enter
Sleep 500ms
