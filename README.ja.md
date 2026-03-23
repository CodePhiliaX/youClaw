<p align="center">
  <img src="web/src/assets/logo.png" width="120" alt="YouClaw Logo" />
</p>

<h1 align="center">YouClaw</h1>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a> | <strong>日本語</strong>
</p>

<p align="center">
  <strong>Claude Agent SDK をベースにしたデスクトップ AI Assistant</strong>
</p>

<p align="center">
  <a href="https://github.com/CodePhiliaX/youClaw/releases"><img src="https://img.shields.io/github/v/release/CodePhiliaX/youClaw?style=flat-square&color=blue" alt="Release" /></a>
  <a href="https://github.com/CodePhiliaX/youClaw/blob/main/LICENSE"><img src="https://img.shields.io/github/license/CodePhiliaX/youClaw?style=flat-square" alt="License" /></a>
  <a href="https://github.com/CodePhiliaX/youClaw/stargazers"><img src="https://img.shields.io/github/stars/CodePhiliaX/youClaw?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/CodePhiliaX/youClaw"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" /></a>
</p>

<p align="center">
  <strong>YouClaw が役に立ったら、GitHub Star で応援してください。</strong><br />
  Star が増えるほど、YouClaw を見つける人が増え、今後の開発の後押しになります。
</p>

<p align="center">
  <a href="https://github.com/CodePhiliaX/youClaw/stargazers">
    <img src="https://img.shields.io/github/stars/CodePhiliaX/youClaw?style=for-the-badge&logo=github&color=ffcb47&label=Star%20YouClaw" alt="Star YouClaw on GitHub" />
  </a>
</p>

<p align="center">
  <sub>小さなクリックが、YouClaw の継続的な改善につながります。</sub>
</p>

---

## ダウンロードとインストール

### macOS

