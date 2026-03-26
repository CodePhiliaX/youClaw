# Browser Profiles

Browser profiles let YouClaw reuse browser state across chats and agent runs. A profile can store login sessions, cookies, open tabs, and runtime metadata so the browser tools do not need to start from a blank state every time.

This project currently supports three browser profile drivers:

| Driver | Best for | How it works | Recommendation |
| --- | --- | --- | --- |
| `managed` | Most users | YouClaw launches and manages an isolated Chromium profile | Recommended default |
| `remote-cdp` | Advanced users / remote environments | YouClaw connects to an already-available CDP endpoint | Use only if you already have a browser automation setup |
| `extension-relay` | Advanced local attach flow | YouClaw securely attaches to a loopback CDP endpoint on the same machine with a relay token | Keep as an advanced option |

## Which driver should I choose?

### Managed Chromium

Use `Managed Chromium` if you want the simplest and safest setup.

- YouClaw starts the browser for you.
- Login state is stored in the profile data directory managed by the app.
- This is the easiest option for websites that need manual login, CAPTCHA handling, or 2FA.
- It keeps browser state isolated from your everyday browser profile.

Recommended flow:

1. Create a managed profile.
2. Start the browser from the Browser Profiles page.
3. Log in manually inside that window.
4. Bind the profile to an agent or choose it in chat.
5. Let the browser MCP tools reuse the saved session.

### Remote CDP

Use `Remote CDP` only if you already know what a CDP endpoint is and you already have a browser that exposes one.

Examples:

- A browser started by your own automation scripts
- A browser running on another machine that exposes a trusted CDP URL
- A containerized environment where browser lifecycle is managed outside YouClaw

Tradeoffs:

- Flexible
- Good for existing automation stacks
- Easier to misconfigure than `managed`
- Requires you to own the browser lifecycle yourself

### Extension Relay

`Extension Relay` is currently an advanced local attach mode.

Important: in the current implementation, this is **not yet** a zero-config browser extension bridge that can directly take over your everyday browser window.

What it does today:

- Generates a relay token inside YouClaw
- Accepts only loopback CDP URLs such as `http://127.0.0.1:9222`
- Lets YouClaw attach to a browser you started yourself on the same machine

What it does **not** do today:

- It does not automatically discover your main browser
- It does not automatically attach to a normal browser window that was started without remote debugging enabled
- It does not accept arbitrary remote hosts

Use this mode only if you specifically want to reuse an already-running local browser session.

## How Extension Relay Works

The current flow is:

1. Start a local Chrome / Chromium instance with remote debugging enabled
2. Verify that a loopback CDP endpoint is reachable
3. Create an `Extension Relay` profile in YouClaw
4. Copy the relay token shown in the profile
5. Paste the loopback CDP URL into the profile and attach
6. Let YouClaw reuse that browser session

### Why does it need CDP?

The current relay implementation talks to the browser through the Chrome DevTools Protocol (CDP). If the browser does not expose a CDP endpoint, YouClaw has nothing to attach to.

That means:

- You cannot directly attach to a normal browser process that was launched without remote debugging
- You need either:
  - a browser started with `--remote-debugging-port=...`
  - or another trusted local component that exposes a loopback CDP endpoint

## Getting a Local CDP URL

### macOS

Google Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/youclaw-cdp
```

Chromium:

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

or:

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

### Verify the endpoint

Open this URL in any browser:

```text
http://127.0.0.1:9222/json/version
```

You should see JSON that includes a `webSocketDebuggerUrl`.

You can then use either:

- `http://127.0.0.1:9222`
- or the full `ws://127.0.0.1:9222/devtools/browser/...` value from `webSocketDebuggerUrl`

## Security Notes

Extension Relay intentionally restricts the current implementation:

- Only loopback hosts are accepted
- A relay token is required to attach
- Rotating the token invalidates existing relay connections
- Remote hosts such as `http://example.com:9222` are rejected

These restrictions are deliberate. The goal is to keep the current relay mode usable for advanced local workflows without silently exposing a remote browser control surface.

## Suggested Defaults

For product behavior and user guidance:

- Recommend `Managed Chromium` for most users
- Keep `Extension Relay` visible, but label it as advanced
- Avoid requiring ordinary users to understand CDP unless they explicitly choose the advanced path

## FAQ

### Is Extension Relay the same as a full browser extension takeover?

No. Not yet. The current implementation is a secure local CDP attach flow.

### Can it attach to the browser I already use every day?

Only if that browser already exposes a loopback CDP endpoint. A normal browser process without remote debugging is not attachable by this implementation.

### Why would I still use Extension Relay?

Use it when you want to reuse an already-running local browser session instead of letting YouClaw launch a separate managed profile.
