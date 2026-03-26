<p align="center">
  <img src="web/src/assets/logo.png" width="120" alt="YouClaw Logo" />
</p>

<h1 align="center">YouClaw</h1>

<p align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">简体中文</a> | <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>Desktop AI Assistant powered by a multi-provider coding agent runtime</strong>
</p>

<p align="center">
  <a href="https://github.com/CodePhiliaX/youClaw/releases"><img src="https://img.shields.io/github/v/release/CodePhiliaX/youClaw?style=flat-square&color=blue" alt="Release" /></a>
  <a href="https://github.com/CodePhiliaX/youClaw/blob/main/LICENSE"><img src="https://img.shields.io/github/license/CodePhiliaX/youClaw?style=flat-square" alt="License" /></a>
  <a href="https://github.com/CodePhiliaX/youClaw/stargazers"><img src="https://img.shields.io/github/stars/CodePhiliaX/youClaw?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/CodePhiliaX/youClaw"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" /></a>
</p>

<p align="center">
  <strong>If YouClaw is useful to you, give it a GitHub Star.</strong><br />
  More stars help more people discover the project.
</p>

<p align="center">
  <a href="https://github.com/CodePhiliaX/youClaw/stargazers">
    <img src="https://img.shields.io/github/stars/CodePhiliaX/youClaw?style=for-the-badge&logo=github&color=ffcb47&label=Star%20YouClaw" alt="Star YouClaw on GitHub" />
  </a>
</p>

<p align="center">
  <sub>One click helps keep YouClaw improving.</sub>
</p>

---

## Download & Install

### macOS

