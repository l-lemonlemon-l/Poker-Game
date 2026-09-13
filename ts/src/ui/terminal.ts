import * as readline from 'readline';
import { CardData, GameStateView, PlayerAction } from '../types';
import { Card } from '../game/card';

/**
 * A readline wrapper that keeps a single, always-attached 'line' listener instead of using
 * Interface#question(). question() registers a one-shot listener per call; if two lines arrive
 * in the same underlying read chunk (common over a piped/slow terminal, or a fast paste), only
 * the first resolves and the second is silently dropped because the next listener hasn't been
 * attached yet. Queuing every line as it arrives avoids that race entirely.
 */
export class LinePrompter {
    private rl: readline.Interface;
    private queue: string[] = [];
    private waiters: ((line: string) => void)[] = [];

    constructor() {
        this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        this.rl.on('line', (line) => {
            const waiter = this.waiters.shift();
            if (waiter) waiter(line);
            else this.queue.push(line);
        });
    }

    async ask(promptText: string): Promise<string> {
        process.stdout.write(promptText);
        if (this.queue.length > 0) return this.queue.shift()!;
        return new Promise<string>((resolve) => this.waiters.push(resolve));
    }

    close(): void {
        this.rl.close();
    }
}

export function renderCards(cards: CardData[] | undefined): string {
    if (!cards || cards.length === 0) return '??  ??';
    return cards.map((c) => Card.fromData(c).toColorString()).join(' ');
}

export function renderTable(state: GameStateView, viewerId?: string): string {
    const lines: string[] = [];
    lines.push('');
    lines.push(`===== Hand #${state.handNumber} — ${state.phase.toUpperCase()} =====`);
    lines.push(`Community: ${renderCards(state.communityCards)}    Pot: ${state.pot}`);
    if (state.sidePots.length > 1) {
        state.sidePots.forEach((p, i) => lines.push(`  Side pot ${i + 1}: ${p.amount}`));
    }
    lines.push('-'.repeat(60));
    for (const p of state.players) {
        const marker = p.id === state.actionOn ? '>' : ' ';
        const dealer = p.isDealer ? ' (D)' : '';
        const status = p.folded ? 'FOLDED' : p.allIn ? 'ALL-IN' : p.sittingOut ? 'SITTING OUT' : '';
        const cards = p.id === viewerId || state.phase === 'showdown' ? renderCards(p.cards) : '?? ??';
        const hand = p.handName ? ` [${p.handName}]` : '';
        const conn = p.connected ? '' : ' (disconnected)';
        lines.push(
            `${marker} ${p.name}${dealer}${conn}  chips:${p.chips}  bet:${p.streetBet}  ${cards}  ${status}${hand}`,
        );
    }
    lines.push('-'.repeat(60));
    if (state.log.length > 0) {
        lines.push('Log: ' + state.log.slice(-4).join(' | '));
    }
    return lines.join('\n');
}

export interface ActionChoice {
    action: PlayerAction;
    amount?: number;
}

/** Prompts a player for their action given the current state. Returns null if the input was "save" (caller handles it). */
export async function promptAction(
    rl: LinePrompter,
    playerName: string,
    chips: number,
    streetBet: number,
    currentBet: number,
    minRaise: number,
    bigBlind: number,
): Promise<ActionChoice | 'save'> {
    const toCall = currentBet - streetBet;
    const options: string[] = ['fold'];
    if (toCall <= 0) options.push('check');
    if (toCall > 0) options.push(`call(${Math.min(toCall, chips)})`);
    if (currentBet === 0) options.push('bet <amt>');
    if (currentBet > 0) options.push(`raise <amt, min ${currentBet + minRaise}>`);
    options.push('allin');

    while (true) {
        const answer = (
            await rl.ask(`${playerName}, your action [${options.join(', ')}] (or 'save'): `)
        ).trim().toLowerCase();

        if (answer === 'save') return 'save';
        if (answer === 'fold') return { action: 'fold' };
        if (answer === 'check') {
            if (toCall > 0) {
                console.log("You can't check, there's a bet to call.");
                continue;
            }
            return { action: 'check' };
        }
        if (answer === 'call') {
            if (toCall <= 0) {
                console.log('Nothing to call — did you mean check?');
                continue;
            }
            return { action: 'call' };
        }
        if (answer === 'allin') return { action: 'allin' };

        const [word, amtStr] = answer.split(/\s+/);
        const amt = Number(amtStr);
        if (word === 'bet' && !Number.isNaN(amt)) {
            if (currentBet > 0) {
                console.log('There is already a bet — use raise.');
                continue;
            }
            return { action: 'bet', amount: amt };
        }
        if (word === 'raise' && !Number.isNaN(amt)) {
            if (currentBet === 0) {
                console.log('Nothing to raise — use bet.');
                continue;
            }
            return { action: 'raise', amount: amt };
        }
        console.log(`Sorry, I didn't understand "${answer}". Try one of: ${options.join(', ')}`);
    }
}

export function createPrompt(): LinePrompter {
    return new LinePrompter();
}
