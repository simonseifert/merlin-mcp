# Connecting clients to merlin-mcp

**TL;DR:** Every CLI or self-hosted client connects to `https://<your-worker>/mcp` (Streamable HTTP) with the header `Authorization: Bearer $MERLIN_MCP_BEARER`. Snippets below for Claude Code, Codex CLI, Gemini CLI, Cursor, Hermes Agent, OpenClaw and n8n. Install the `merlin` skill (`skills/merlin/`) next to the connection so the agent knows which tool to use and the safety rules. claude.ai and ChatGPT web connectors will NOT work yet: they need OAuth, which this server does not have.

Conventions: replace `<your-worker>` with your worker host (for example `merlin-mcp.<subdomain>.workers.dev`). Keep the bearer in an environment variable named `MERLIN_MCP_BEARER` and never commit its value. Only the MCP bearer opens `/mcp`; the API bearer is rejected there.

Verification status: Claude Code and Codex were checked against their documentation on 2026-10-26 and are in daily use. Hermes and OpenClaw were checked against their live docs on 2026-10-23. Gemini and Cursor come from their docs. Anything marked "(unverified)" could not be confirmed.

## Claude Code

Best: keep the bearer out of `~/.claude.json` entirely with a `headersHelper`, a command Claude Code runs at connect time that prints the headers as JSON. Put the full header value (`Bearer <MCP_BEARER>`) in a file only you can read (`chmod 600`), and point the helper at it:

```json
"merlin": {
  "type": "http",
  "url": "https://<your-worker>/mcp",
  "headersHelper": "python3 -c \"import json,os;print(json.dumps({'Authorization':open(os.path.expanduser('~/.config/merlin-mcp/auth')).read().strip()}))\""
}
```

Now printing the config, or an agent reading it, shows no secret. Alternatives:

- In a project `.mcp.json`, Claude Code expands variables in `url` and `headers`: `"headers": { "Authorization": "Bearer ${MERLIN_MCP_BEARER}" }`. The variable must be set in the environment Claude Code starts in.
- `claude mcp add --transport http merlin https://<your-worker>/mcp --header "Authorization: Bearer $MERLIN_MCP_BEARER"` works, but the shell expands the variable, so the literal value ends up in `~/.claude.json`.

Check with `claude mcp list`. The 15 read tools are annotated `readOnlyHint: true`; `moodle_send_message` is not, so Claude Code keeps asking before it.

## Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.merlin]
url = "https://<your-worker>/mcp"
bearer_token_env_var = "MERLIN_MCP_BEARER"
# or, for any header: env_http_headers = { Authorization = "MERLIN_AUTH_HEADER" }  (value "Bearer ...")
default_tools_approval_mode = "writes"   # read-only tools run without asking, the send still prompts

[mcp_servers.merlin.tools.moodle_send_message]
approval_mode = "prompt"
```

The variable must be set in the environment Codex starts in. Don't set `default_tools_approval_mode = "approve"` on this server: it auto-approves every tool, the send request included (that only creates a pending send, but you lose the in-chat check).

## Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "merlin": {
      "httpUrl": "https://<your-worker>/mcp",
      "headers": { "Authorization": "Bearer $MERLIN_MCP_BEARER" }
    }
  }
}
```

`httpUrl` means Streamable HTTP (plain `url` would select SSE). Environment-variable expansion inside `headers` (`$VAR`) is (unverified); if the header arrives literally, paste the value into the file and keep it out of git. Do not set `trust: true` for this server, so tool calls keep asking.

## Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "merlin": {
      "url": "https://<your-worker>/mcp",
      "headers": { "Authorization": "Bearer ${env:MERLIN_MCP_BEARER}" }
    }
  }
}
```

## Hermes Agent

`~/.hermes/config.yaml` (checked against the Hermes MCP config reference):

```yaml
mcp_servers:
  merlin:
    url: "https://<your-worker>/mcp"
    headers:
      Authorization: "Bearer ${MERLIN_MCP_BEARER}"
