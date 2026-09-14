# poker-game

Texas Hold'em, playable from a terminal or a browser, online or offline, with a hexadecimal
save/export format. Two independent, complete implementations live side by side:

- [`ts/`](ts/README.md) — TypeScript / Node. One shared engine (deck, hand evaluation, betting, side pots)
  compiles for the CLI/WebSocket server and bundles for the browser with esbuild, so the same logic backs
  local hot-seat play, vs-AI, an online WebSocket server + terminal client, a **serverless P2P mode** (WebRTC
  via Trystero — host/join-by-code/quick-match, with voice + text chat, no backend at all), **and** a static
  web client deployable to **GitHub Pages** (`.github/workflows/deploy.yml` at this repo's root builds and
  publishes it automatically). Hex export/import from the CLI or the browser.
- [`python/`](python/README.md) — Python 3, standard library only. Terminal play against bots or other humans
  over TCP, a checksummed/compressed hex save format, min-raise/side-pot/all-in rules, and a Monte-Carlo bot AI.

Pick whichever one you actually want to use and run it from its own folder — see the READMEs linked above for
setup and usage. There's no dependency between them; nothing outside each subfolder is required to run it.

## Quick start

```bash
# Terminal, TypeScript, local hot-seat or vs AI:
cd ts && npm install && npm start

# Terminal, Python, vs bots:
cd python && python3 poker.py --play --bots 3

# Web app, no server needed for local/AI/P2P play:
cd ts && npm install && npm run build:pages && open public/index.html
```

## What's where

| Requirement | TypeScript (`ts/`) | Python (`python/`) |
| --- | --- | --- |
| Terminal play | ✅ hot-seat + vs AI | ✅ vs bots + online |
| Web app (GitHub Pages) | ✅ `public/`, deployed by `.github/workflows/deploy.yml` | — |
| Online multiplayer | ✅ WebSocket server + terminal/web clients, **or** serverless P2P (WebRTC) | ✅ TCP server + terminal clients |
| Voice + text chat | ✅ P2P mode only (full-mesh WebRTC audio + text) | — |
| Offline / vs AI | ✅ local pass & play, vs AI (terminal + browser) | ✅ vs bots |
| Hex save/export | ✅ `exportSaveToHex` / `importSaveFromHex` (`ts/src/utils/serializer.ts`) | ✅ `saves.encode` / `saves.decode` (compressed + CRC32-checksummed) |
| Unit tests | ✅ `npm test` (jest) — engine, hex codec, AI | ✅ `python3 -m unittest discover -s tests` |

## Deploying the web client

The web app is fully static once built, so it deploys to GitHub Pages with no backend:

1. Push this repo to GitHub.
2. Settings → Pages → Source: "GitHub Actions".
3. Push to `main` (or trigger `.github/workflows/deploy.yml` manually) — it runs the TS test suite, builds both
   browser bundles with esbuild, and publishes `ts/public`.

Local Pass & Play, Vs AI, and **Online (P2P)** all work standalone on the deployed page — no server required,
P2P included (it uses public WebRTC signaling infra, not a server of ours). Online (Server) mode needs a
separately hosted WebSocket server (see
[`ts/README.md`](ts/README.md#deploying-the-web-client-to-github-pages)) since GitHub Pages can't run one itself.

## The hex save system, in short

Both implementations serialize game state (chips, blinds, hand number, seats) to JSON, then to bytes, then to a
plain-text hex string wrapped in a small comment header — mailable, pasteable, diffable, and rejected on load if
tampered with (the Python format additionally compresses and CRC32-checksums the payload). See each
subproject's README for the exact format and how to export/import from its CLI or web client.
