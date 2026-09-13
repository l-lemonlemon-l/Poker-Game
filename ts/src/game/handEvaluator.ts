import { Card } from './card';
import { HandRank, HandResult } from '../types';

const HAND_NAMES: Record<HandRank, string> = {
    [HandRank.HighCard]: 'High Card',
    [HandRank.Pair]: 'Pair',
    [HandRank.TwoPair]: 'Two Pair',
    [HandRank.ThreeOfAKind]: 'Three of a Kind',
    [HandRank.Straight]: 'Straight',
    [HandRank.Flush]: 'Flush',
    [HandRank.FullHouse]: 'Full House',
    [HandRank.FourOfAKind]: 'Four of a Kind',
    [HandRank.StraightFlush]: 'Straight Flush',
};

function combinations<T>(items: T[], k: number): T[][] {
    const results: T[][] = [];
    const combo: T[] = [];
    function backtrack(start: number) {
        if (combo.length === k) {
            results.push([...combo]);
            return;
        }
        for (let i = start; i < items.length; i++) {
            combo.push(items[i]);
            backtrack(i + 1);
            combo.pop();
        }
    }
    backtrack(0);
    return results;
}

/** Returns the descending high card of a straight within the given sorted-desc unique ranks, or null. */
function straightHigh(uniqueRanksDesc: number[]): number | null {
    const ranks = [...uniqueRanksDesc];
    if (ranks.includes(14)) ranks.push(1); // ace-low wheel
    for (let i = 0; i <= ranks.length - 5; i++) {
        let isRun = true;
        for (let j = 0; j < 4; j++) {
            if (ranks[i + j] - ranks[i + j + 1] !== 1) {
                isRun = false;
                break;
            }
        }
        if (isRun) return ranks[i];
    }
    return null;
}

export function evaluate5(cards: Card[]): HandResult {
    if (cards.length !== 5) throw new Error('evaluate5 requires exactly 5 cards');

    const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
    const isFlush = cards.every((c) => c.suit === cards[0].suit);

    const counts = new Map<number, number>();
    for (const r of ranksDesc) counts.set(r, (counts.get(r) ?? 0) + 1);

    const groups = [...counts.entries()]
        .map(([rank, count]) => ({ rank, count }))
        .sort((a, b) => (b.count - a.count) || (b.rank - a.rank));

    const uniqueRanksDesc = [...counts.keys()].sort((a, b) => b - a);
    const sHigh = uniqueRanksDesc.length === 5 ? straightHigh(uniqueRanksDesc) : null;

    if (isFlush && sHigh !== null) {
        return { rank: HandRank.StraightFlush, tiebreakers: [sHigh], name: sHigh === 14 ? 'Royal Flush' : HAND_NAMES[HandRank.StraightFlush] };
    }
    if (groups[0].count === 4) {
        const kicker = ranksDesc.find((r) => r !== groups[0].rank)!;
        return { rank: HandRank.FourOfAKind, tiebreakers: [groups[0].rank, kicker], name: HAND_NAMES[HandRank.FourOfAKind] };
    }
    if (groups[0].count === 3 && groups[1]?.count >= 2) {
        return { rank: HandRank.FullHouse, tiebreakers: [groups[0].rank, groups[1].rank], name: HAND_NAMES[HandRank.FullHouse] };
    }
    if (isFlush) {
        return { rank: HandRank.Flush, tiebreakers: ranksDesc, name: HAND_NAMES[HandRank.Flush] };
    }
    if (sHigh !== null) {
        return { rank: HandRank.Straight, tiebreakers: [sHigh], name: HAND_NAMES[HandRank.Straight] };
    }
    if (groups[0].count === 3) {
        const kickers = ranksDesc.filter((r) => r !== groups[0].rank).slice(0, 2);
        return { rank: HandRank.ThreeOfAKind, tiebreakers: [groups[0].rank, ...kickers], name: HAND_NAMES[HandRank.ThreeOfAKind] };
    }
    if (groups[0].count === 2 && groups[1]?.count === 2) {
        const [hi, lo] = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
        const kicker = ranksDesc.find((r) => r !== hi && r !== lo)!;
        return { rank: HandRank.TwoPair, tiebreakers: [hi, lo, kicker], name: HAND_NAMES[HandRank.TwoPair] };
    }
    if (groups[0].count === 2) {
        const kickers = ranksDesc.filter((r) => r !== groups[0].rank).slice(0, 3);
        return { rank: HandRank.Pair, tiebreakers: [groups[0].rank, ...kickers], name: HAND_NAMES[HandRank.Pair] };
    }
    return { rank: HandRank.HighCard, tiebreakers: ranksDesc, name: HAND_NAMES[HandRank.HighCard] };
}

export function compareHandResults(a: HandResult, b: HandResult): number {
    if (a.rank !== b.rank) return a.rank - b.rank;
    for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
        const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/** Best 5-card hand out of any number (>=5) of cards, e.g. 2 hole + 5 community. */
export function evaluateBestHand(cards: Card[]): HandResult {
    if (cards.length < 5) throw new Error('Need at least 5 cards to evaluate a hand');
    if (cards.length === 5) return evaluate5(cards);

    let best: HandResult | null = null;
    for (const combo of combinations(cards, 5)) {
        const result = evaluate5(combo);
        if (!best || compareHandResults(result, best) > 0) best = result;
    }
    return best!;
}
