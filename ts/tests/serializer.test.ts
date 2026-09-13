import { toHex, fromHex, exportSaveToHex, importSaveFromHex } from '../src/utils/serializer';
import { Game } from '../src/game/game';
import { Player } from '../src/game/player';
import { exportGameToHex, importGameFromHex } from '../src/utils/export';

describe('toHex / fromHex', () => {
    test('round-trips arbitrary JSON data', () => {
        const data = { a: 1, b: 'text with unicode ♠♥ and spaces', c: [1, 2, 3], d: null };
        expect(fromHex(toHex(data))).toEqual(data);
    });

    test('produces only lowercase hex digits, two per byte', () => {
        const hex = toHex({ x: 1 });
        expect(hex).toMatch(/^[0-9a-f]*$/);
        expect(hex.length % 2).toBe(0);
    });

    test('rejects malformed hex input', () => {
        expect(() => fromHex('not-hex')).toThrow('Input is not valid hex data');
        expect(() => fromHex('abc')).toThrow('Input is not valid hex data'); // odd length
    });
});

describe('exportSaveToHex / importSaveFromHex', () => {
    test('round-trips a payload through the commented .hex.txt format', () => {
        const payload = { version: 1, players: [{ name: 'Alice', chips: 500 }] };
        const hexText = exportSaveToHex(payload);

        expect(hexText.split('\n')[0]).toMatch(/^# POKER-SAVE-V1/);
        expect(importSaveFromHex(hexText)).toEqual(payload);
    });

    test('ignores blank lines and accepts hex pasted without the header', () => {
        const payload = { foo: 'bar' };
        const bareHex = exportSaveToHex(payload).split('\n')[1];
        expect(importSaveFromHex(bareHex)).toEqual(payload);
    });

    test('rejects a tampered payload as invalid hex or bad JSON', () => {
        const hexText = exportSaveToHex({ a: 1 });
        const corrupted = hexText.slice(0, -3); // truncate mid-byte-stream
        expect(() => importSaveFromHex(corrupted)).toThrow();
    });
});

describe('exportGameToHex / importGameFromHex (Game round trip)', () => {
    test('restores chips, blinds, and hand number from a hex save', () => {
        const game = new Game(15, 30);
        game.addPlayer(new Player('p0', 'Alice', 800));
        game.addPlayer(new Player('p1', 'Bob', 1200));
        game.handNumber = 7;

        const hex = exportGameToHex(game);
        const restored = importGameFromHex(hex);

        expect(restored.smallBlind).toBe(15);
        expect(restored.bigBlind).toBe(30);
        expect(restored.handNumber).toBe(7);
        expect(restored.players.map((p) => ({ name: p.name, chips: p.chips }))).toEqual([
            { name: 'Alice', chips: 800 },
            { name: 'Bob', chips: 1200 },
        ]);
    });
});
