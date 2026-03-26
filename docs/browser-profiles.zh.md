# 浏览器 Profile 说明

浏览器 Profile 用来让 YouClaw 在不同聊天和 Agent 运行之间复用浏览器状态。它可以保存登录态、Cookie、标签页和运行时元数据，避免浏览器工具每次都从空白状态开始。

当前项目支持三种浏览器 Profile 驱动：

| 驱动 | 适合场景 | 工作方式 | 建议 |
| --- | --- | --- | --- |
| `managed` | 大多数用户 | YouClaw 自己启动并管理一个隔离的 Chromium Profile | 默认推荐 |
| `remote-cdp` | 高级用户 / 远程环境 | YouClaw 连接一个已经存在的 CDP 端点 | 仅在你本来就有自动化环境时使用 |
| `extension-relay` | 高级本机附着场景 | YouClaw 通过 relay token 安全附着到本机 loopback CDP 端点 | 保留为高级选项 |

## 我应该选哪个驱动？

### Managed Chromium

如果你想要最简单、最稳妥的方式，就用 `Managed Chromium`。

- 浏览器由 YouClaw 负责启动
- 登录状态保存在应用管理的 Profile 数据目录里
- 对需要手动登录、验证码、2FA 的网站最友好
- 和你日常使用的主浏览器相互隔离

推荐流程：

1. 创建一个 managed Profile
2. 在 Browser Profiles 页面启动浏览器
3. 在那个窗口里手动登录
4. 把这个 Profile 绑定给 Agent，或者在聊天里选它
5. 后续浏览器 MCP 工具会复用这份已保存的会话

### Remote CDP

只有在你本来就知道什么是 CDP，并且你已经有一个可用的 CDP 浏览器时，才建议使用 `Remote CDP`。

例如：

- 你自己的自动化脚本启动的浏览器
- 另一台机器上暴露出来的受信任 CDP 端点
- 浏览器生命周期由外部系统管理的容器环境

它的特点：

- 灵活
- 适合接入已有自动化体系
- 比 `managed` 更容易配错
- 浏览器生命周期需要你自己管理

### Extension Relay

当前版本的 `Extension Relay` 属于高级本机附着模式。

重要说明：在当前实现里，它**还不是**“零配置接管你日常浏览器”的真正扩展桥接。

它现在能做的事情：

- 在 YouClaw 中生成一个 relay token
- 只接受本机 loopback CDP URL，例如 `http://127.0.0.1:9222`
- 让 YouClaw 附着到你自己先启动好的、本机浏览器会话

它现在**还不能**做的事情：

- 不能自动发现你的主浏览器
- 不能直接接管一个没有开启 remote debugging 的普通浏览器窗口
- 不能接受任意远程主机

只有在你明确想复用一个已经运行中的本机浏览器会话时，才建议使用它。

## Extension Relay 目前是怎么工作的？

当前流程是：

1. 先手动启动一个开启了 remote debugging 的本机 Chrome / Chromium
2. 确认 loopback CDP 端点可访问
3. 在 YouClaw 里创建一个 `Extension Relay` Profile
4. 复制这个 Profile 展示出来的 relay token
5. 把 loopback CDP URL 填进去并执行 attach
6. 之后让 YouClaw 复用这个浏览器会话

### 为什么一定要有 CDP？

当前 relay 的底层是通过 Chrome DevTools Protocol（CDP）控制浏览器。如果浏览器没有暴露 CDP 端点，YouClaw 就没有可附着的入口。

这意味着：

- 不能直接附着到一个普通启动的浏览器进程
- 你必须具备以下之一：
  - 一个通过 `--remote-debugging-port=...` 启动的浏览器
  - 或者一个能在本机暴露 loopback CDP 端点的受信任桥接组件

## 如何获取本机 CDP URL

### macOS

Google Chrome：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/youclaw-cdp
```

Chromium：

```bash
"/Applications/Chromium.app/Contents/MacOS/Chromium" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/youclaw-cdp
```

### Linux

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/youclaw-cdp
```

或者：

```bash
chromium \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/youclaw-cdp
```

### Windows

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\youclaw-cdp"
```

### 如何验证

在任意浏览器里打开：

```text
http://127.0.0.1:9222/json/version
```

如果一切正常，你会看到一段 JSON，其中包含 `webSocketDebuggerUrl`。

之后在 YouClaw 里可以填写两种形式之一：

- `http://127.0.0.1:9222`
- 或者 `webSocketDebuggerUrl` 对应的完整 `ws://127.0.0.1:9222/devtools/browser/...`

## 安全说明

当前的 Extension Relay 是刻意收紧过的：

- 只接受 loopback 主机
- attach 必须带 relay token
- 轮换 token 会使现有 relay 连接失效
- 像 `http://example.com:9222` 这样的远程地址会被拒绝

这些限制是有意保留的，目的是让当前高级本机附着模式可用，同时避免无意中暴露一个远程浏览器控制面。

## 产品默认建议

从产品和用户引导角度，建议：

- 把 `Managed Chromium` 作为大多数用户的默认推荐
- 保留 `Extension Relay`，但明确标注为高级模式
- 除非用户主动选择高级路径，否则不要要求普通用户理解 CDP

## 常见问题

### Extension Relay 等于真正的浏览器扩展接管吗？

不等于，至少当前版本还不是。现在它本质上是“安全的本机 CDP attach 流程”。

### 它可以直接接到我平时正在用的主浏览器上吗？

只有当那个浏览器本身已经暴露了本机 loopback CDP 端点时才可以。对于一个没有开启 remote debugging 的普通浏览器进程，当前实现无法直接附着。

### 那为什么还要保留 Extension Relay？

因为在某些高级本机场景下，你确实会想复用一个已经运行中的浏览器会话，而不是让 YouClaw 另起一个隔离 managed Profile。
