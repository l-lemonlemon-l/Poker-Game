import { WebSocket, WebSocketServer } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import { randomUUID } from 'crypto';
import { Game } from '../game/game';
import { Player } from '../game/player';
import { ClientMessage, ServerMessage } from '../types';
import { saveGameToHexFile, defaultSaveFileName } from '../utils/export';

interface Connection {
    id: string;
    socket: WebSocket;
}

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
};

export class Server {
    private httpServer: http.Server;
    private wss: WebSocketServer;
    private connections: Connection[] = [];
    game: Game;

    constructor(port: number, startChips = 1000) {
        this.game = new Game();
        this.httpServer = this.createStaticServer();
        this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });

        this.wss.on('connection', (socket: WebSocket) => {
            const id = randomUUID();
            this.connections.push({ id, socket });
            this.send(socket, { type: 'welcome', id });

            socket.on('message', (raw: Buffer) => {
                try {
                    this.handleMessage(id, socket, JSON.parse(raw.toString()) as ClientMessage, startChips);
                } catch (err) {
                    this.send(socket, { type: 'error', message: (err as Error).message });
                }
            });

            socket.on('close', () => {
                this.connections = this.connections.filter((c) => c.id !== id);
                this.game.removePlayer(id);
                this.broadcastState();
            });
        });

        this.httpServer.listen(port, () => {
            console.log(`Poker server listening on port ${port}`);
            console.log(`  Web client:      http://localhost:${port}`);
            console.log(`  Terminal client: ws://localhost:${port}/ws`);
        });
        this.startAdminConsole();
    }

    /** Serves the static web client from the public/ directory (no framework needed for a handful of files). */
    private createStaticServer(): http.Server {
        const publicDir = path.resolve(__dirname, '../../public');
        return http.createServer((req, res) => {
            const urlPath = (req.url ?? '/').split('?')[0];
            const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
            const filePath = path.join(publicDir, relative);

            if (!filePath.startsWith(publicDir)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(filePath);
                res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
                res.end(data);
            });
        });
    }

    private handleMessage(id: string, socket: WebSocket, message: ClientMessage, startChips: number): void {
        switch (message.type) {
            case 'join': {
                const name = message.name?.trim() || `Player-${id.slice(0, 4)}`;
                const player = new Player(id, name, startChips);
                if (this.game.phase !== 'waiting' && this.game.phase !== 'handover') {
                    player.sittingOut = true; // joins in on the next hand, not the one in progress
                }
                this.game.addPlayer(player);
                this.broadcastState();
                this.broadcast({ type: 'info', message: `${name} joined.` });
                break;
            }
            case 'action':
                this.game.applyAction(id, message.action, message.amount);
                this.broadcastState();
                this.maybeAutoStartNextHand();
                break;
            case 'start':
                if (this.game.canStartHand() && (this.game.isHandOver() || this.game.phase === 'waiting')) {
                    this.game.startHand();
                    this.broadcastState();
                } else {
                    this.send(socket, { type: 'error', message: 'Cannot start a hand right now.' });
                }
                break;
            case 'chat': {
                const player = this.game.players.find((p) => p.id === id);
                this.broadcast({ type: 'chat', from: player?.name ?? 'unknown', text: message.text });
                break;
            }
        }
    }

    private maybeAutoStartNextHand(): void {
        if (!this.game.isHandOver()) return;
        setTimeout(() => {
            if (this.game.isHandOver() && this.game.canStartHand()) {
                this.game.startHand();
                this.broadcastState();
            }
        }, 4000);
    }

    private send(socket: WebSocket, message: ServerMessage): void {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }

    private broadcast(message: ServerMessage): void {
        for (const c of this.connections) this.send(c.socket, message);
    }

    private broadcastState(): void {
        for (const c of this.connections) {
            this.send(c.socket, { type: 'state', state: this.game.getPublicState(c.id) });
        }
    }

    private startAdminConsole(): void {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log("Admin commands: 'start' (begin play), 'save' (export hex file), 'quit'");
        const loop = async () => {
            while (true) {
                const cmd = (await rl.question('> ')).trim().toLowerCase();
                if (cmd === 'start') {
                    if (this.game.canStartHand()) {
                        this.game.startHand();
                        this.broadcastState();
                    } else {
                        console.log('Need at least 2 connected players with chips.');
                    }
                } else if (cmd === 'save') {
                    const file = saveGameToHexFile(this.game, defaultSaveFileName(this.game.handNumber));
                    console.log(`Saved to ${file}`);
                } else if (cmd === 'quit') {
                    rl.close();
                    process.exit(0);
                } else if (cmd) {
                    console.log("Unknown command. Use 'start', 'save', or 'quit'.");
                }
            }
        };
        loop();
    }
}
