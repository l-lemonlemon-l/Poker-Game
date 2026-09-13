import { Card, Deck } from './card';
import { Player } from './player';
import { evaluateBestHand, compareHandResults } from './handEvaluator';
import { GamePhase, GameStateView, PlayerAction, PublicPlayerView, SavedGame } from '../types';

interface SidePot {
    amount: number;
    eligiblePlayerIds: string[];
}

export class Game {
    players: Player[] = [];
    private deck: Deck = new Deck();
    communityCards: Card[] = [];
    phase: GamePhase = 'waiting';
    dealerIndex = -1;
    actionIndex = -1;
    currentBet = 0;
    minRaise: number;
    handNumber = 0;
    log: string[] = [];
    sidePots: SidePot[] = [];
    lastRevealedHands = new Map<string, string>();

    constructor(public smallBlind = 5, public bigBlind = 10) {
        this.minRaise = bigBlind;
    }

    addPlayer(player: Player): void {
        if (this.players.some((p) => p.id === player.id)) return;
        this.players.push(player);
        this.pushLog(`${player.name} joined the table.`);
    }

    removePlayer(id: string): void {
        const player = this.players.find((p) => p.id === id);
        if (!player) return;
        if (this.phase === 'waiting' || this.phase === 'handover') {
            this.players = this.players.filter((p) => p.id !== id);
        } else {
            // Mid-hand: treat as a fold so pots resolve correctly, remove after the hand.
            player.connected = false;
            player.sittingOut = true;
            if (!player.folded) player.fold();
        }
        this.pushLog(`${player.name} left the table.`);
    }

    private pushLog(message: string): void {
        this.log.push(message);
        if (this.log.length > 50) this.log.shift();
    }

    private activePlayers(): Player[] {
        return this.players.filter((p) => !p.sittingOut && p.chips > 0);
    }

    canStartHand(): boolean {
        return this.activePlayers().length >= 2;
    }

    startHand(): void {
        if (!this.canStartHand()) throw new Error('Need at least 2 players with chips to start a hand');

        // Between hands: drop anyone who disconnected, and let anyone who joined mid-previous-hand into the game.
        const currentDealer = this.dealerIndex >= 0 ? this.players[this.dealerIndex] : undefined;
        this.players = this.players.filter((p) => p.connected);
        for (const p of this.players) {
            if (p.chips > 0) p.sittingOut = false;
        }
        this.dealerIndex = currentDealer ? this.players.indexOf(currentDealer) : -1;

        this.handNumber++;
        this.deck.reset();
        this.communityCards = [];
        this.sidePots = [];
        this.lastRevealedHands.clear();
        this.currentBet = 0;
        this.minRaise = this.bigBlind;

        for (const p of this.players) p.resetForNewHand();

        const active = this.activePlayers();
        // Move dealer button to the next active player.
        do {
            this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
        } while (!active.includes(this.players[this.dealerIndex]));

        const order = this.actingOrderFrom(this.dealerIndex).filter((p) => active.includes(p));
        const headsUp = order.length === 2;

        // Heads-up: dealer/button posts the small blind. Otherwise the two seats left of the button do.
        const sbPlayer = headsUp ? order[0] : order[1];
        const bbPlayer = headsUp ? order[1] : order[2];
        sbPlayer.putChips(this.smallBlind);
        bbPlayer.putChips(this.bigBlind);
        this.pushLog(`${sbPlayer.name} posts small blind (${this.smallBlind}).`);
        this.pushLog(`${bbPlayer.name} posts big blind (${this.bigBlind}).`);
        this.currentBet = this.bigBlind;

        for (let i = 0; i < 2; i++) {
            for (const p of active) p.receiveCard(this.deck.deal(1)[0]);
        }

        this.phase = 'preflop';
        // Action starts left of the big blind (wraps to the button in a 3-handed game, or heads-up, back to the dealer/SB).
        const firstToAct = headsUp ? order[0] : order[3 % order.length];
        this.actionIndex = this.players.indexOf(firstToAct);
        this.resetHasActedExcept();
        this.pushLog(`-- Hand #${this.handNumber} --`);
        this.autoAdvanceIfNoActionPossible();
    }

    /** Players in seat order starting from `startIdx`, wrapping around the table. */
    private actingOrderFrom(startIdx: number): Player[] {
        const order: Player[] = [];
        for (let i = 0; i < this.players.length; i++) {
            order.push(this.players[(startIdx + i) % this.players.length]);
        }
        return order;
    }

    private resetHasActedExcept(keepId?: string): void {
        for (const p of this.players) {
            if (p.id !== keepId) p.hasActed = false;
        }
    }

    getCurrentPlayer(): Player | null {
        if (this.actionIndex < 0) return null;
        const p = this.players[this.actionIndex];
        return p && p.canAct() ? p : null;
    }

    private contenders(): Player[] {
        return this.players.filter((p) => !p.folded);
    }

