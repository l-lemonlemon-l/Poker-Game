import { Card } from './card';

export class Player {
    hand: Card[] = [];
    folded = false;
    allIn = false;
    /** Chips committed during the current betting street. */
    streetBet = 0;
    /** Chips committed across the whole hand (used for side-pot math). */
    committed = 0;
    hasActed = false;
    connected = true;
    sittingOut = false;
    isAI = false;

    constructor(public id: string, public name: string, public chips: number) {}

    resetForNewHand(): void {
        this.hand = [];
        this.folded = false;
        this.allIn = false;
        this.streetBet = 0;
        this.committed = 0;
        this.hasActed = false;
    }

    resetForNewStreet(): void {
        this.streetBet = 0;
        this.hasActed = false;
    }

    receiveCard(card: Card): void {
        this.hand.push(card);
    }

    /** Puts up to `amount` chips into the pot, capping at the player's stack (all-in). Returns chips actually committed. */
    putChips(amount: number): number {
        const actual = Math.min(amount, this.chips);
        this.chips -= actual;
        this.streetBet += actual;
        this.committed += actual;
        if (this.chips === 0) this.allIn = true;
        return actual;
    }

    fold(): void {
        this.folded = true;
    }

    canAct(): boolean {
        return !this.folded && !this.allIn && this.chips > 0 && !this.sittingOut;
    }
}
