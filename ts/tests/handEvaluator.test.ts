import { Card } from '../src/game/card';
import { evaluateBestHand, compareHandResults, evaluate5 } from '../src/game/handEvaluator';
import { HandRank } from '../src/types';

function cards(spec: string[]): Card[] {
    // e.g. "AH" "10S" "KD"
    return spec.map((s) => {
        const suit = s.slice(-1) as any;
        const rankStr = s.slice(0, -1);
        const rank = { J: 11, Q: 12, K: 13, A: 14 }[rankStr] ?? parseInt(rankStr, 10);
        return new Card(suit, rank);
    });
}

describe('evaluate5', () => {
    test('recognizes a royal flush', () => {
        const result = evaluate5(cards(['AS', 'KS', 'QS', 'JS', '10S']));
        expect(result.rank).toBe(HandRank.StraightFlush);
        expect(result.name).toBe('Royal Flush');
    });

    test('recognizes a straight flush below ace-high', () => {
        const result = evaluate5(cards(['9H', '8H', '7H', '6H', '5H']));
        expect(result.rank).toBe(HandRank.StraightFlush);
        expect(result.tiebreakers[0]).toBe(9);
    });

    test('recognizes the ace-low wheel straight', () => {
        const result = evaluate5(cards(['AS', '2H', '3D', '4C', '5S']));
        expect(result.rank).toBe(HandRank.Straight);
        expect(result.tiebreakers[0]).toBe(5);
    });

    test('recognizes four of a kind with correct kicker', () => {
        const result = evaluate5(cards(['9S', '9H', '9D', '9C', 'KS']));
        expect(result.rank).toBe(HandRank.FourOfAKind);
        expect(result.tiebreakers).toEqual([9, 13]);
    });

    test('recognizes a full house, trips rank first', () => {
        const result = evaluate5(cards(['4S', '4H', '4D', '9C', '9S']));
        expect(result.rank).toBe(HandRank.FullHouse);
        expect(result.tiebreakers).toEqual([4, 9]);
    });

    test('recognizes a flush and ranks it by descending kickers', () => {
        const result = evaluate5(cards(['2S', '5S', '9S', 'JS', 'KS']));
        expect(result.rank).toBe(HandRank.Flush);
        expect(result.tiebreakers).toEqual([13, 11, 9, 5, 2]);
    });

    test('recognizes two pair with a kicker', () => {
        const result = evaluate5(cards(['KS', 'KH', '3D', '3C', '7S']));
        expect(result.rank).toBe(HandRank.TwoPair);
        expect(result.tiebreakers).toEqual([13, 3, 7]);
    });

    test('recognizes high card', () => {
        const result = evaluate5(cards(['2S', '5H', '9D', 'JC', 'KS']));
        expect(result.rank).toBe(HandRank.HighCard);
        expect(result.tiebreakers).toEqual([13, 11, 9, 5, 2]);
    });

    test('rejects anything other than 5 cards', () => {
        expect(() => evaluate5(cards(['2S', '5H', '9D', 'JC']))).toThrow();
    });
});

describe('compareHandResults', () => {
    test('ranks a higher category above a lower one regardless of tiebreakers', () => {
        const pair = evaluate5(cards(['2S', '2H', '9D', 'JC', 'KS']));
        const highCard = evaluate5(cards(['3S', '5H', '9C', 'JD', 'AS']));
        expect(compareHandResults(pair, highCard)).toBeGreaterThan(0);
    });

    test('breaks ties within the same category by tiebreakers', () => {
        const acesUp = evaluate5(cards(['AS', 'AH', '2D', '3C', '4S']));
        const kingsUp = evaluate5(cards(['KS', 'KH', '2D', '3C', '4S']));
        expect(compareHandResults(acesUp, kingsUp)).toBeGreaterThan(0);
    });

    test('is symmetric for identical hands', () => {
        const a = evaluate5(cards(['AS', 'AH', '2D', '3C', '4S']));
        const b = evaluate5(cards(['AC', 'AD', '2S', '3H', '4C']));
        expect(compareHandResults(a, b)).toBe(0);
    });
});

describe('evaluateBestHand', () => {
    test('finds the best 5-card hand out of 7 (2 hole + 5 board)', () => {
        // Hole: pocket aces. Board makes a higher flush available for someone with a spade,
        // but this player should still be scored on their true best 5-of-7.
        const seven = cards(['AS', 'AH', '2S', '5S', '9S', 'JS', '3D']);
        const result = evaluateBestHand(seven);
        // Best 5 of these 7 is the spade flush (2S 5S 9S JS AS), not the pair of aces.
        expect(result.rank).toBe(HandRank.Flush);
    });

    test('requires at least 5 cards', () => {
        expect(() => evaluateBestHand(cards(['AS', 'AH']))).toThrow();
    });
});
