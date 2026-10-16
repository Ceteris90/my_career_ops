# Career-ops Web UI Launcher Documentation

Career-ops includes a local-first web interface located in the `web/` directory. The `npm run ui` launcher script (`scripts/ui-server.mjs`) provides a zero-setup daemon to start the local Next.js server, verify dependencies, canonically resolve the career-ops data root, and open the dashboard in your default browser.

---

## Getting Started

To launch the local web server and open the browser dashboard:

```bash
npm run ui
```

The server starts locally on `http://127.0.0.1:3000` by default and automatically opens your browser once the server is ready.

---

## Command-Line Options

You can pass command-line options directly to `npm run ui`:

| Flag | Default | Description |
|---|:---:|---|
| `--port=<number>` or `--port <number>` | `3000` | Custom port to listen on. |
| `--host=<ip>` or `--host <ip>` | `127.0.0.1` | Network interface host (e.g. `127.0.0.1` or `0.0.0.0`). |
| `--no-open` or `--noopen` | `false` | Start the server without opening the browser automatically. |

### Examples

```bash
# Run on a custom port
npm run ui -- --port=3030

# Listen on all interfaces without automatically launching a browser
npm run ui -- --host=0.0.0.0 --no-open
```

---

## Process Lifecycle & Architecture

- **Canonical Data Root Resolution**: The launcher resolves the user data directory using `path-resolver.mjs` (`CAREER_OPS_ROOT` / `CAREER_OPS_DATA_DIR` / `.career-ops-data`), ensuring the web application reads and writes user-layer files according to the Data Contract.
- **Readiness Polling**: Polls the server until it responds before launching the browser, draining responses properly via `res.resume()`.
- **Graceful Shutdown**: Handles `SIGINT` (Ctrl+C) and `SIGTERM` signals cleanly across Linux, macOS, and Windows (using process tree termination to prevent orphaned dev server instances).

