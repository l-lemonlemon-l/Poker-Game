export type Suit = 'S' | 'H' | 'D' | 'C';

export interface CardData {
    suit: Suit;
    rank: number; // 2-14, 11=J 12=Q 13=K 14=A
}

export enum HandRank {
    HighCard = 0,
    Pair = 1,
    TwoPair = 2,
    ThreeOfAKind = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    FourOfAKind = 7,
    StraightFlush = 8,
}

export interface HandResult {
    rank: HandRank;
    tiebreakers: number[];
    name: string;
}

export type PlayerAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'handover';

export interface PublicPlayerView {
    id: string;
    name: string;
    chips: number;
    streetBet: number;
    committed: number;
    folded: boolean;
    allIn: boolean;
    connected: boolean;
    sittingOut: boolean;
    cards?: CardData[]; // only present for the viewer's own hand or at showdown reveal
    handName?: string; // revealed at showdown
    isDealer: boolean;
}

export interface GameStateView {
    phase: GamePhase;
    communityCards: CardData[];
    pot: number;
    sidePots: { amount: number; eligiblePlayerIds: string[] }[];
    currentBet: number;
    minRaise: number;
    actionOn: string | null;
    players: PublicPlayerView[];
    log: string[];
    handNumber: number;
    smallBlind: number;
    bigBlind: number;
}

export type ClientMessage =
    | { type: 'join'; name: string }
    | { type: 'action'; action: PlayerAction; amount?: number }
    | { type: 'start' }
    | { type: 'chat'; text: string };

export type ServerMessage =
    | { type: 'welcome'; id: string }
    | { type: 'state'; state: GameStateView }
    | { type: 'error'; message: string }
    | { type: 'chat'; from: string; text: string }
    | { type: 'info'; message: string };

export interface SavedGame {
    version: number;
    savedAt: string;
    smallBlind: number;
    bigBlind: number;
    dealerIndex: number;
    handNumber: number;
    players: { id: string; name: string; chips: number; isAI?: boolean }[];
}
