/**
 * Browser bundle entry point. Everything imported here is the *same* source that powers the
 * Node CLI and WebSocket server (src/game, src/ai, src/utils/serializer) — it has zero Node
 * dependencies (no `fs`/`path`), so esbuild can bundle it straight into a `<script>` for a
 * static, offline-capable page (e.g. GitHub Pages). Built with `npm run build:web` into
 * public/engine.bundle.js and exposed as the global `PokerEngine`.
 */
import { Game } from '../game/game';
import { Player } from '../game/player';
import { Card } from '../game/card';
import { decideForPlayer } from '../ai/bot';
import { exportSaveToHex, importSaveFromHex } from '../utils/serializer';
import { HandRank, SavedGame } from '../types';

/** Save/load a Game entirely client-side (no filesystem) — the browser counterpart of utils/export.ts. */
function exportGameToHex(game: Game): string {
    return exportSaveToHex(game.exportSave());
}

function importGameFromHex(hexString: string): Game {
    return Game.fromSave(importSaveFromHex<SavedGame>(hexString));
}

const PokerEngine = {
    Game,
    Player,
    Card,
    HandRank,
    decideForPlayer,
    exportSaveToHex,
    importSaveFromHex,
    exportGameToHex,
    importGameFromHex,
};

// No `export` here on purpose: this file has no ESM exports, so esbuild's --format=iife just
// wraps it in an isolated scope without wrapping this assignment in an ESM namespace object.
(globalThis as { PokerEngine?: typeof PokerEngine }).PokerEngine = PokerEngine;