Download the `.dmg` file from the [Releases](https://github.com/CodePhiliaX/youClaw/releases) page, open it and drag **YouClaw** into Applications.

> Apple Silicon (M1/M2/M3/M4) and Intel are both supported.

### Windows

Download the `.exe` installer from [Releases](https://github.com/CodePhiliaX/youClaw/releases) and run it.

### Linux

🚧 Coming soon — stay tuned!

---

## Features

- **Multi-Agent Management** — Create and configure multiple AI agents via YAML, each with its own personality, memory, and skills
- **Multi-Channel** — Connect agents to Telegram, DingTalk, Feishu (Lark), QQ, and WeCom
- **Browser Automation** — Built-in agent-browser skill with Playwright for web interaction, scraping, and testing
- **Scheduled Tasks** — Cron / interval / one-shot tasks with automatic retry and stuck detection
- **Persistent Memory** — Per-agent memory system with conversation logs
- **Skills System** — Compatible with OpenClaw SKILL.md format, 3-tier priority loading, hot reload, skills marketplace
- **Authentication** — Built-in auth system for cloud deployment
- **Web UI** — React + shadcn/ui with SSE streaming, i18n (中文 / English)
- **Lightweight Desktop App** — Tauri 2 bundle ~27 MB (vs ~338 MB Electron), native system tray

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime & Package Manager | [Bun](https://bun.sh/) |
| Desktop Shell | [Tauri 2](https://tauri.app/) (Rust) |
| Backend | Hono + bun:sqlite + Pino |
| Agent | `@mariozechner/pi-coding-agent` + `@mariozechner/pi-ai` |
| Frontend | Vite + React + shadcn/ui + Tailwind CSS |
| Channels | grammY (Telegram) · `dingtalk-stream` (DingTalk) · `@larksuiteoapi/node-sdk` (Feishu) · QQ · WeCom |
| Scheduled Tasks | croner |
| E2E Testing | Playwright |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                Tauri 2 (Rust Shell)                   │
│   ┌──────────────┐    ┌────────────────────────────┐ │
│   │   WebView     │    │   Bun Sidecar              │ │
│   │  Vite+React   │◄──►  Hono API Server           │ │
│   │  shadcn/ui    │ HTTP│  Multi-provider Agent RT  │ │
│   │               │ SSE │  bun:sqlite               │ │
│   └──────────────┘    └────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
         │                        │
    Tauri Store              EventBus
   (settings)          ┌────────┴────────────┐
                        │                     │
                   Web / API         Multi-Channel
                              ┌───────┼───────┐
                           Telegram DingTalk Feishu
                              QQ    WeCom
                                     │
                              Browser Automation
                               (Playwright)
```

- **Desktop mode**: Tauri spawns a Bun sidecar process; WebView loads the frontend
- **Web mode**: Vite frontend + Bun backend deployed independently
- **Three-layer design**: Entry (Telegram/DingTalk/Feishu/QQ/WeCom/Web/API) → Core (Agent/Scheduler/Memory/Skills) → Storage (SQLite/filesystem)

<p align="center">
  <a href="https://github.com/CodePhiliaX/youClaw/stargazers">
    <img src="https://img.shields.io/badge/Star%20YouClaw%20before%20you%20start-Support%20the%20project-ffcb47?style=for-the-badge&logo=github&logoColor=black" alt="Star YouClaw before you start" />
  </a>
</p>

<p align="center">
  <strong>Before Quick Start: Star if you want to see YouClaw keep improving.</strong><br />
  It is a small click that makes the project easier to sustain.
</p>

## Quick Start (Development)

### Prerequisites

- [Bun](https://bun.sh/) >= 1.1
- [Rust](https://rustup.rs/) (for Tauri desktop build)
- A model API key for your chosen provider

### Setup

```bash
git clone https://github.com/CodePhiliaX/youClaw.git
cd youClaw

# Install dependencies
bun install
cd web && bun install && cd ..

# Configure environment
cp .env.example .env
# Edit .env and set MODEL_API_KEY
```

### Web Mode

```bash
# Terminal 1 — backend
bun dev

# Terminal 2 — frontend
bun dev:web
```

Open http://localhost:5173 · API at http://localhost:62601

### Desktop Mode (Tauri)

```bash
bun dev:tauri
```

### Build Desktop App

```bash
bun build:tauri
```

Output: `src-tauri/target/release/bundle/` (DMG / MSI / AppImage)

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
bun build:tauri:fast # Build without bundling (faster dev builds)
bun test:e2e         # Run E2E tests (Playwright)
bun test:e2e:ui      # Run E2E tests with UI
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MODEL_PROVIDER` | No | `builtin` | Default model provider or runtime mode |
| `MODEL_ID` | No | `minimax/MiniMax-M2.7-highspeed` | Default model reference |
| `MODEL_API_KEY` | Yes | — | Model API key |
| `MODEL_BASE_URL` | No | — | Custom model API base URL |
| `PORT` | No | `62601` | Backend server port |
| `DATA_DIR` | No | `./data` in dev, `~/.youclaw` in desktop production | Data storage directory. For dev, set `DATA_DIR=~/.youclaw-dev` if you want an isolated user-home data dir |
| `LOG_LEVEL` | No | `info` | Log level |
| `TELEGRAM_BOT_TOKEN` | No | — | Enable Telegram channel |
| `DINGTALK_CLIENT_ID` | No | — | DingTalk app client ID |
| `DINGTALK_SECRET` | No | — | DingTalk app secret |
| `FEISHU_APP_ID` | No | — | Feishu (Lark) app ID |
| `FEISHU_APP_SECRET` | No | — | Feishu (Lark) app secret |
| `QQ_BOT_APP_ID` | No | — | QQ bot app ID |
| `QQ_BOT_SECRET` | No | — | QQ bot secret |
| `WECOM_CORP_ID` | No | — | WeCom corp ID |
| `WECOM_CORP_SECRET` | No | — | WeCom corp secret |
| `WECOM_AGENT_ID` | No | — | WeCom agent ID |
| `WECOM_TOKEN` | No | — | WeCom callback token |
| `WECOM_ENCODING_AES_KEY` | No | — | WeCom callback AES key |
| `YOUCLAW_WEBSITE_URL` | No | — | Cloud service website URL |
| `YOUCLAW_API_URL` | No | — | Cloud service API URL |
| `MINIMAX_API_KEY` | No | — | MiniMax web search API key |
| `MINIMAX_API_HOST` | No | — | MiniMax API host |

## Project Structure

```
src/
├── agent/          # AgentManager, AgentRuntime, AgentQueue, PromptBuilder
├── channel/        # Multi-channel support
│   ├── router.ts   # MessageRouter
│   ├── telegram.ts # Telegram (grammY)
│   ├── dingtalk.ts # DingTalk (dingtalk-stream)
│   ├── feishu.ts   # Feishu / Lark (@larksuiteoapi/node-sdk)
│   ├── qq.ts       # QQ
│   └── wecom.ts    # WeCom
├── config/         # Environment validation, path constants
├── db/             # bun:sqlite init, CRUD operations
├── events/         # EventBus (stream/tool_use/complete/error)
├── ipc/            # File-polling IPC between Agent and main process
├── logger/         # Pino logger
├── memory/         # Memory helpers for root MEMORY.md plus per-agent logs/archives
├── routes/         # Hono API routes (/api/*)
├── scheduler/      # Cron/interval/once task scheduler
├── skills/         # Skills loader, watcher, frontmatter parser
src-tauri/
├── src/            # Rust main process (sidecar, window, tray, updater)
agents/             # Agent workspaces (agent.yaml + bootstrap docs + MEMORY.md + skills/)
skills/             # Project-level skills (SKILL.md format)
e2e/                # E2E tests (Playwright)
web/src/
├── pages/          # Chat, Agents, Skills, Memory, Tasks, Channels, BrowserProfiles, Logs, System, Login
├── components/     # Layout + shadcn/ui
├── api/            # HTTP client + transport
├── i18n/           # i18n (Chinese / English)
```

## Contributing

1. Fork the repo and create your branch from `main`
2. Make your changes and ensure `bun typecheck` and `bun test` pass
3. Submit a pull request

<p align="center">
  <a href="https://star-history.com/#CodePhiliaX/youClaw&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CodePhiliaX/youClaw&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=CodePhiliaX/youClaw&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=CodePhiliaX/youClaw&type=Date" />
    </picture>
  </a>
</p>

## License

[MIT](LICENSE) © CHATDATA
