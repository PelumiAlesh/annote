# Annote

**Visual feedback for coding agents.**

Point at the UI. Type or dictate feedback. Let your coding agent understand exactly what you mean.

Annote attaches feedback to the actual interface with DOM, CSS, React, accessibility and motion context, then makes it available to coding agents over MCP.

[Website](https://annote-ui.netlify.app/) · [npm](https://www.npmjs.com/package/annote) · [MIT License](./LICENSE)

## Give this to your coding agent

The easiest way to set up Annote is to let your agent do it.

```text
Set up Annote for this project using https://github.com/PelumiAlesh/annote.

Install Annote as a development dependency and load its browser bundle only in development and only in the browser.

Configure Annote MCP for yourself without overwriting my existing MCP configuration, verify that it works, and tell me anything I need to restart.

When you're done, explain how I should use Annote and remind me to open Annote → Settings → MCP and authorize this site once.
```

Then annotate your interface and tell your agent:

```text
Check my Annote feedback and implement it.
```

## How it works

1. Annote runs on your development interface.
2. Point at an element and leave a note, style change or motion change.
3. Annote captures structured context about what you selected.
4. Your coding agent reads that feedback through MCP.
5. The agent can reply, claim feedback, implement it and mark it resolved.

No screenshots to explain. No "the button on the left."

## Install

Requires Node.js 18 or newer.

```bash
npm install --save-dev annote
```

Load Annote from a browser-only development entry point:

```js
import "annote/dist/annote.iife.js";
```

Do not include Annote in your production application bundle.

How you gate the import depends on your framework. The important part is that it only runs in development and in the browser.

### Configure MCP

Run:

```bash
npx annote init
```

Annote detects supported coding-agent configurations and asks before making changes.

Restart any affected coding agent after setup.

Then open your application, open:

```text
Annote → Settings → MCP
```

and authorize the current site once.

After that your agent can read Annote feedback.

### Manual MCP command

If you prefer to configure your MCP client manually, use Annote as a stdio MCP server:

```json
{
  "command": "npx",
  "args": ["-y", "annote", "server"]
}
```

Adapt that entry to your client's MCP configuration format.

## Compatibility

Annote works with MCP-capable coding agents including Codex, Claude Code, Cursor, OpenCode, Hermes Agent, Gemini CLI and other MCP clients.

| Client | Detect | Auto-configure | Notes |
| --- | --- | --- | --- |
| Codex | ✓ | ✓ | `~/.codex/config.toml` |
| Claude Code | ✓ | ✓/CLI | Prefers `claude mcp add` |
| Cursor | ✓ | ✓ | `~/.cursor/mcp.json` |
| OpenCode | ✓ | ✓ | `~/.config/opencode/opencode.json` (preserves JSONC) |
| Hermes Agent | ✓ | ✓ | `~/.hermes/config.yaml` via `hermes mcp add` or YAML |
| Gemini CLI | ✓ | ✓ | `~/.gemini/settings.json` via `gemini mcp add` |
| VS Code / Copilot | ✓ | ✓ | `.vscode/mcp.json` |
| Kilo Code | ✓ | ✓ | `~/.config/kilo/kilo.json` |
| Windsurf | ✓ | Manual | `~/.codeium/windsurf/mcp_config.json` — UI managed |
| Zed | ✓ | Manual | `settings.json` `context_servers` — manual |
| Cline | ✓ | Manual | Cline extension — manual |
| Roo Code | ✓ | ✓ | `~/.roo/mcp.json` |
| Goose | ✓ | Manual | `~/.config/goose/config.yaml` — manual |

## Use Annote

Activate Annote and point at an element.

You can:

* leave implementation notes
* mark feedback as a Fix, Ask or Note
* dictate feedback with your voice
* inspect and edit CSS
* edit animation timing and easing
* inspect React component context
* select multiple elements by holding `Shift`
* review pending feedback
* continue a feedback conversation with your coding agent

When you're ready, tell your agent:

```text
Check my Annote feedback.
```

## Bookmarklet

If you want to use Annote without adding it to a project, use the bookmarklet installer:

[https://annote-ui.netlify.app/](https://annote-ui.netlify.app/)

Drag **Annote** to your bookmarks bar, then click it on a page to load Annote.

The bookmarklet loads the published Annote browser bundle (`annote@latest`) from npm through jsDelivr, so it stays up to date automatically.

It works on many normal webpages, but some pages may block injected scripts due to Content Security Policy or browser restrictions. That is a platform limitation, not an Annote bug — if the bookmarklet cannot run on a page, it says so instead of failing silently.

For development projects, installing Annote through npm is the recommended and most reliable option.

## MCP tools

Annote exposes (programmatic names are stable; clients that support
display titles show the human-readable title instead):

| Tool                       | Display title            | Purpose                                 |
| -------------------------- | ------------------------ | --------------------------------------- |
| `annote_list_sessions`     | List Annote sessions     | List connected Annote browser sessions  |
| `annote_list`              | List annotations         | List current annotations                |
| `annote_get`               | Get annotation details   | Get complete context for one annotation |
| `annote_get_pending`       | Get pending feedback     | Get pending feedback for a session      |
| `annote_get_all_pending`   | Get all pending feedback | Get pending feedback across sessions    |
| `annote_watch_annotations` | Watch for Annote feedback | Wait for new feedback                  |
| `annote_claim`             | Claim feedback           | Claim feedback before implementing it   |
| `annote_reply`             | Reply to feedback        | Reply to an annotation                  |
| `annote_resolve`           | Resolve feedback         | Mark implemented feedback resolved      |
| `annote_dismiss`           | Dismiss feedback         | Intentionally dismiss feedback          |

Each annotation carries an `intent`: `fix` (implement the change),
`ask` (answer the question; do not modify code merely because the
annotation exists), or `note` (context only; do not implement solely
because it exists).

## Browser API

The browser bundle exposes:

```js
window.__ANNOTE__
```

with:

```js
window.__ANNOTE__.mount()
window.__ANNOTE__.toggle()
window.__ANNOTE__.activate()
window.__ANNOTE__.deactivate()
window.__ANNOTE__.destroy()
window.__ANNOTE__.getAnnotations()
window.__ANNOTE__.clear()
```

## Local by design

Annote's MCP companion binds only to `127.0.0.1`.

Browser access requires explicit approval for the exact site origin. Annotation content remains canonical in the browser, and the local companion keeps only an in-memory synchronized mirror.

The bridge does not expose your filesystem, shell, Git credentials, cookies, authorization headers, browser storage, network captures or arbitrary page HTML.

See [docs/mcp-threat-model.md](./docs/mcp-threat-model.md).

## Troubleshooting

```bash
npx annote status
```

```bash
npx annote doctor
```

If you just configured MCP, restart your coding agent.

If the browser is connected but the agent cannot see annotations, make sure the site's origin has been authorized under:

```text
Annote → Settings → MCP
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

Local site:

```text
http://localhost:4173
```

## License

MIT © Pelumi Alesh
