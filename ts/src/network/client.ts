import { WebSocket } from 'ws';
import { ClientMessage, GameStateView, ServerMessage } from '../types';
import { createPrompt, promptAction, renderTable, LinePrompter } from '../ui/terminal';
import { saveStateSnapshotToHexFile, defaultSaveFileName } from '../utils/export';

export class Client {
    private socket: WebSocket;
    private myId: string | null = null;
    private lastState: GameStateView | null = null;
    private rl: LinePrompter;
    private closed = false;

    constructor(private serverUrl: string, private playerName: string) {
        this.rl = createPrompt();
        this.socket = new WebSocket(serverUrl);
        this.setupListeners();
    }

    private setupListeners(): void {
        this.socket.on('open', () => {
            console.log(`Connected to ${this.serverUrl}`);
            this.send({ type: 'join', name: this.playerName });
        });

        this.socket.on('message', (raw: Buffer) => {
            const message = JSON.parse(raw.toString()) as ServerMessage;
            this.handleMessage(message);
        });

        this.socket.on('close', () => {
            console.log('Disconnected from server.');
            this.closed = true;
        });

        this.socket.on('error', (err: Error) => {
            console.error(`Connection error: ${err.message}`);
        });
    }

    private send(message: ClientMessage): void {
        if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    }

    private handleMessage(message: ServerMessage): void {
        switch (message.type) {
            case 'welcome':
                this.myId = message.id;
                break;
            case 'state':
                this.lastState = message.state;
                console.log(renderTable(message.state, this.myId ?? undefined));
                break;
            case 'error':
                console.log(`Error: ${message.message}`);
                break;
            case 'info':
                console.log(`* ${message.message}`);
                break;
            case 'chat':
                console.log(`<${message.from}> ${message.text}`);
                break;
        }
    }

    private mySeat() {
        return this.lastState?.players.find((p) => p.id === this.myId) ?? null;
    }

    /** Single, serialized input loop — the only place that calls rl.question, so prompts never race each other. */
    async run(): Promise<void> {
        while (!this.closed) {
            const state = this.lastState;
            const me = this.mySeat();

            if (state && me && state.actionOn === this.myId) {
                const choice = await promptAction(
                    this.rl,
                    me.name,
                    me.chips,
                    me.streetBet,
                    state.currentBet,
                    state.minRaise,
                    state.bigBlind,
                );
                if (choice === 'save') {
                    const file = saveStateSnapshotToHexFile(state, defaultSaveFileName(state.handNumber));
                    console.log(`Session snapshot saved to ${file}`);
                } else {
                    this.send({ type: 'action', action: choice.action, amount: choice.amount });
                }
                continue;
            }

            const prompt =
                !state || state.phase === 'waiting' || state.phase === 'handover'
                    ? "Type 'start' to begin the next hand, 'save' to export, or 'quit': "
                    : "Waiting for other players... ('save' to export, 'quit' to leave): ";
            const line = (await this.rl.ask(prompt)).trim().toLowerCase();

            if (line === 'start') {
                this.send({ type: 'start' });
            } else if (line === 'save') {
                if (this.lastState) {
                    const file = saveStateSnapshotToHexFile(this.lastState, defaultSaveFileName(this.lastState.handNumber));
                    console.log(`Session snapshot saved to ${file}`);
                } else {
                    console.log('No game state yet to save.');
                }
            } else if (line === 'quit' || line === 'exit') {
                this.socket.close();
                break;
            } else if (line.startsWith('say ')) {
                this.send({ type: 'chat', text: line.slice(4) });
            } else if (line) {
                console.log("Unknown command. Try 'start', 'save', or 'quit'.");
            }
        }
        this.rl.close();
        process.exit(0);
    }
}
