---
name: agent-browser
description: "Browser automation CLI for direct website interaction. Use when the user needs to open URLs, click buttons, fill forms, take screenshots, log in, or test web apps. NOT for web search."
dependencies:
  - agent-browser
tags:
  - browser
  - automation
priority: normal
install:
  bun: "bun install -g agent-browser"
---

# Browser Automation with agent-browser

## Performance Rules (CRITICAL)

- **ALWAYS chain commands with `&&`** when you don't need intermediate output. Each separate tool call costs seconds of round-trip latency.
- **ALWAYS combine** open + wait + snapshot into one call: `agent-browser open <url> && agent-browser wait --load load && agent-browser snapshot -i`
- **ALWAYS batch** multiple interactions (fill, click, select) into one `&&` chain when refs are already known.
- **Use `--load load`** (DOM load event) by default. Only use `networkidle` when you specifically need all XHR/fetch to complete (e.g., waiting for API-driven content).
- **Do NOT snapshot after every interaction** — only re-snapshot when you need to discover new element refs (after navigation or major DOM changes).

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate + Snapshot** (one call): `agent-browser open <url> && agent-browser wait --load load && agent-browser snapshot -i`
2. **Interact**: Batch all interactions using known refs in one `&&` chain
3. **Re-snapshot**: Only after navigation or major DOM changes

```bash
# Step 1: Open and discover elements (ONE tool call)
agent-browser open https://example.com/form && agent-browser wait --load load && agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

# Step 2: Batch all interactions (ONE tool call)
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "password123" && agent-browser click @e3 && agent-browser wait --load load

# Step 3: Only snapshot if you need to verify or discover new elements
agent-browser snapshot -i
```

This reduces 7+ round-trips to just 2-3.

## Essential Commands

```bash
# Navigation
agent-browser open <url>              # Navigate (aliases: goto, navigate)
agent-browser close                   # Close browser

# Snapshot
agent-browser snapshot -i             # Interactive elements with refs (recommended)
agent-browser snapshot -i -C          # Include cursor-interactive elements
agent-browser snapshot -s "#selector" # Scope to CSS selector

# Interaction (use @refs from snapshot)
agent-browser click @e1               # Click element
agent-browser fill @e2 "text"         # Clear and type text
agent-browser type @e2 "text"         # Type without clearing
agent-browser select @e1 "option"     # Select dropdown option
agent-browser check @e1               # Check checkbox
agent-browser press Enter             # Press key
agent-browser scroll down 500         # Scroll page

# Get information
agent-browser get text @e1            # Get element text
agent-browser get url                 # Get current URL
agent-browser get title               # Get page title

# Wait
agent-browser wait @e1                # Wait for element
agent-browser wait --load load        # Wait for DOM load (fast, preferred)
agent-browser wait --load networkidle # Wait for network idle (slow, use only when needed)
agent-browser wait --url "**/page"    # Wait for URL pattern
agent-browser wait 2000               # Wait milliseconds

# Capture
agent-browser screenshot              # Screenshot to temp dir
agent-browser screenshot --full       # Full page screenshot
agent-browser screenshot --annotate   # Annotated screenshot with numbered element labels
agent-browser pdf output.pdf          # Save as PDF

# Diff (compare page states)
agent-browser diff snapshot                          # Compare current vs last snapshot
agent-browser diff screenshot --baseline before.png  # Visual pixel diff
agent-browser diff url <url1> <url2>                 # Compare two pages
```

## Common Patterns

### Form Submission

```bash
# Step 1: Open and discover elements (ONE call)
agent-browser open https://example.com/signup && agent-browser wait --load load && agent-browser snapshot -i

# Step 2: Fill and submit (ONE call)
agent-browser fill @e1 "Jane Doe" && agent-browser fill @e2 "jane@example.com" && agent-browser select @e3 "California" && agent-browser check @e4 && agent-browser click @e5 && agent-browser wait --load load
```

### Authentication with State Persistence

```bash
# Login: open + snapshot (ONE call)
agent-browser open https://app.example.com/login && agent-browser wait --load load && agent-browser snapshot -i

# Fill credentials + submit (ONE call)
agent-browser fill @e1 "$USERNAME" && agent-browser fill @e2 "$PASSWORD" && agent-browser click @e3 && agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# Reuse in future sessions
agent-browser state load auth.json && agent-browser open https://app.example.com/dashboard
```

### Data Extraction

```bash
# Open + snapshot in one call
agent-browser open https://example.com/products && agent-browser wait --load load && agent-browser snapshot -i
agent-browser get text @e5           # Get specific element text
agent-browser get text body > page.txt  # Get all page text

# JSON output for parsing
agent-browser snapshot -i --json
```

## Ref Lifecycle (Important)

Refs (`@e1`, `@e2`, etc.) are invalidated when the page changes. Always re-snapshot after:

- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals)

```bash
agent-browser click @e5              # Navigates to new page
agent-browser snapshot -i            # MUST re-snapshot
agent-browser click @e1              # Use new refs
```

## Annotated Screenshots (Vision Mode)

Use `--annotate` to take a screenshot with numbered labels overlaid on interactive elements.

```bash
agent-browser screenshot --annotate
# Output includes the image path and a legend:
#   [1] @e1 button "Submit"
#   [2] @e2 link "Home"
#   [3] @e3 textbox "Email"
agent-browser click @e2              # Click using ref from annotated screenshot
```

## Semantic Locators (Alternative to Refs)

When refs are unavailable or unreliable, use semantic locators:

```bash
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find role button click --name "Submit"
agent-browser find placeholder "Search" type "query"
```

## Session Management

Always close your browser session when done:

```bash
agent-browser close                    # Close default session
agent-browser --session agent1 close   # Close specific session
```

## Browser Profile (Persistent Login)

If the system prompt provides `--session`, `--profile`, `--headed`, and/or `--executable-path` parameters, you MUST include them in every `agent-browser` command. This allows reusing persistent login state (cookies, localStorage, etc.).

```bash
agent-browser --session my-profile --profile /path/to/profile --headed open https://app.example.com
agent-browser --session my-profile --profile /path/to/profile --headed snapshot -i
```

### Troubleshooting
If `agent-browser` fails to launch:
1. Try `agent-browser install chrome` then retry once
2. If headed mode fails, try without `--headed` (headless) while keeping `--profile` and `--session`
3. Do NOT retry the same failing command more than 2 times

## Default Mode (No Profile)

When no browser profile is specified in the system prompt, use agent-browser without `--headed`, `--profile`, or `--session` flags. The browser runs in headless mode by default.