    applyAction(playerId: string, action: PlayerAction, amount = 0): void {
        const player = this.players.find((p) => p.id === playerId);
        if (!player) throw new Error('Unknown player');
        if (this.getCurrentPlayer()?.id !== playerId) throw new Error('Not your turn');

        const toCall = this.currentBet - player.streetBet;

        switch (action) {
            case 'fold':
                player.fold();
                this.pushLog(`${player.name} folds.`);
                break;

            case 'check':
                if (toCall > 0) throw new Error('Cannot check, there is a bet to call');
                this.pushLog(`${player.name} checks.`);
                break;

            case 'call': {
                if (toCall <= 0) throw new Error('Nothing to call');
                const paid = player.putChips(toCall);
                this.pushLog(`${player.name} calls ${paid}${player.allIn ? ' (all-in)' : ''}.`);
                break;
            }

            case 'allin': {
                const paid = player.putChips(player.chips);
                const totalStreetBet = player.streetBet;
                if (totalStreetBet > this.currentBet) {
                    const raiseSize = totalStreetBet - this.currentBet;
                    const isFullRaise = raiseSize >= this.minRaise;
                    this.currentBet = totalStreetBet;
                    if (isFullRaise) {
                        this.minRaise = raiseSize;
                        this.resetHasActedExcept(player.id);
                    }
                }
                this.pushLog(`${player.name} goes all-in with ${paid}.`);
                break;
            }

            case 'bet': {
                if (this.currentBet > 0) throw new Error('Cannot bet, use raise instead');
                if (amount < this.bigBlind && amount < player.chips) throw new Error(`Minimum bet is ${this.bigBlind}`);
                player.putChips(amount);
                this.currentBet = player.streetBet;
                this.minRaise = Math.max(this.bigBlind, amount);
                this.resetHasActedExcept(player.id);
                this.pushLog(`${player.name} bets ${amount}${player.allIn ? ' (all-in)' : ''}.`);
                break;
            }

            case 'raise': {
                const targetTotal = amount; // amount = new total street bet
                const raiseSize = targetTotal - this.currentBet;
                if (raiseSize < this.minRaise && targetTotal < player.chips + player.streetBet) {
                    throw new Error(`Minimum raise is to ${this.currentBet + this.minRaise}`);
                }
                const toPut = targetTotal - player.streetBet;
                player.putChips(toPut);
                const isFullRaise = raiseSize >= this.minRaise;
                this.currentBet = player.streetBet;
                if (isFullRaise) {
                    this.minRaise = raiseSize;
                    this.resetHasActedExcept(player.id);
                }
                this.pushLog(`${player.name} raises to ${player.streetBet}${player.allIn ? ' (all-in)' : ''}.`);
                break;
            }
        }

        player.hasActed = true;
        this.advance();
    }

    private advance(): void {
        if (this.contenders().length === 1) {
            this.finishHandBySingleWinner(this.contenders()[0]);
            return;
        }
        if (this.isBettingRoundComplete()) {
            this.endBettingRound();
        } else {
            this.moveToNextActor();
        }
    }

    private isBettingRoundComplete(): boolean {
        const contenders = this.contenders();
        const stillToAct = contenders.filter((p) => p.canAct());
        if (stillToAct.length === 0) return true;
        return stillToAct.every((p) => p.hasActed && p.streetBet === this.currentBet);
    }

    private moveToNextActor(): void {
        const order = this.actingOrderFrom((this.actionIndex + 1) % this.players.length);
        const next = order.find((p) => p.canAct());
        this.actionIndex = next ? this.players.indexOf(next) : -1;
        this.autoAdvanceIfNoActionPossible();
    }

    private autoAdvanceIfNoActionPossible(): void {
        if (this.contenders().length === 1) {
            this.finishHandBySingleWinner(this.contenders()[0]);
            return;
        }
        if (!this.getCurrentPlayer()) {
            // No one left who can voluntarily act (everyone else all-in / folded) -> resolve the round.
            if (this.isBettingRoundComplete()) this.endBettingRound();
        }
    }

    private endBettingRound(): void {
        for (const p of this.players) p.resetForNewStreet();
        this.currentBet = 0;
        this.minRaise = this.bigBlind;

        const contendersLeftToAct = this.contenders().filter((p) => p.canAct());
        const skipToShowdown = contendersLeftToAct.length < 2 && this.contenders().length > 1;

        switch (this.phase) {
            case 'preflop':
                this.communityCards.push(...this.deck.deal(3));
                this.phase = 'flop';
                this.pushLog(`Flop: ${this.communityCards.map((c) => c.toString()).join(' ')}`);
                break;
            case 'flop':
                this.communityCards.push(...this.deck.deal(1));
                this.phase = 'turn';
                this.pushLog(`Turn: ${this.communityCards.map((c) => c.toString()).join(' ')}`);
                break;
            case 'turn':
                this.communityCards.push(...this.deck.deal(1));
                this.phase = 'river';
                this.pushLog(`River: ${this.communityCards.map((c) => c.toString()).join(' ')}`);
                break;
            case 'river':
                this.showdown();
                return;
        }

        if (skipToShowdown) {
            // Everyone (or all but one) is all-in: deal remaining streets with no further betting.
            this.endBettingRound();
            return;
        }

        const order = this.actingOrderFrom(this.dealerIndex + 1);
        const first = order.find((p) => p.canAct());
        this.actionIndex = first ? this.players.indexOf(first) : -1;
        this.autoAdvanceIfNoActionPossible();
    }

