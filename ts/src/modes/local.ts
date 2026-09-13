import { Game } from '../game/game';
import { Player } from '../game/player';
import { createPrompt, promptAction, renderTable } from '../ui/terminal';
import { saveGameToHexFile, loadGameFromHexFile, defaultSaveFileName } from '../utils/export';
import { decideForPlayer } from '../ai/bot';

function clearScreen(): void {
    if (process.stdout.isTTY) console.clear();
}

async function pause(rl: ReturnType<typeof createPrompt>, message: string): Promise<void> {
    await rl.ask(message);
}

export async function runLocalGame(resumeFrom?: string): Promise<void> {
    const rl = createPrompt();
    let game: Game;

    if (resumeFrom) {
        game = loadGameFromHexFile(resumeFrom);
        console.log(`Resumed session from ${resumeFrom} (hand #${game.handNumber}, ${game.players.length} players).`);
    } else {
        game = new Game();
        console.log('=== Local Poker (hot-seat) ===');
        const countStr = await rl.ask('How many seats total (2-8)? ');
        const count = Math.max(2, Math.min(8, parseInt(countStr, 10) || 2));
        const chipsStr = await rl.ask('Starting chips per player [1000]: ');
        const startChips = parseInt(chipsStr, 10) || 1000;
        for (let i = 1; i <= count; i++) {
            const kind = (await rl.ask(`Seat ${i}: human or AI? [h/a, default h]: `)).trim().toLowerCase();
            const isAI = kind === 'a' || kind === 'ai';
            const defaultName = isAI ? `Bot ${i}` : `Player ${i}`;
            const name = isAI
                ? defaultName
                : (await rl.ask(`Name for player ${i} [${defaultName}]: `)).trim() || defaultName;
            const player = new Player(`p${i}`, name, startChips);
            player.isAI = isAI;
            game.addPlayer(player);
        }
        if (game.players.every((p) => p.isAI)) {
            console.log('At least one seat must be human — seat 1 will play as a human.');
            game.players[0].isAI = false;
        }
        const sbStr = await rl.ask(`Small blind [${game.smallBlind}]: `);
        const bbStr = await rl.ask(`Big blind [${game.bigBlind}]: `);
        if (sbStr.trim()) game.smallBlind = parseInt(sbStr, 10) || game.smallBlind;
        if (bbStr.trim()) game.bigBlind = parseInt(bbStr, 10) || game.bigBlind;
    }

    while (game.canStartHand()) {
        game.startHand();

        while (!game.isHandOver()) {
            const current = game.getCurrentPlayer();
            if (!current) break;

            if (current.isAI) {
                const opponentsInHand = game.players.filter((p) => !p.folded && p.id !== current.id).length;
                const decision = decideForPlayer(
                    current,
                    game.communityCards,
                    game.currentBet,
                    game.minRaise,
                    game.bigBlind,
                    game.players.reduce((sum, p) => sum + p.committed, 0),
                    opponentsInHand,
                );
                game.applyAction(current.id, decision.action, decision.amount);
                console.log(`${current.name} (AI) ${decision.action}s${decision.amount ? ` to ${decision.amount}` : ''}.`);
                continue;
            }

            clearScreen();
            console.log(`Pass the device to ${current.name}.`);
            await pause(rl, 'Press Enter when ready to reveal your cards...');
            clearScreen();
            console.log(renderTable(game.getPublicState(current.id), current.id));

            const choice = await promptAction(
                rl,
                current.name,
                current.chips,
                current.streetBet,
                game.currentBet,
                game.minRaise,
                game.bigBlind,
            );

            if (choice === 'save') {
                const file = saveGameToHexFile(game, defaultSaveFileName(game.handNumber));
                console.log(`Session saved to ${file}`);
                await pause(rl, 'Press Enter to continue...');
                continue;
            }

            try {
                game.applyAction(current.id, choice.action, choice.amount);
            } catch (err) {
                console.log(`Invalid action: ${(err as Error).message}`);
                await pause(rl, 'Press Enter to try again...');
            }
        }

        clearScreen();
        console.log(renderTable(game.getPublicState()));
        console.log('');

        const remaining = game.players.filter((p) => p.chips > 0);
        if (remaining.length < 2) {
            console.log(`${remaining[0]?.name ?? 'Nobody'} wins the session!`);
            break;
        }

        const next = (
            await rl.ask("Press Enter for next hand, or type 'save' to export, 'quit' to stop: ")
        ).trim().toLowerCase();
        if (next === 'quit') break;
        if (next === 'save') {
            const file = saveGameToHexFile(game, defaultSaveFileName(game.handNumber));
            console.log(`Session saved to ${file}`);
            await rl.ask('Press Enter for next hand...');
        }
    }

    console.log('Thanks for playing!');
    rl.close();
}