```

Put `MERLIN_MCP_BEARER=...` in `~/.hermes/.env`: `${VAR}` and `${env:VAR}` in `url` and `headers` resolve from there at connect time. Streamable HTTP is the default for `url` servers (`transport: sse` selects SSE). Optional: `tools: { exclude: [moodle_send_message] }` hides the send tool. Restart Hermes or run `/reload-mcp` after editing.

## OpenClaw

`~/.openclaw/openclaw.json` (the default state dir; the `mcp.servers` shape is from the OpenClaw docs, the exact file name for your install is (unverified), check `openclaw mcp show merlin`):

```json
{
  "mcp": {
    "servers": {
      "merlin": {
        "url": "https://<your-worker>/mcp",
        "transport": "streamable-http",
        "headers": { "Authorization": "Bearer ${MERLIN_MCP_BEARER}" }
      }
    }
  }
}
```

The docs say `${VAR}` and `Bearer ${VAR}` in `headers` are substituted from the environment and do not trigger the `openclaw mcp doctor` literal-secret warning. Or via the CLI:

```bash
openclaw mcp add merlin --url https://<your-worker>/mcp --transport streamable-http \
  --header "Authorization: Bearer ${MERLIN_MCP_BEARER}"   # header flag format (unverified)
openclaw mcp doctor merlin --probe
```

Do not set `auth: "oauth"` on this server: static `Authorization` headers are ignored while it is on.

## n8n (MCP Client Tool node)

1. Add an **MCP Client Tool** node to an AI Agent workflow.
2. Endpoint: `https://<your-worker>/mcp`. Server transport: **HTTP Streamable**.
3. Authentication: **Bearer**, and create a credential holding the MCP bearer (or **Header** with name `Authorization`, value `Bearer <token>`).
4. Tools to include: select the read tools; leave `moodle_send_message` out for unattended workflows.

For plain scheduled polling (like the notification watcher) the REST `/api/*` routes with the separate API bearer are simpler than MCP. The node's options differ between n8n versions (unverified for your version).

## Installing the skill

Copy or symlink `skills/merlin/` (the folder with `SKILL.md`) into the client's skills directory:

| Client | Where |
|---|---|
| Claude Code | `~/.claude/skills/merlin/` (or `.claude/skills/merlin/` in a project) |
| Codex CLI | `~/.agents/skills/merlin/` per the Codex docs (older setups use `~/.codex/skills/`), or reference the file from `AGENTS.md` |
| Hermes Agent | `~/.hermes/skills/merlin/`, or add a shared dir under `skills.external_dirs` in `config.yaml` (for example `~/.agents/skills`) |
| OpenClaw | `<workspace>/skills/merlin/`, `~/.agents/skills/merlin/` or `~/.openclaw/skills/merlin/` (shared managed library) |
| Gemini CLI, Cursor | no skills directory confirmed (unverified); paste the rules from `SKILL.md` into `GEMINI.md` or a Cursor rule |

```bash
mkdir -p ~/.claude/skills && ln -s "$(pwd)/skills/merlin" ~/.claude/skills/merlin
```

## Not supported yet: claude.ai and ChatGPT web connectors

Custom connectors in claude.ai (web and mobile) and ChatGPT developer mode call the server from Anthropic's or OpenAI's cloud and need OAuth (or no auth). This server only accepts the static bearer, so they cannot connect. Adding OAuth is scoped in `research-2026-10-23-selfhost-compat.md` (about half a day to a day on Workers). claude.ai has a beta static-header option for some organizations, availability (unverified) for personal accounts.

## Self-hosted over stdio (no network, no bearer)

The Node build speaks MCP over stdin/stdout for one local client. It never offers `moodle_send_message` (approving a send needs the HTTP routes), so it is read-only. The Moodle token stays in the environment of that one process.

```bash
npm ci && npm run build:node
claude mcp add merlin -e MOODLE_TOKEN=<token> -- node /path/to/merlin-mcp/dist/node.js --stdio
# or with Docker:
claude mcp add merlin -- docker run -i --rm --env-file /path/to/merlin.env merlin-mcp --stdio
```

Codex, Gemini CLI, Cursor, Hermes and OpenClaw take the same `command` + `args` (+ `env`) shape for stdio servers.
