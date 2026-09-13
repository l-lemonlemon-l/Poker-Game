import * as fs from 'fs';
import * as path from 'path';
import { Game } from '../game/game';
import { GameStateView, SavedGame } from '../types';
import { exportSaveToHex, importSaveFromHex } from './serializer';

/** Serializes the game's session state (chips, seating, blinds) into the hex `.txt` save format. */
export function exportGameToHex(game: Game): string {
    return exportSaveToHex(game.exportSave());
}

/** Reciprocal of `exportGameToHex`: parses a hex save string back into a playable `Game`. */
export function importGameFromHex(hexString: string): Game {
    return Game.fromSave(importSaveFromHex<SavedGame>(hexString));
}

/** Writes `exportGameToHex(game)` out to disk and returns the resolved file path. */
export function saveGameToHexFile(game: Game, filePath: string): string {
    const resolved = path.resolve(filePath);
    fs.writeFileSync(resolved, exportGameToHex(game), 'utf8');
    return resolved;
}

/** Reads a hex save file written by `saveGameToHexFile` and rebuilds a Game from it. */
export function loadGameFromHexFile(filePath: string): Game {
    const resolved = path.resolve(filePath);
    return importGameFromHex(fs.readFileSync(resolved, 'utf8'));
}

/** Lets a network client export the last state broadcast it received, without holding a full Game instance. */
export function saveStateSnapshotToHexFile(state: GameStateView, filePath: string): string {
    const save: SavedGame = {
        version: 1,
        savedAt: new Date().toISOString(),
        smallBlind: state.smallBlind,
        bigBlind: state.bigBlind,
        dealerIndex: Math.max(0, state.players.findIndex((p) => p.isDealer)),
        handNumber: state.handNumber,
        players: state.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips })),
    };
    const resolved = path.resolve(filePath);
    fs.writeFileSync(resolved, exportSaveToHex(save), 'utf8');
    return resolved;
}

export function defaultSaveFileName(handNumber: number): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `poker-save-hand${handNumber}-${stamp}.hex.txt`;
}
