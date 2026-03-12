# YouClaw

Desktop AI assistant powered by Claude, inspired by nanoClaw / OpenClaw.

- Multi-agent management with YAML config
- Scheduled tasks (cron / interval / once)
- Persistent per-agent memory
- Skills system compatible with OpenClaw SKILL.md format
- Web UI (React + shadcn/ui) with SSE streaming
- Telegram channel support
- Tauri 2 desktop app (~27MB DMG vs ~338MB Electron)

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime & Package Manager | Bun |
| Desktop Shell | Tauri 2 (Rust) |
| Backend | Hono + bun:sqlite + Pino |
| Agent | `@anthropic-ai/claude-agent-sdk` |
| Frontend | Vite + React + shadcn/ui + Tailwind CSS |
| Telegram | grammY |
| Scheduled Tasks | croner |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.1
- [Rust](https://rustup.rs/) (for Tauri desktop build)
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

```bash
# Clone
git clone https://github.com/CodePhiliaX/youClaw.git
cd youClaw

# Install dependencies
bun install
cd web && bun install && cd ..

# Configure environment
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

### Run (Web mode)

```bash
# Start backend (hot reload)
bun dev

# Start frontend (in another terminal)
bun dev:web
```

Open http://localhost:5173 for the Web UI. The API server runs on http://localhost:3000.

### Run (Desktop mode)

```bash
# Tauri dev mode (frontend + backend + WebView + DevTools)
bun dev:tauri
```

### Build Desktop App

```bash
# Build sidecar + Tauri bundle
bun build:tauri
```

Output: `src-tauri/target/release/bundle/` (DMG / MSI / AppImage)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Anthropic API key |
| `ANTHROPIC_BASE_URL` | No | - | Custom API base URL |
| `PORT` | No | `3000` | Backend server port |
| `DATA_DIR` | No | `./data` | Data storage directory |
| `AGENT_MODEL` | No | `claude-sonnet-4-6` | Default Claude model |
| `LOG_LEVEL` | No | `info` | Log level (debug/info/warn/error) |
| `TELEGRAM_BOT_TOKEN` | No | - | Enable Telegram channel |

## Project Structure

```
src/
├── agent/          # AgentManager, AgentRuntime, AgentQueue, PromptBuilder
├── channel/        # MessageRouter, TelegramChannel
├── config/         # Environment validation, path constants
├── db/             # bun:sqlite init, CRUD operations
├── events/         # EventBus (stream/tool_use/complete/error)
├── ipc/            # File-polling IPC between Agent and main process
├── logger/         # Pino logger
├── memory/         # Per-agent MEMORY.md and conversation logs
├── routes/         # Hono API routes (/api/*)
├── scheduler/      # Cron/interval/once task scheduler
├── skills/         # Skills loader, watcher, frontmatter parser
src-tauri/
├── src/            # Rust main process (sidecar, window, tray, updater)
├── capabilities/   # Tauri permission config
├── bin/            # Bun sidecar compiled binaries
├── icons/          # App & tray icons
agents/             # Agent configs (agent.yaml + SOUL.md + skills/)
skills/             # Project-level skills (SKILL.md format)
prompts/            # System & environment prompts
web/src/            # React frontend
```

## Commands

```bash
bun dev              # Backend dev server (hot reload)
bun dev:web          # Frontend dev server
bun dev:tauri        # Tauri dev mode (frontend + backend + WebView)
bun start            # Production backend
bun typecheck        # TypeScript type check
bun test             # Run tests
bun build:sidecar    # Compile Bun sidecar binary
bun build:tauri      # Build Tauri desktop app
```

## License

ISC
