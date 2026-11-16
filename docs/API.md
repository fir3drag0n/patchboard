# The read-only API

Scripts, Home Assistant and AI tools can read what Patchboard knows: what
needs you, the containers, the server and any widget's number. The API
changes nothing and never shows an integration's address or key.

## Keys

Make a key in Settings, Connections, Sign-in and keys, API keys. Name it
after what will use it, so you know which one to revoke. Patchboard shows the
key once and keeps only a hash. Send it as a header:

```sh
curl -H "Authorization: Bearer pb_..." http://nas:3200/api/v1/status
```

A key opens `/api/v1` and nothing else. With sign-in off, `/api/v1` also
answers without a key, like the rest of Patchboard. The address has to be one
Patchboard answers to: an IP address, a home name such as `nas.local`, or a
name in `ALLOWED_HOSTS`.

## Endpoints

Every one is a `GET` that returns JSON. Times are ISO 8601.

| Path | What it returns |
| --- | --- |
| `/api/v1/status` | `ok`, `warning` or `critical`, a one-line summary, every problem worst first, and how many containers run |
| `/api/v1/alerts` | Everything in Needs attention, notes included: level, title, detail, since, source, link |
| `/api/v1/containers` | Each container's state, health, stack, image, CPU, memory and whether an update waits. `?q=` matches a name or image, `?stack=` one compose project, `?problems=1` only stopped or unhealthy ones |
| `/api/v1/containers/{name}` | One container |
| `/api/v1/server` | CPU, load, memory, storage, uptime and each UPS |
| `/api/v1/boards` | Each board and its widgets, with `hasNumber` on the ones you can read |
| `/api/v1/boards/{board}/widgets/{widget}` | That widget as one number, as One number shows it: `value`, `detail`, `tone`. `?units=c` for Celsius |

## MCP

`/api/v1/mcp` serves the same answers as MCP tools, over HTTP: `get_status`,
`list_containers`, `get_server`, `list_boards` and `read_widget`. Every tool
is marked read-only.

Claude Code:

```sh
claude mcp add --transport http patchboard http://nas:3200/api/v1/mcp --header "Authorization: Bearer pb_..."
```

Claude Desktop and other tools that start a local command can use
`mcp-remote`:

```json
{
  "mcpServers": {
    "patchboard": {
      "command": "npx",
      "args": ["mcp-remote", "http://nas:3200/api/v1/mcp", "--allow-http", "--header", "Authorization:${AUTH}"],
      "env": { "AUTH": "Bearer pb_..." }
    }
  }
}
```

Then ask "what needs fixing on my server?" or "is Plex running?".

## Home Assistant

A REST sensor for the status, with the summary and counts as attributes. Put
`patchboard_auth: "Bearer pb_..."` in `secrets.yaml`.

```yaml
sensor:
  - platform: rest
    name: Patchboard
    resource: http://nas:3200/api/v1/status
    headers:
      Authorization: !secret patchboard_auth
    value_template: "{{ value_json.status }}"
    json_attributes:
      - summary
      - containers
    scan_interval: 60
```
