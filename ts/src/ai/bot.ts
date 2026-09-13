import { Card } from '../game/card';
import { evaluateBestHand, compareHandResults } from '../game/handEvaluator';
import { Player } from '../game/player';
import { PlayerAction, Suit } from '../types';

export interface AiDecision {
    action: PlayerAction;
    amount?: number;
}

export interface AiContext {
    hand: Card[];
    community: Card[];
    toCall: number;
    chips: number;
    currentBet: number;
    minRaise: number;
    bigBlind: number;
    potBeforeCall: number;
    opponentsInHand: number;
}

/** Cards not visible to this bot: not in its own hand, and not already on the board. */
function unseenCards(hand: Card[], community: Card[]): Card[] {
    const used = new Set([...hand, ...community].map((c) => `${c.suit}${c.rank}`));
    const suits: Suit[] = ['S', 'H', 'D', 'C'];
    const cards: Card[] = [];
    for (const suit of suits) {
        for (let rank = 2; rank <= 14; rank++) {
            if (!used.has(`${suit}${rank}`)) cards.push(new Card(suit, rank));
        }
    }
    return cards;
}

/**
 * Estimates equity (win probability) via Monte Carlo rollout: deal random opponent hole cards
 * and random board run-outs from the remaining deck, and see how often this hand wins.
 */
function estimateEquity(hand: Card[], community: Card[], opponents: number, iterations = 200): number {
    if (opponents <= 0) return 1;
    const pool = unseenCards(hand, community);
    let wins = 0;
    let ties = 0;

    for (let i = 0; i < iterations; i++) {
        const shuffled = [...pool];
        for (let j = shuffled.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
        }
        let cursor = 0;
        const opponentHands: Card[][] = [];
        for (let o = 0; o < opponents; o++) {
            opponentHands.push([shuffled[cursor], shuffled[cursor + 1]]);
            cursor += 2;
        }
        const boardFill = shuffled.slice(cursor, cursor + (5 - community.length));
        const fullBoard = [...community, ...boardFill];

        const myResult = evaluateBestHand([...hand, ...fullBoard]);
        let best = myResult;
        let iWin = true;
        let tie = false;
        for (const oppHand of opponentHands) {
            const oppResult = evaluateBestHand([...oppHand, ...fullBoard]);
            const cmp = compareHandResults(myResult, oppResult);
            if (cmp < 0) {
                iWin = false;
                break;
            }
            if (cmp === 0) tie = true;
        }
        if (iWin && !tie) wins++;
        else if (iWin && tie) ties++;
    }

    return (wins + ties * 0.5) / iterations;
}

/**
 * A simple but non-trivial bot: preflop it uses hole-card strength (pairs, high cards,
 * suitedness); postflop it runs a Monte Carlo equity estimate against the number of live
 * opponents and compares it to pot odds, with a little randomized aggression thrown in so a
 * table of bots doesn't all play identically.
 */
export function decideAction(ctx: AiContext): AiDecision {
    const { hand, community, toCall, chips, currentBet, minRaise, bigBlind, potBeforeCall, opponentsInHand } = ctx;

    const equity = community.length === 0 ? preflopStrength(hand) : estimateEquity(hand, community, opponentsInHand);
    const potOdds = toCall > 0 ? toCall / (potBeforeCall + toCall) : 0;
    const aggression = 0.85 + Math.random() * 0.3; // 0.85–1.15, adds variety

    if (toCall <= 0) {
        // Nothing more to put in to stay in the hand: check, or bet/raise for value when strong.
        // currentBet > 0 with toCall === 0 happens with the big-blind option — a bet already
        // exists (their own blind), so increasing it is a *raise*, not a fresh bet.
        if (equity > 0.62 && chips > bigBlind) {
            const sizeAbovePot = Math.round(Math.max(bigBlind * 2, potBeforeCall * 0.6) * aggression);
            if (currentBet > 0) {
                const streetBet = currentBet; // toCall is 0, so this player's street bet already equals currentBet
                const raiseTo = Math.min(chips + streetBet, currentBet + Math.max(minRaise, sizeAbovePot));
                if (raiseTo > currentBet) return { action: 'raise', amount: raiseTo };
            } else {
                return { action: 'bet', amount: Math.min(Math.max(bigBlind, sizeAbovePot), chips) };
            }
        }
        return { action: 'check' };
    }

    // Facing a bet: compare equity to pot odds with a safety margin.
    if (equity * aggression < potOdds * 1.05) {
        return { action: 'fold' };
    }

    if (toCall >= chips) {
        return { action: 'allin' };
    }

    if (equity > 0.72 && chips > toCall) {
        const raiseTo = Math.min(chips + (currentBet - toCall), currentBet + Math.max(minRaise, Math.round(potBeforeCall * 0.75 * aggression)));
        if (raiseTo > currentBet) return { action: 'raise', amount: raiseTo };
    }

    return { action: 'call' };
}

/** Quick preflop heuristic (no board yet, so Monte Carlo against a full deck is too noisy to bother with). */
function preflopStrength(hand: Card[]): number {
    if (hand.length !== 2) return 0.3;
    const [a, b] = [...hand].sort((x, y) => y.rank - x.rank);
    const pair = a.rank === b.rank;
    const suited = a.suit === b.suit;
    const gap = a.rank - b.rank;

    let score = (a.rank + b.rank) / 28; // 0..1-ish, ace-king ~ 1.0
    if (pair) score += 0.28 + a.rank / 100;
    if (suited) score += 0.08;
    if (!pair && gap <= 4) score += (5 - gap) * 0.015; // connectedness
    return Math.max(0, Math.min(1, score));
}

/** Convenience wrapper: builds an AiContext from live game objects and returns a decision. */
export function decideForPlayer(
    player: Player,
    community: Card[],
    currentBet: number,
    minRaise: number,
    bigBlind: number,
    potBeforeCall: number,
    opponentsInHand: number,
): AiDecision {
    const toCall = currentBet - player.streetBet;
    return decideAction({
        hand: player.hand,
        community,
        toCall: Math.max(0, toCall),
        chips: player.chips,
        currentBet,
        minRaise,
        bigBlind,
        potBeforeCall,
        opponentsInHand,
    });
}
