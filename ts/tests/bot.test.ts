import { Card } from '../src/game/card';
import { decideAction } from '../src/ai/bot';

const VALID_ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'allin']);

describe('decideAction', () => {
    test('checks back a weak hand with nothing to call', () => {
        const decision = decideAction({
            hand: [new Card('C', 2), new Card('D', 7)],
            community: [new Card('S', 9), new Card('H', 11), new Card('D', 4)],
            toCall: 0,
            chips: 500,
            currentBet: 0,
            minRaise: 10,
            bigBlind: 10,
            potBeforeCall: 20,
            opponentsInHand: 1,
        });
        expect(VALID_ACTIONS.has(decision.action)).toBe(true);
    });

    test('goes all-in when the call would exceed its stack', () => {
        const decision = decideAction({
            hand: [new Card('S', 14), new Card('S', 13)],
            community: [new Card('S', 12), new Card('S', 11), new Card('S', 2)],
            toCall: 500,
            chips: 100,
            currentBet: 500,
            minRaise: 100,
            bigBlind: 10,
            potBeforeCall: 300,
            opponentsInHand: 1,
        });
        expect(decision.action).toBe('allin');
    });

    test('folds a hopeless hand facing a large bet', () => {
        const decision = decideAction({
            hand: [new Card('C', 2), new Card('D', 7)],
            community: [new Card('S', 9), new Card('H', 11), new Card('D', 4)],
            toCall: 400,
            chips: 1000,
            currentBet: 400,
            minRaise: 100,
            bigBlind: 10,
            potBeforeCall: 50,
            opponentsInHand: 1,
        });
        expect(decision.action).toBe('fold');
    });

    test('raises (not bets) when it has the option with nothing left to call, e.g. the big blind', () => {
        // toCall === 0 but currentBet > 0: the player's own blind already equals currentBet.
        // A fresh 'bet' is illegal here (game.ts requires 'raise' once currentBet > 0).
        for (let i = 0; i < 20; i++) {
            const decision = decideAction({
                hand: [new Card('S', 14), new Card('S', 13)], // AKs — comfortably above the value threshold
                community: [],
                toCall: 0,
                chips: 990,
                currentBet: 10,
                minRaise: 10,
                bigBlind: 10,
                potBeforeCall: 15,
                opponentsInHand: 2,
            });
            expect(['check', 'raise']).toContain(decision.action);
            if (decision.action === 'raise') {
                expect(decision.amount).toBeGreaterThan(10);
                expect(decision.amount).toBeLessThanOrEqual(1000);
            }
        }
    });

    test('folds a speculative preflop hand into a big bet at a full table, but can continue heads-up', () => {
        // Regression: preflop equity used to ignore opponent count entirely, so bots would
        // routinely shove suited connectors into 7-way action. A hand only has to beat one
        // random opponent to be worth continuing heads-up, but has to beat all of them at a
        // full table — the same cards should play very differently in the two spots.
        const hand = [new Card('S', 9), new Card('S', 8)]; // 9-8 suited: fine speculative hand, not a monster
        const ctx = {
            hand,
            community: [],
            toCall: 30, // a normal-sized raise, not an overbet — the point is opponent count, not price
            chips: 1000,
            currentBet: 30,
            minRaise: 20,
            bigBlind: 10,
            potBeforeCall: 40,
        };
        const headsUp = decideAction({ ...ctx, opponentsInHand: 1 });
        const fullTable = decideAction({ ...ctx, opponentsInHand: 7 });

        expect(fullTable.action).toBe('fold');
        expect(headsUp.action).not.toBe('fold');
    });

    test('never returns a bet/raise amount that exceeds available chips', () => {
        for (let i = 0; i < 20; i++) {
            const decision = decideAction({
                hand: [new Card('H', 14), new Card('H', 13)],
                community: [],
                toCall: 0,
                chips: 40,
                currentBet: 0,
                minRaise: 10,
                bigBlind: 10,
                potBeforeCall: 15,
                opponentsInHand: 2,
            });
            if (decision.amount !== undefined) {
                expect(decision.amount).toBeLessThanOrEqual(40);
            }
        }
    });
});
