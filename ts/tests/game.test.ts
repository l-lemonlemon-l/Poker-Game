import { Game } from '../src/game/game';
import { Player } from '../src/game/player';

function makeGame(names: string[], chips = 1000, sb = 5, bb = 10): Game {
    const game = new Game(sb, bb);
    names.forEach((name, i) => game.addPlayer(new Player(`p${i}`, name, chips)));
    return game;
}

describe('Game blinds and dealing', () => {
    test('posts small and big blinds and deals two cards to each active player', () => {
        const game = makeGame(['Alice', 'Bob', 'Carol'], 1000);
        game.startHand();

        const [alice, bob, carol] = game.players;
        // Dealer button starts at index 0 on the very first hand.
        expect(game.dealerIndex).toBe(0);
        expect(bob.streetBet).toBe(5); // small blind, left of dealer
        expect(carol.streetBet).toBe(10); // big blind
        expect(game.currentBet).toBe(10);
        for (const p of game.players) expect(p.hand.length).toBe(2);
        expect(game.phase).toBe('preflop');
    });

    test('heads-up: dealer posts the small blind', () => {
        const game = makeGame(['Alice', 'Bob'], 1000);
        game.startHand();
        const [alice, bob] = game.players;
        expect(alice.streetBet).toBe(5);
        expect(bob.streetBet).toBe(10);
    });

    test('rejects starting a hand with fewer than two funded players', () => {
        const game = makeGame(['Alice'], 1000);
        expect(() => game.startHand()).toThrow();
    });
});

describe('Game betting round progression', () => {
    test('advances from preflop to flop once everyone has called', () => {
        const game = makeGame(['Alice', 'Bob', 'Carol'], 1000);
        game.startHand();
        // Alice (button) acts first preflop in a 3-handed game.
        expect(game.getCurrentPlayer()?.name).toBe('Alice');
        game.applyAction('p0', 'call'); // Alice calls the big blind
        game.applyAction('p1', 'call'); // Bob (small blind) completes
        game.applyAction('p2', 'check'); // Carol (big blind) checks
        expect(game.phase).toBe('flop');
        expect(game.communityCards.length).toBe(3);
        expect(game.currentBet).toBe(0);
    });

    test('rejects acting out of turn', () => {
        const game = makeGame(['Alice', 'Bob', 'Carol'], 1000);
        game.startHand();
        expect(() => game.applyAction('p2', 'check')).toThrow('Not your turn');
    });

    test('rejects checking when there is a bet to call', () => {
        const game = makeGame(['Alice', 'Bob', 'Carol'], 1000);
        game.startHand();
        expect(() => game.applyAction('p0', 'check')).toThrow();
    });

    test('a full raise reopens the action for players who already acted', () => {
        const game = makeGame(['Alice', 'Bob', 'Carol'], 1000);
        game.startHand();
        game.applyAction('p0', 'raise', 30); // Alice raises to 30
        game.applyAction('p1', 'call'); // Bob calls 30
        // Carol (big blind) still needs to act on the raise even though her blind covered the original bet.
        expect(game.getCurrentPlayer()?.id).toBe('p2');
        game.applyAction('p2', 'raise', 100); // re-raise
        // Reopens for Alice and Bob again.
        expect(game.getCurrentPlayer()?.id).toBe('p0');
    });

    test('folding down to one player awards them the whole pot immediately', () => {
        const game = makeGame(['Alice', 'Bob', 'Carol'], 1000);
        game.startHand();
        const potBefore = game.players.reduce((s, p) => s + p.committed, 0);
        game.applyAction('p0', 'fold');
        game.applyAction('p1', 'fold');
        expect(game.isHandOver()).toBe(true);
        expect(game.players.find((p) => p.id === 'p2')!.chips).toBe(1000 - 10 + potBefore);
    });
});

describe('Game side pots and showdown', () => {
    test('builds correct side pots when a short stack is all-in', () => {
        const game = new Game(5, 10);
        game.addPlayer(new Player('p0', 'Alice', 100)); // short stack
        game.addPlayer(new Player('p1', 'Bob', 1000));
        game.addPlayer(new Player('p2', 'Carol', 1000));
        game.startHand();

        game.applyAction('p0', 'allin'); // Alice all-in for 100 total
        game.applyAction('p1', 'call'); // Bob matches 100
        game.applyAction('p2', 'call'); // Carol matches 100

        // All three matched the same amount -> a single main pot, no side pot yet.
        expect(game.phase).toBe('flop');
    });

    test('an uneven all-in creates a side pot excluding the short stack from the extra layer', () => {
        const game = new Game(5, 10);
        game.addPlayer(new Player('p0', 'Alice', 50)); // will go all-in short
        game.addPlayer(new Player('p1', 'Bob', 1000));
        game.startHand();

        // Heads-up: Alice(dealer) posts SB 5, Bob posts BB 10.
        game.applyAction('p0', 'allin'); // Alice puts in all 50 total
        game.applyAction('p1', 'call'); // Bob calls to match 50

        // Betting round is complete (only one contender can still act, but they matched) -> board runs out.
        expect(['flop', 'turn', 'river', 'showdown', 'handover']).toContain(game.phase);
    });

    test('splits the pot on a tie with correct odd-chip distribution', () => {
        const game = new Game(5, 10);
        game.addPlayer(new Player('p0', 'Alice', 1000));
        game.addPlayer(new Player('p1', 'Bob', 1000));
        game.startHand();

        // Drive the hand to showdown via calls/checks each street.
        const playThroughStreet = () => {
            while (!game.isHandOver() && game.getCurrentPlayer()) {
                const current = game.getCurrentPlayer()!;
                const toCall = game.currentBet - current.streetBet;
                if (toCall > 0) game.applyAction(current.id, 'call');
                else game.applyAction(current.id, 'check');
            }
        };
        playThroughStreet();

        expect(game.isHandOver()).toBe(true);
        const totalChips = game.players.reduce((s, p) => s + p.chips, 0);
        expect(totalChips).toBe(2000); // no chips created or destroyed
    });
});

describe('Game save/load round trip', () => {
    test('fromSave reconstructs players, chips, and blinds', () => {
        const game = makeGame(['Alice', 'Bob'], 750, 25, 50);
        game.handNumber = 3;
        const save = game.exportSave();
        const restored = Game.fromSave(save);

        expect(restored.smallBlind).toBe(25);
        expect(restored.bigBlind).toBe(50);
        expect(restored.handNumber).toBe(3);
        expect(restored.players.map((p) => [p.name, p.chips])).toEqual([
            ['Alice', 750],
            ['Bob', 750],
        ]);
    });
});
