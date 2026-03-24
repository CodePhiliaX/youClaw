# YouClaw

Desktop AI assistant app, inspired by CLaude code.

## Commands

```bash
bun dev              # Start backend dev mode (Bun)
bun dev:web          # Start frontend dev mode (Vite)
bun dev:tauri        # Start Tauri dev mode (Vite frontend + Bun backend + WebView, auto-opens DevTools)
bun start            # Production backend
bun typecheck        # TypeScript type check
bun test             # Run tests (bun test)
bun build:sidecar    # Compile Bun sidecar binary
bun build:tauri      # Build Tauri desktop app
```

## Tech Stack

- **Runtime**: Bun (backend sidecar + package manager)
- **Desktop Shell**: Tauri 2 (Rust, window/tray/updater)
- **Backend**: Hono (HTTP) + bun:sqlite (database) + Pino (logging)
- **Agent**: @anthropic-ai/claude-agent-sdk
- **Frontend**: Vite + React + shadcn/ui + Tailwind CSS
- **Validation**: Zod (v4, import from `zod/v4`)
- **Scheduling**: croner (cron expression parser)
- **Telegram**: grammY
- **Config Format**: YAML (yaml library)

## Architecture

- **Desktop mode**: Tauri (Rust shell) -> WebView loads frontend + Sidecar runs Bun backend
- **Web mode**: Vite frontend + Bun backend deployed independently, frontend proxies API via Vite proxy
- **Dev mode**: `bun dev:tauri` launches Vite frontend + Bun backend + Tauri WebView simultaneously (debug skips sidecar)
- **Build pipeline**: `bun build --compile` compiles backend into single-file sidecar -> Vite compiles frontend embedded in Rust binary -> Tauri bundles DMG/MSI/AppImage
- Frontend communicates with Bun backend uniformly via HTTP/SSE (same for desktop and web mode)
- Port config: Rust reads `port` from Tauri Store -> injects `PORT` env var to sidecar; frontend reads port from the same Store to build baseUrl
- Three-layer architecture: Entry layer (Telegram/Web/API) -> Core layer (AgentManager/Scheduler/Memory/Skills) -> Storage layer (SQLite/filesystem)
- EventBus decouples Agent execution from multi-channel output
- IPC Watcher uses filesystem polling for Agent <-> main process communication (scheduled task CRUD)

## Project Structure

```
src/
├── agent/          # AgentManager (loads agent.yaml), AgentRuntime (claude-agent-sdk), AgentQueue (concurrency), PromptBuilder, SubagentTracker
├── channel/        # MessageRouter, TelegramChannel
├── config/         # env.ts (Zod env validation), paths.ts (path constants)
├── db/             # bun:sqlite init, message/chat/task CRUD
├── events/         # EventBus + type definitions (stream/tool_use/complete/error/subagent_*)
├── ipc/            # IpcWatcher (file-polling IPC), task snapshot writer
├── logger/         # Pino logger
├── memory/         # MemoryManager (per-agent MEMORY.md + logs)
├── routes/         # Hono API routes (agents/messages/stream/skills/memory/tasks/system/health)
├── scheduler/      # Scheduler (30s polling, cron/interval/once, backoff, stuck detection)
├── skills/         # SkillsLoader (3-tier priority: workspace > builtin > user), SkillsWatcher (hot reload), eligibility check, frontmatter parser, /skill invocation syntax
src-tauri/
├── src/            # Rust main process (sidecar spawn, window management, tray, Tauri commands)
├── capabilities/   # Tauri permission config
├── bin/            # Bun sidecar compiled binaries
├── icons/          # App & tray icons (includes trayTemplate for macOS menu bar)
agents/
├── <id>/           # agent.yaml + SOUL.md + TOOLS.md + USER.md + AGENT.md + skills/ + memory/ + prompts/
skills/             # Project-level skills (SKILL.md format, YAML frontmatter)
prompts/            # system.md (system prompt), env.md (environment description)
web/src/
├── pages/          # Chat, Agents, Skills, Memory, Tasks, System
├── api/            # HTTP client + transport (baseUrl/port management) + Tauri env detection
├── i18n/           # i18n (Chinese/English)
├── components/     # layout + shadcn/ui
```

## Environment Variables

- `ANTHROPIC_API_KEY` (required)
- `PORT` (default 62601)
- `DATA_DIR` (default ./data)
- `AGENT_MODEL` (default minimax/MiniMax-M2.7-highspeed)
- `LOG_LEVEL` (debug/info/warn/error, default info)
- `TELEGRAM_BOT_TOKEN` (optional, enables Telegram channel)

## Conventions

- Use `bun:sqlite` (Bun built-in SQLite) as database driver, no native addon needed
- Use `node:fs` readFileSync/writeFileSync
- Bun auto-loads `.env` files
- Use Bun as package manager (`bun install`, `bun add`), not pnpm/npm
- Commit messages follow Conventional Commits (English)
- All code comments must be written in English
- Agent config uses YAML format (`agent.yaml`), validated with Zod schema
- Skills use Markdown + YAML frontmatter format (`SKILL.md`), 3-tier loading priority: Agent workspace > project `skills/` > `~/.youclaw/skills/`
- Database migrations use try/catch ALTER TABLE pattern (no dedicated migration tool)
- API routes mounted under `/api` prefix
- Tauri Store for desktop settings persistence (API Key, Base URL, port, theme)