[Releases](https://github.com/CodePhiliaX/youClaw/releases) ページから `.dmg` ファイルをダウンロードし、開いて **YouClaw** を Applications にドラッグしてください。

> Apple Silicon（M1/M2/M3/M4）と Intel の両方に対応しています。

### Windows

[Releases](https://github.com/CodePhiliaX/youClaw/releases) から `.exe` インストーラーをダウンロードして実行してください。

### Linux

🚧 近日対応予定です。

---

## 主な機能

- **マルチ Agent 管理**: YAML で複数の AI Agent を作成・設定でき、それぞれが独自の人格、メモリ、スキルを持てます
- **マルチチャネル対応**: Telegram、DingTalk、Feishu（Lark）、QQ、WeCom に接続できます
- **ブラウザ自動化**: Playwright ベースの agent-browser skill を内蔵し、Web 操作、スクレイピング、テストに利用できます
- **スケジュールタスク**: Cron / interval / one-shot タスクに対応し、自動リトライとハング検知を備えています
- **永続メモリ**: Agent ごとのメモリシステムと会話ログを提供します
- **スキルシステム**: OpenClaw `SKILL.md` 形式と互換性があり、3 層優先度ロード、ホットリロード、スキルマーケットプレイスをサポートします
- **認証機能**: クラウドデプロイ向けの認証システムを内蔵しています
- **Web UI**: React + shadcn/ui ベースで、SSE ストリーミングと多言語 UI に対応しています
- **軽量なデスクトップアプリ**: Tauri 2 バンドルは約 27 MB（Electron は約 338 MB）で、ネイティブのシステムトレイに対応しています

## 技術スタック

| レイヤー | 採用技術 |
|---------|----------|
| ランタイム / パッケージ管理 | [Bun](https://bun.sh/) |
| デスクトップシェル | [Tauri 2](https://tauri.app/)（Rust） |
| バックエンド | Hono + bun:sqlite + Pino |
| Agent | `@anthropic-ai/claude-agent-sdk` |
| フロントエンド | Vite + React + shadcn/ui + Tailwind CSS |
| チャネル | grammY（Telegram）· `dingtalk-stream`（DingTalk）· `@larksuiteoapi/node-sdk`（Feishu）· QQ · WeCom |
| スケジュールタスク | croner |
| E2E テスト | Playwright |

## アーキテクチャ

```
┌──────────────────────────────────────────────────────┐
│                Tauri 2 (Rust Shell)                   │
│   ┌──────────────┐    ┌────────────────────────────┐ │
│   │   WebView     │    │   Bun Sidecar              │ │
│   │  Vite+React   │◄──►  Hono API Server           │ │
│   │  shadcn/ui    │ HTTP│  Claude Agent SDK         │ │
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

- **デスクトップモード**: Tauri が Bun sidecar プロセスを起動し、WebView がフロントエンドを読み込みます
- **Web モード**: Vite フロントエンドと Bun バックエンドを独立してデプロイできます
- **3 層設計**: エントリ層（Telegram/DingTalk/Feishu/QQ/WeCom/Web/API）→ コア層（Agent/Scheduler/Memory/Skills）→ ストレージ層（SQLite/ファイルシステム）

<p align="center">
  <a href="https://github.com/CodePhiliaX/youClaw/stargazers">
    <img src="https://img.shields.io/badge/Quick%20Start%20の前に-Star%20で応援-ffcb47?style=for-the-badge&logo=github&logoColor=black" alt="Quick Start の前に Star をお願いします" />
  </a>
</p>

<p align="center">
  <strong>始める前に: YouClaw の継続的な改善を応援するなら、ぜひ Star をお願いします。</strong><br />
  小さなクリックですが、プロジェクトの継続に大きく効きます。
</p>

## クイックスタート（開発）

### 前提条件

- [Bun](https://bun.sh/) >= 1.1
- [Rust](https://rustup.rs/)（Tauri デスクトップアプリのビルドに必要）
- [Anthropic API key](https://console.anthropic.com/) ひとつ

### セットアップ

```bash
git clone https://github.com/CodePhiliaX/youClaw.git
cd youClaw

# 依存関係をインストール
bun install
cd web && bun install && cd ..

# 環境変数を設定
cp .env.example .env
# .env を編集して ANTHROPIC_API_KEY を設定
```

### Web モード

```bash
# ターミナル 1: バックエンド
bun dev

# ターミナル 2: フロントエンド
bun dev:web
```

http://localhost:5173 を開いてください。API は http://localhost:62601 です。

### デスクトップモード（Tauri）

```bash
bun dev:tauri
```

### デスクトップアプリをビルド

```bash
bun build:tauri
```

出力先: `src-tauri/target/release/bundle/`（DMG / MSI / AppImage）

## コマンド

```bash
bun dev              # バックエンド開発サーバー（ホットリロード）
bun dev:web          # フロントエンド開発サーバー
bun dev:tauri        # Tauri 開発モード（フロントエンド + バックエンド + WebView）
bun start            # 本番用バックエンドを起動
bun typecheck        # TypeScript 型チェック
bun test             # テストを実行
bun build:sidecar    # Bun sidecar バイナリをビルド
bun build:tauri      # Tauri デスクトップアプリをビルド
bun build:tauri:fast # バンドルなしビルド（開発向けに高速）
bun test:e2e         # E2E テストを実行（Playwright）
bun test:e2e:ui      # UI 付きで E2E テストを実行
```

## 環境変数

| 変数 | 必須 | デフォルト | 説明 |
|------|------|------------|------|
| `ANTHROPIC_API_KEY` | はい | — | Anthropic API key |
| `ANTHROPIC_BASE_URL` | いいえ | — | カスタム API Base URL |
| `PORT` | いいえ | `62601` | バックエンドサーバーポート |
| `DATA_DIR` | いいえ | `./data` | データ保存ディレクトリ |
| `AGENT_MODEL` | いいえ | `claude-sonnet-4-6` | デフォルトの Claude モデル |
| `LOG_LEVEL` | いいえ | `info` | ログレベル |
| `TELEGRAM_BOT_TOKEN` | いいえ | — | Telegram チャネルを有効化 |
| `DINGTALK_CLIENT_ID` | いいえ | — | DingTalk アプリ Client ID |
| `DINGTALK_SECRET` | いいえ | — | DingTalk アプリ Secret |
| `FEISHU_APP_ID` | いいえ | — | Feishu（Lark）App ID |
| `FEISHU_APP_SECRET` | いいえ | — | Feishu（Lark）App Secret |
| `QQ_BOT_APP_ID` | いいえ | — | QQ Bot App ID |
| `QQ_BOT_SECRET` | いいえ | — | QQ Bot Secret |
| `WECOM_CORP_ID` | いいえ | — | WeCom Corp ID |
| `WECOM_CORP_SECRET` | いいえ | — | WeCom Corp Secret |
| `WECOM_AGENT_ID` | いいえ | — | WeCom Agent ID |
| `WECOM_TOKEN` | いいえ | — | WeCom コールバック Token |
| `WECOM_ENCODING_AES_KEY` | いいえ | — | WeCom コールバック AES Key |
| `YOUCLAW_WEBSITE_URL` | いいえ | — | クラウドサービスの Web サイト URL |
| `YOUCLAW_API_URL` | いいえ | — | クラウドサービスの API URL |
| `MINIMAX_API_KEY` | いいえ | — | MiniMax Web Search API key |
| `MINIMAX_API_HOST` | いいえ | — | MiniMax API Host |

## プロジェクト構成

```
src/
├── agent/          # AgentManager、AgentRuntime、AgentQueue、PromptBuilder
├── channel/        # マルチチャネル対応
│   ├── router.ts   # MessageRouter
│   ├── telegram.ts # Telegram（grammY）
│   ├── dingtalk.ts # DingTalk（dingtalk-stream）
│   ├── feishu.ts   # Feishu / Lark（@larksuiteoapi/node-sdk）
│   ├── qq.ts       # QQ
│   └── wecom.ts    # WeCom
├── config/         # 環境変数バリデーション、パス定数
├── db/             # bun:sqlite 初期化と CRUD
├── events/         # EventBus（stream/tool_use/complete/error）
├── ipc/            # Agent とメインプロセス間のファイルポーリング IPC
├── logger/         # Pino ロガー
├── memory/         # Agent ごとの MEMORY.md と会話ログ
├── routes/         # Hono API ルート（/api/*）
├── scheduler/      # Cron/interval/once タスクスケジューラ
├── skills/         # スキルローダー、ウォッチャー、frontmatter パーサ
src-tauri/
├── src/            # Rust メインプロセス（sidecar、window、tray、updater）
agents/             # Agent 設定（agent.yaml + SOUL.md + skills/）
skills/             # プロジェクトレベルのスキル（SKILL.md 形式）
e2e/                # E2E テスト（Playwright）
web/src/
├── pages/          # Chat、Agents、Skills、Memory、Tasks、Channels、BrowserProfiles、Logs、System、Login
├── components/     # Layout + shadcn/ui
├── api/            # HTTP client + transport
├── i18n/           # i18n（中文 / English）
```

## コントリビュート

1. このリポジトリを Fork し、`main` からブランチを作成してください
2. 変更後、`bun typecheck` と `bun test` が通ることを確認してください
3. Pull Request を送ってください

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
