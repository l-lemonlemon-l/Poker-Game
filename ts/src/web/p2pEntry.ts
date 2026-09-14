/**
 * Serverless P2P networking for online play: bundled separately from the game engine
 * (public/p2p.bundle.js) so Local Pass & Play / Vs AI never pull in WebRTC/signaling code
 * they don't need. Trystero handles peer discovery and signaling over the public Nostr relay
 * network (no server of ours involved) and gives us plain WebRTC data channels + media
 * streams once peers are connected.
 */
import { joinRoom, selfId } from 'trystero';

(globalThis as { PokerP2P?: { joinRoom: typeof joinRoom; selfId: string } }).PokerP2P = {
    joinRoom,
    selfId,
};
