---
name: web-search
description: "Search the web using MiniMax web_search tool for real-time information, news, and facts."
env:
  - MINIMAX_API_KEY
tags:
  - search
  - web
priority: normal
---

# Web Search

Search the internet for real-time information using the `web_search` tool provided by MiniMax MCP Server.

## When to Use

Use web_search when the user needs:

- Latest news, events, or weather
- Real-time data (stock prices, exchange rates, sports scores, etc.)
- Facts that may be outdated in your training data
- Up-to-date information about specific products or services
- Latest versions of technical documentation

## Search Strategy

1. **Craft effective keywords**: Keep them short and precise, remove filler words. Prefer English for technical queries
2. **Add time constraints**: Include the year or "latest" in keywords when seeking current information
3. **Multi-step search**: Start with broad overview keywords, then refine based on results
4. **Cross-verify**: Confirm important facts from at least two sources

## Output Guidelines

- Cite sources (URLs) in your response
- Distinguish between facts and speculation
- If search results are insufficient to answer the question, state so honestly
- Do not copy-paste large blocks of search results; distill the key information

## Example

User: "What is the latest version of Bun?"

Search strategy:
1. `web_search("Bun latest release 2026")`
2. If more details are needed, use `WebFetch` to retrieve the release notes page

Response: Include version number, release date, key changes, and source links.
