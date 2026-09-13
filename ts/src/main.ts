import { runLocalGame } from './modes/local';
import { Server } from './network/server';
import { Client } from './network/client';

function printUsage(): void {
    console.log(`Terminal Poker

Usage:
  npm start                          Local hot-seat game (pass the terminal around)
  npm start -- local --load <file>   Resume a local hot-seat session from a hex save
  npm run start:server [port]        Host a game server (terminal admin console + web UI at http://localhost:<port>)
  npm run start:client <ws-url> <name>   Join a hosted game from the terminal (e.g. ws://localhost:3000/ws)

Or, after "npm run build":
  node dist/main.js local
  node dist/main.js host 3000
  node dist/main.js join ws://localhost:3000/ws Alice
`);
}

async function main(): Promise<void> {
    const [, , mode, ...rest] = process.argv;

    switch (mode) {
        case undefined:
        case 'local': {
            const loadIdx = rest.indexOf('--load');
            const loadFile = loadIdx >= 0 ? rest[loadIdx + 1] : undefined;
            await runLocalGame(loadFile);
            break;
        }
        case 'host': {
            const port = parseInt(rest[0], 10) || 3000;
            new Server(port);
            break;
        }
        case 'join': {
            const url = rest[0];
            const name = rest[1];
            if (!url || !name) {
                console.log('Usage: join <ws-url> <name>');
                process.exit(1);
            }
            const client = new Client(url, name);
            await client.run();
            break;
        }
        default:
            printUsage();
            process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