    private finishHandBySingleWinner(winner: Player): void {
        const potTotal = this.players.reduce((sum, p) => sum + p.committed, 0);
        winner.chips += potTotal;
        this.pushLog(`${winner.name} wins ${potTotal} (all other players folded).`);
        this.phase = 'handover';
        this.actionIndex = -1;
        this.buildSidePots();
    }

    private buildSidePots(): void {
        const committedPlayers = this.players.filter((p) => p.committed > 0);
        const levels = [...new Set(committedPlayers.map((p) => p.committed))].sort((a, b) => a - b);
        const pots: SidePot[] = [];
        let prevLevel = 0;
        for (const level of levels) {
            const layerPlayers = committedPlayers.filter((p) => p.committed >= level);
            const amount = (level - prevLevel) * layerPlayers.length;
            const eligiblePlayerIds = layerPlayers.filter((p) => !p.folded).map((p) => p.id);
            if (amount > 0) pots.push({ amount, eligiblePlayerIds });
            prevLevel = level;
        }
        this.sidePots = pots;
    }

    private showdown(): void {
        this.phase = 'showdown';
        this.actionIndex = -1;
        this.buildSidePots();

        const results = new Map<string, ReturnType<typeof evaluateBestHand>>();
        for (const p of this.contenders()) {
            const result = evaluateBestHand([...p.hand, ...this.communityCards]);
            results.set(p.id, result);
            this.lastRevealedHands.set(p.id, result.name);
        }

        for (const pot of this.sidePots) {
            const eligible = pot.eligiblePlayerIds.filter((id) => results.has(id));
            if (eligible.length === 0) continue;
            let best = results.get(eligible[0])!;
            let winners = [eligible[0]];
            for (const id of eligible.slice(1)) {
                const r = results.get(id)!;
                const cmp = compareHandResults(r, best);
                if (cmp > 0) {
                    best = r;
                    winners = [id];
                } else if (cmp === 0) {
                    winners.push(id);
                }
            }
            const share = Math.floor(pot.amount / winners.length);
            let remainder = pot.amount - share * winners.length;
            for (const id of winners) {
                const player = this.players.find((p) => p.id === id)!;
                let payout = share;
                if (remainder > 0) {
                    payout += 1;
                    remainder--;
                }
                player.chips += payout;
                this.pushLog(`${player.name} wins ${payout} with ${results.get(id)!.name}.`);
            }
        }
    }

    isHandOver(): boolean {
        return this.phase === 'showdown' || this.phase === 'handover';
    }

    getPublicState(viewerId?: string): GameStateView {
        const showCards = this.phase === 'showdown';
        const players: PublicPlayerView[] = this.players.map((p) => ({
            id: p.id,
            name: p.name,
            chips: p.chips,
            streetBet: p.streetBet,
            committed: p.committed,
            folded: p.folded,
            allIn: p.allIn,
            connected: p.connected,
            sittingOut: p.sittingOut,
            isDealer: this.players[this.dealerIndex]?.id === p.id,
            cards: p.id === viewerId || (showCards && !p.folded) ? p.hand.map((c) => c.toData()) : undefined,
            handName: showCards ? this.lastRevealedHands.get(p.id) : undefined,
        }));

        return {
            phase: this.phase,
            communityCards: this.communityCards.map((c) => c.toData()),
            pot: this.players.reduce((sum, p) => sum + p.committed, 0),
            sidePots: this.sidePots,
            currentBet: this.currentBet,
            minRaise: this.minRaise,
            actionOn: this.getCurrentPlayer()?.id ?? null,
            players,
            log: [...this.log],
            handNumber: this.handNumber,
            smallBlind: this.smallBlind,
            bigBlind: this.bigBlind,
        };
    }

    exportSave(): SavedGame {
        return {
            version: 1,
            savedAt: new Date().toISOString(),
            smallBlind: this.smallBlind,
            bigBlind: this.bigBlind,
            dealerIndex: this.dealerIndex,
            handNumber: this.handNumber,
            players: this.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips, isAI: p.isAI })),
        };
    }

    static fromSave(save: SavedGame): Game {
        const game = new Game(save.smallBlind, save.bigBlind);
        game.dealerIndex = save.dealerIndex;
        game.handNumber = save.handNumber;
        for (const p of save.players) {
            const player = new Player(p.id, p.name, p.chips);
            player.isAI = p.isAI ?? false;
            game.addPlayer(player);
        }
        return game;
    }
}
