# Annote MCP V1 Threat Model

Annote can run on arbitrary webpages. A host page can execute its own JavaScript, so secrets embedded in a bookmarklet or browser bundle are not treated as durable secrets.

Browser access to the companion relies on the browser-controlled `Origin` header plus explicit user approval. Approved origins are persisted in `~/.annote/permissions.json`; cross-origin sites cannot inspect another origin's Annote sessions through protected bridge APIs.

The bridge binds only to `127.0.0.1`. `/health` is intentionally public and returns only `ok`, `name`, `protocolVersion`, and `instanceId`. Protected browser endpoints require an approved exact origin and a per-session capability token. MCP/internal endpoints require the machine secret from `~/.annote/config.json`; that secret is never sent to browser pages.

The browser and localStorage remain canonical for annotation content. The companion stores only an in-memory synchronized mirror plus transient claim metadata. If the companion exits, annotations remain in the browser and resynchronize after reconnect.

The bridge does not expose filesystem, shell, git, project secrets, cookies, Authorization values, browser storage, network capture, sourcemaps, event objects, or arbitrary page HTML.
