import { CardData, Suit } from '../types';

const RANK_NAMES: Record<number, string> = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set<Suit>(['H', 'D']);

export class Card implements CardData {
    constructor(public suit: Suit, public rank: number) {}

    toString(): string {
        return `${RANK_NAMES[this.rank]}${SUIT_SYMBOLS[this.suit]}`;
    }

    /** ANSI-colored string for terminal rendering (red for hearts/diamonds). */
    toColorString(): string {
        const text = this.toString().padEnd(3, ' ');
        const color = RED_SUITS.has(this.suit) ? '\x1b[31m' : '\x1b[37m';
        return `${color}${text}\x1b[0m`;
    }

    toData(): CardData {
        return { suit: this.suit, rank: this.rank };
    }

    static fromData(data: CardData): Card {
        return new Card(data.suit, data.rank);
    }
}

export class Deck {
    private cards: Card[];

    constructor() {
        this.cards = Deck.freshCards();
        this.shuffle();
    }

    private static freshCards(): Card[] {
        const suits: Suit[] = ['S', 'H', 'D', 'C'];
        const cards: Card[] = [];
        for (const suit of suits) {
            for (let rank = 2; rank <= 14; rank++) {
                cards.push(new Card(suit, rank));
            }
        }
        return cards;
    }

    reset(): void {
        this.cards = Deck.freshCards();
        this.shuffle();
    }

    shuffle(): void {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal(count: number): Card[] {
        if (count > this.cards.length) {
            throw new Error('Not enough cards left in the deck');
        }
        return this.cards.splice(0, count);
    }

    remaining(): number {
        return this.cards.length;
    }
}
