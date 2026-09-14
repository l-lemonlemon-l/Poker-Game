(() => {
    const { Game, Player, decideForPlayer, exportGameToHex, importGameFromHex, exportSaveToHex } = window.PokerEngine;
    const { joinRoom, selfId } = window.PokerP2P;

    const P2P_APP_ID = 'terminal-poker-ts-v1';
    const LOBBY_ROOM_ID = 'public-lobby-v1';
    const LOBBY_SCAN_MS = 4000;
    const ANNOUNCE_INTERVAL_MS = 4000;
    const ANNOUNCE_STALE_MS = 10000;

    function randomRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read aloud
        let code = '';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    // ---------------------------------------------------------------- card rendering ----
    const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
    const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
    const RED_SUITS = new Set(['H', 'D']);

    function cardLabel(card) {
        const rank = RANK_NAMES[card.rank] ?? String(card.rank);
        return `${rank}${SUIT_SYMBOLS[card.suit]}`;
    }

    function renderCardSpan(card) {
        const span = document.createElement('span');
        span.className = `card ${RED_SUITS.has(card.suit) ? 'red' : 'black'}`;
        span.textContent = cardLabel(card) + ' ';
        return span;
    }

    function renderHiddenCards(count) {
        const span = document.createElement('span');
        span.className = 'card';
        span.textContent = '🂠 '.repeat(count);
        return span;
    }

    // ---------------------------------------------------------------- DOM refs ----
    const els = {
        modeScreen: document.getElementById('mode-screen'),
        modeLocal: document.getElementById('mode-local'),
        modeAi: document.getElementById('mode-ai'),
        modeOnline: document.getElementById('mode-online'),
        modeP2p: document.getElementById('mode-p2p'),
        loadHexInput: document.getElementById('load-hex-input'),
        loadHexFile: document.getElementById('load-hex-file'),
        loadHexBtn: document.getElementById('load-hex-btn'),
        loadStatus: document.getElementById('load-status'),

        joinScreen: document.getElementById('join-screen'),
        joinTitle: document.getElementById('join-title'),
        joinFields: document.getElementById('join-fields'),
        joinBtn: document.getElementById('join-btn'),
        backBtn: document.getElementById('back-btn'),
        joinStatus: document.getElementById('join-status'),

        quickmatchScreen: document.getElementById('quickmatch-screen'),
        quickmatchStatus: document.getElementById('quickmatch-status'),
        quickmatchCancelBtn: document.getElementById('quickmatch-cancel-btn'),

        tableScreen: document.getElementById('table-screen'),
        revealOverlay: document.getElementById('reveal-overlay'),
        revealText: document.getElementById('reveal-text'),
        revealBtn: document.getElementById('reveal-btn'),
        handInfo: document.getElementById('hand-info'),
        roomCodeBanner: document.getElementById('room-code-banner'),
        voiceControls: document.getElementById('voice-controls'),
        voiceToggleBtn: document.getElementById('voice-toggle-btn'),
        voiceStatus: document.getElementById('voice-status'),
        remoteAudio: document.getElementById('remote-audio'),
        communityCards: document.getElementById('community-cards'),
        potDisplay: document.getElementById('pot-display'),
        players: document.getElementById('players'),
        lobbyControls: document.getElementById('lobby-controls'),
        actionControls: document.getElementById('action-controls'),
        startBtn: document.getElementById('start-btn'),
        foldBtn: document.getElementById('fold-btn'),
        checkBtn: document.getElementById('check-btn'),
        callBtn: document.getElementById('call-btn'),
        betBtn: document.getElementById('bet-btn'),
        raiseBtn: document.getElementById('raise-btn'),
        allinBtn: document.getElementById('allin-btn'),
        amountInput: document.getElementById('amount-input'),
        saveBtn: document.getElementById('save-btn'),
        leaveBtn: document.getElementById('leave-btn'),
        logLines: document.getElementById('log-lines'),
        chatLines: document.getElementById('chat-lines'),
        chatPanel: document.getElementById('chat-panel'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
    };

    function showScreen(name) {
        els.modeScreen.classList.toggle('hidden', name !== 'mode');
        els.joinScreen.classList.toggle('hidden', name !== 'join');
        els.quickmatchScreen.classList.toggle('hidden', name !== 'quickmatch');
        els.tableScreen.classList.toggle('hidden', name !== 'table');
    }

    function logLine(container, text, isError) {
        const div = document.createElement('div');
        div.textContent = text;
        if (isError) div.style.color = 'var(--danger)';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        while (container.children.length > 100) container.removeChild(container.firstChild);
    }

    // ---------------------------------------------------------------- shared table render ----
    let activeController = null;

    function render() {
        if (!activeController) return;
        const { state, myId } = activeController.getView();
        if (!state) return;

        els.handInfo.textContent = `Hand #${state.handNumber} — ${state.phase.toUpperCase()} — SB/BB ${state.smallBlind}/${state.bigBlind}`;

        els.communityCards.innerHTML = '';
        if (state.communityCards.length === 0) {
            els.communityCards.appendChild(renderHiddenCards(0));
        } else {
            state.communityCards.forEach((c) => els.communityCards.appendChild(renderCardSpan(c)));
        }

        let potText = `Pot: ${state.pot}`;
        if (state.sidePots.length > 1) {
            potText += '  |  ' + state.sidePots.map((p, i) => `Side pot ${i + 1}: ${p.amount}`).join('  ');
        }
        els.potDisplay.textContent = potText;

        els.players.innerHTML = '';
        for (const p of state.players) {
            const card = document.createElement('div');
            card.className = 'player-card';
            if (p.id === state.actionOn) card.classList.add('active-turn');
            if (p.folded) card.classList.add('folded');

            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = `${p.name}${p.isDealer ? ' (D)' : ''}${p.id === myId ? ' (you)' : ''}`;
            card.appendChild(name);

            const cardsRow = document.createElement('div');
            cardsRow.className = 'cards';
            if (p.cards && p.cards.length > 0) {
                p.cards.forEach((c) => cardsRow.appendChild(renderCardSpan(c)));
            } else if (!p.folded) {
                cardsRow.appendChild(renderHiddenCards(2));
            }
            card.appendChild(cardsRow);

            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = `chips: ${p.chips}  bet: ${p.streetBet}`;
            card.appendChild(meta);

            const status = document.createElement('div');
            status.className = 'status';
            status.textContent = [
                p.folded ? 'FOLDED' : '',
                p.allIn ? 'ALL-IN' : '',
                p.sittingOut ? 'SITTING OUT' : '',
                !p.connected ? 'DISCONNECTED' : '',
                p.handName ?? '',
            ].filter(Boolean).join(' · ');
            card.appendChild(status);

            els.players.appendChild(card);
        }

        for (const line of state.log.slice(-6)) {
            if (![...els.logLines.children].some((el) => el.textContent === line)) {
                logLine(els.logLines, line);
            }
        }

        const me = state.players.find((p) => p.id === myId);
        const myTurn = me && state.actionOn === myId;
        const idle = state.phase === 'waiting' || state.phase === 'handover';

        els.lobbyControls.classList.toggle('hidden', !(idle && activeController.canStart()));
        els.actionControls.classList.toggle('hidden', !myTurn);
        els.chatPanel.classList.toggle('hidden', !activeController.supportsChat);
        els.voiceControls.classList.toggle('hidden', !activeController.supportsVoice);
        els.roomCodeBanner.classList.toggle('hidden', !activeController.roomCode);
        if (activeController.roomCode) {
            els.roomCodeBanner.innerHTML = activeController.isHost
                ? `Hosting — share this code: <strong>${activeController.roomCode}</strong>`
                : `Connected to table <strong>${activeController.roomCode}</strong>`;
        }

        if (myTurn && me) {
            const toCall = state.currentBet - me.streetBet;
            els.checkBtn.disabled = toCall > 0;
            els.callBtn.disabled = toCall <= 0;
            els.callBtn.textContent = toCall > 0 ? `Call (${Math.min(toCall, me.chips)})` : 'Call';
            els.betBtn.disabled = state.currentBet > 0;
            els.raiseBtn.disabled = state.currentBet === 0;
            els.raiseBtn.textContent = state.currentBet > 0 ? `Raise (min ${state.currentBet + state.minRaise})` : 'Raise';
        }
    }

    // ---------------------------------------------------------------- Local controller (pass & play / vs AI) ----
    class LocalController {
        constructor(game, opts) {
            this.game = game;
            this.supportsChat = false;
            this.supportsVoice = false;
            this.roomCode = null;
            this.fixedViewerId = opts.fixedViewerId ?? null; // set for "vs AI": always this human's perspective
            this.revealedFor = null; // seat currently allowed to see their own cards (pass & play)
            this.aiTimer = null;
        }

        canStart() {
            return this.game.canStartHand();
        }

        currentViewerId() {
            if (this.fixedViewerId) return this.fixedViewerId;
            const current = this.game.getCurrentPlayer();
            return current ? current.id : this.revealedFor;
        }

        getView() {
            const viewerId = this.currentViewerId();
            return { state: this.game.getPublicState(viewerId ?? undefined), myId: viewerId };
        }

        start() {
            try {
                if (this.game.canStartHand()) this.game.startHand();
            } catch (err) {
                logLine(els.logLines, `Error: ${err.message}`, true);
            }
            this.afterStateChange();
        }

        submitAction(action, amount) {
            const current = this.game.getCurrentPlayer();
            if (!current) return;
            try {
                this.game.applyAction(current.id, action, amount);
            } catch (err) {
                logLine(els.logLines, `Error: ${err.message}`, true);
                return;
            }
            this.afterStateChange();
        }

        /** Runs any pending AI turns, then decides whether a human reveal gate is needed, then re-renders. */
        afterStateChange() {
            clearTimeout(this.aiTimer);
            const current = this.game.getCurrentPlayer();

            if (current && current.isAI) {
                this.revealedFor = null;
                render(); // show the table mid-thought (opponent view) briefly
                this.aiTimer = setTimeout(() => this.runAiTurn(current.id), 550);
                return;
            }

            if (!this.fixedViewerId && current && current.id !== this.revealedFor) {
                this.revealedFor = null; // needs a fresh reveal click from the next human
                this.showRevealGate(current.name);
                return;
            }

            if (current) this.revealedFor = current.id;

            if (this.game.isHandOver()) {
                maybeAutoStartNextHand(this);
            }
            render();
        }

        runAiTurn(playerId) {
            const player = this.game.players.find((p) => p.id === playerId);
            if (!player || this.game.getCurrentPlayer()?.id !== playerId) return;
            const opponentsInHand = this.game.players.filter((p) => !p.folded && p.id !== playerId).length;
            const decision = decideForPlayer(
                player,
                this.game.communityCards,
                this.game.currentBet,
                this.game.minRaise,
                this.game.bigBlind,
                this.game.players.reduce((sum, p) => sum + p.committed, 0),
                opponentsInHand,
            );
            this.game.applyAction(playerId, decision.action, decision.amount);
            this.afterStateChange();
        }

        showRevealGate(name) {
            els.revealText.textContent = `Pass the device to ${name}.`;
            els.revealOverlay.classList.remove('hidden');
        }

        confirmReveal() {
            const current = this.game.getCurrentPlayer();
            this.revealedFor = current ? current.id : null;
            els.revealOverlay.classList.add('hidden');
            render();
        }

        exportHex() {
            return exportGameToHex(this.game);
        }

        leave() {
            clearTimeout(this.aiTimer);
        }
    }

    function maybeAutoStartNextHand(controller) {
        setTimeout(() => {
            if (activeController !== controller) return;
            if (controller.game.isHandOver() && controller.game.canStartHand()) {
                controller.game.startHand();
                controller.afterStateChange();
            }
        }, 3000);
    }

    // ---------------------------------------------------------------- Network controller (WebSocket server) ----
    class NetworkController {
        constructor(serverUrl, name) {
            this.supportsChat = true;
            this.supportsVoice = false;
            this.roomCode = null;
            this.myId = null;
            this.lastState = null;
            this.socket = new WebSocket(serverUrl);
            this.socket.addEventListener('open', () => {
                els.joinStatus.textContent = 'Connected. Joining table...';
                this.send({ type: 'join', name });
            });
            this.socket.addEventListener('message', (event) => this.handleMessage(JSON.parse(event.data)));
            this.socket.addEventListener('close', () => {
                els.joinStatus.textContent = 'Disconnected from server.';
                showScreen('mode');
            });
            this.socket.addEventListener('error', () => {
                els.joinStatus.textContent = 'Connection error — is the server running?';
            });
        }

        send(message) {
            if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
        }

        handleMessage(message) {
            switch (message.type) {
                case 'welcome':
                    this.myId = message.id;
                    break;
                case 'state':
                    this.lastState = message.state;
                    showScreen('table');
                    render();
                    break;
                case 'error':
                    logLine(els.logLines, `Error: ${message.message}`, true);
                    break;
                case 'info':
                    logLine(els.logLines, `* ${message.message}`);
                    break;
                case 'chat':
                    logLine(els.chatLines, `<${message.from}> ${message.text}`);
                    break;
            }
        }

        getView() {
            return { state: this.lastState, myId: this.myId };
        }

        canStart() {
            return true; // server enforces the actual rule; button just sends the request
        }

        start() {
            this.send({ type: 'start' });
        }

        submitAction(action, amount) {
            this.send({ type: 'action', action, amount });
        }

        sendChat(text) {
            this.send({ type: 'chat', text });
        }

        exportHex() {
            if (!this.lastState) return null;
            const state = this.lastState;
            const save = {
                version: 1,
                savedAt: new Date().toISOString(),
                smallBlind: state.smallBlind,
                bigBlind: state.bigBlind,
                dealerIndex: Math.max(0, state.players.findIndex((p) => p.isDealer)),
                handNumber: state.handNumber,
                players: state.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips })),
            };
            return exportSaveToHex(save);
        }

        leave() {
            this.socket.close();
        }
    }

    // ---------------------------------------------------------------- P2P controller (serverless WebRTC) ----
    // Host runs the real Game and is authoritative; guests just render whatever `state` the host
    // sends them and forward their own intent (join/action/start/chat) back over the same room.
    // Nobody but the host ever looks at "action"/"join"/"start" messages, so it's safe for every
    // peer to broadcast them — that also means voice/chat naturally reach everyone directly
    // (full-mesh WebRTC), not just the host.
    class P2PController {
        constructor(room, { isHost, name, game, startingChips }) {
            this.room = room;
            this.isHost = isHost;
            this.supportsChat = true;
            this.supportsVoice = true;
            this.roomCode = null;
            this.myName = name;
            this.game = isHost ? game : null;
            this.startingChips = startingChips;
            this.lastState = null; // guest-only
            this.micStream = null;
            this.remoteAudioEls = new Map(); // peerId -> <audio>

            this.joinAction = room.makeAction('join');
            this.actionAction = room.makeAction('action');
            this.startAction = room.makeAction('start');
            this.chatAction = room.makeAction('chat');
            this.stateAction = room.makeAction('state');
            this.errorAction = room.makeAction('error');

            room.onPeerStream = (stream, peerId) => this.attachRemoteAudio(stream, peerId);

            if (isHost) {
                this.joinAction.onMessage = (data, { peerId }) => {
                    const player = new Player(peerId, (data && data.name) || 'Player', this.startingChips);
                    if (this.game.phase !== 'waiting' && this.game.phase !== 'handover') player.sittingOut = true;
                    this.game.addPlayer(player);
                    logLine(els.logLines, `${player.name} joined.`);
                    this.broadcastState();
                };
                this.actionAction.onMessage = (data, { peerId }) => {
                    try {
                        this.game.applyAction(peerId, data.action, data.amount);
                    } catch (err) {
                        this.errorAction.send({ message: err.message }, { target: peerId });
                        return;
                    }
                    this.broadcastState();
                };
                this.startAction.onMessage = () => {
                    if (this.game.canStartHand() && (this.game.isHandOver() || this.game.phase === 'waiting')) {
                        this.game.startHand();
                        this.broadcastState();
                    }
                };
                room.onPeerLeave = (peerId) => {
                    this.game.removePlayer(peerId);
                    this.removeRemoteAudio(peerId);
                    this.broadcastState();
                };
            } else {
                room.onPeerJoin = (peerId) => {
                    this.joinAction.send({ name: this.myName }, { target: peerId });
                };
                this.stateAction.onMessage = (state) => {
                    this.lastState = state;
                    showScreen('table');
                    render();
                };
                this.errorAction.onMessage = (data) => {
                    logLine(els.logLines, `Error: ${data.message}`, true);
                };
                room.onPeerLeave = (peerId) => this.removeRemoteAudio(peerId);
            }

            this.chatAction.onMessage = (data, { peerId }) => {
                logLine(els.chatLines, `<${(data && data.name) || peerId.slice(0, 6)}> ${data.text}`);
            };
        }

        broadcastState() {
            for (const peerId of Object.keys(this.room.getPeers())) {
                this.stateAction.send(this.game.getPublicState(peerId), { target: peerId });
            }
            if (this.game.isHandOver()) this.maybeAutoStartNextHand();
            render();
        }

        maybeAutoStartNextHand() {
            clearTimeout(this._autoStartTimer);
            this._autoStartTimer = setTimeout(() => {
                if (activeController !== this) return;
                if (this.game.isHandOver() && this.game.canStartHand()) {
                    this.game.startHand();
                    this.broadcastState();
                }
            }, 4000);
        }

        getView() {
            if (this.isHost) return { state: this.game.getPublicState(selfId), myId: selfId };
            return { state: this.lastState, myId: selfId };
        }

        canStart() {
            return this.isHost ? this.game.canStartHand() : true;
        }

        start() {
            if (this.isHost) {
                try {
                    if (this.game.canStartHand()) this.game.startHand();
                } catch (err) {
                    logLine(els.logLines, `Error: ${err.message}`, true);
                }
                this.broadcastState();
            } else {
                this.startAction.send({});
            }
        }

        submitAction(action, amount) {
            if (this.isHost) {
                const current = this.game.getCurrentPlayer();
                if (!current) return;
                try {
                    this.game.applyAction(current.id, action, amount);
                } catch (err) {
                    logLine(els.logLines, `Error: ${err.message}`, true);
                    return;
                }
                this.broadcastState();
            } else {
                this.actionAction.send({ action, amount });
            }
        }

        sendChat(text) {
            logLine(els.chatLines, `<${this.myName}> ${text}`);
            this.chatAction.send({ text, name: this.myName });
        }

        exportHex() {
            if (this.isHost) return exportGameToHex(this.game);
            if (!this.lastState) return null;
            const state = this.lastState;
            const save = {
                version: 1,
                savedAt: new Date().toISOString(),
                smallBlind: state.smallBlind,
                bigBlind: state.bigBlind,
                dealerIndex: Math.max(0, state.players.findIndex((p) => p.isDealer)),
                handNumber: state.handNumber,
                players: state.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips })),
            };
            return exportSaveToHex(save);
        }

        attachRemoteAudio(stream, peerId) {
            this.removeRemoteAudio(peerId);
            const audio = document.createElement('audio');
            audio.autoplay = true;
            audio.srcObject = stream;
            els.remoteAudio.appendChild(audio);
            this.remoteAudioEls.set(peerId, audio);
        }

        removeRemoteAudio(peerId) {
            const audio = this.remoteAudioEls.get(peerId);
            if (audio) {
                audio.remove();
                this.remoteAudioEls.delete(peerId);
            }
        }

        async toggleVoice() {
            if (!this.micStream) {
                try {
                    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                } catch (err) {
                    els.voiceStatus.textContent = `Mic unavailable: ${err.message}`;
                    return;
                }
                this.room.addStream(this.micStream);
                els.voiceToggleBtn.textContent = '🎤 Mute';
                els.voiceStatus.textContent = 'Voice on';
                els.voiceControls.classList.add('active');
                return;
            }
            const track = this.micStream.getAudioTracks()[0];
            track.enabled = !track.enabled;
            els.voiceToggleBtn.textContent = track.enabled ? '🎤 Mute' : '🎤 Unmute';
            els.voiceStatus.textContent = track.enabled ? 'Voice on' : 'Muted';
        }

        leave() {
            clearTimeout(this._autoStartTimer);
            if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
            for (const audio of this.remoteAudioEls.values()) audio.remove();
            this.remoteAudioEls.clear();
            this.room.leave();
        }
    }

    function createRoom(roomId) {
        return joinRoom({ appId: P2P_APP_ID }, roomId);
    }

    /**
     * Joins the public lobby once and listens briefly for open tables. If one turns up, the lobby
     * connection is left behind and `{ found }` resolves. If not, the *same* connection is kept
     * open and handed back as `keepAnnouncing` instead of being torn down — leaving a room and
     * immediately rejoining it under the same identity does not reliably rediscover peers on this
     * relay setup, so becoming the announcer reuses the connection rather than reconnecting.
     */
    function scanLobby() {
        return new Promise((resolve) => {
            const lobby = createRoom(LOBBY_ROOM_ID);
            const announce = lobby.makeAction('announce');
            const tables = new Map();
            announce.onMessage = (data, { peerId }) => tables.set(peerId, { ...data, seenAt: Date.now() });
            lobby.onPeerLeave = (peerId) => tables.delete(peerId);

            setTimeout(() => {
                const open = [...tables.values()].filter(
                    (t) => Date.now() - t.seenAt < ANNOUNCE_STALE_MS && t.players < t.maxSeats,
                );
                const found = open.length > 0 ? open[Math.floor(Math.random() * open.length)] : null;

                if (found) {
                    lobby.leave();
                    resolve({ found });
                } else {
                    resolve({ found: null, keepAnnouncing: (tableId, getInfo) => startAnnouncing(lobby, announce, tableId, getInfo) });
                }
            }, LOBBY_SCAN_MS);
        });
    }

    /** Keeps a table announced on an already-open lobby connection while it has open seats. Returns a stop() fn. */
    function startAnnouncing(lobby, announce, tableId, getInfo) {
        const announceTo = (target) => {
            const info = getInfo();
            if (info.players < info.maxSeats) announce.send({ tableId, ...info }, target ? { target } : undefined);
        };
        // A periodic broadcast alone can miss a scanner whose WebRTC handshake finishes between
        // ticks (their whole scan window is only a few seconds) — so also announce directly, the
        // instant a peer's connection to the lobby actually completes.
        lobby.onPeerJoin = (peerId) => announceTo(peerId);
        announceTo();
        const interval = setInterval(() => announceTo(), ANNOUNCE_INTERVAL_MS);
        return () => {
            clearInterval(interval);
            lobby.leave();
        };
    }

    function startP2PController(controller, roomCode) {
        controller.roomCode = roomCode;
        activeController = controller;
        if (controller.isHost) {
            showScreen('table');
            controller.broadcastState();
        }
        // Guests transition to the table screen once the host's first state arrives (see onMessage above).
    }

    function hostTable({ name, chips, sb, bb, maxSeats, keepAnnouncing }) {
        const roomCode = randomRoomCode();
        const room = createRoom(roomCode);
        const game = new Game(sb, bb);
        game.addPlayer(new Player(selfId, name, chips));
        const controller = new P2PController(room, { isHost: true, name, game, startingChips: chips });
        if (keepAnnouncing) {
            const stopAnnouncing = keepAnnouncing(roomCode, () => ({
                players: game.players.length,
                maxSeats,
                name: `${name}'s table`,
                sb,
                bb,
            }));
            const originalLeave = controller.leave.bind(controller);
            controller.leave = () => {
                stopAnnouncing();
                originalLeave();
            };
        }
        startP2PController(controller, roomCode);
    }

    function joinTable(code, name) {
        const room = createRoom(code);
        const controller = new P2PController(room, { isHost: false, name });
        startP2PController(controller, code);
        els.joinStatus.textContent = 'Connecting…';
    }

    // ---------------------------------------------------------------- mode / join screen wiring ----
    let pendingMode = null;

    function renderJoinFields(mode) {
        els.joinFields.innerHTML = '';
        els.joinStatus.textContent = '';

        const addField = (id, labelText, type, value) => {
            const label = document.createElement('label');
            label.textContent = labelText;
            label.htmlFor = id;
            const input = document.createElement('input');
            input.id = id;
            input.type = type;
            if (value !== undefined) input.value = value;
            els.joinFields.appendChild(label);
            els.joinFields.appendChild(input);
            return input;
        };

        if (mode === 'local') {
            els.joinTitle.textContent = 'Local Pass & Play';
            addField('field-seats', 'Number of players (2-8)', 'number', 3);
            addField('field-chips', 'Starting chips', 'number', 1000);
            addField('field-sb', 'Small blind', 'number', 5);
            addField('field-bb', 'Big blind', 'number', 10);
        } else if (mode === 'ai') {
            els.joinTitle.textContent = 'Play vs AI';
            addField('field-name', 'Your name', 'text', 'Player');
            addField('field-bots', 'Number of AI opponents (1-7)', 'number', 2);
            addField('field-chips', 'Starting chips', 'number', 1000);
            addField('field-sb', 'Small blind', 'number', 5);
            addField('field-bb', 'Big blind', 'number', 10);
        } else if (mode === 'online') {
            els.joinTitle.textContent = 'Online (Server)';
            const guessedUrl = `${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}/ws`;
            addField('field-server', 'Server WebSocket URL', 'text', guessedUrl);
            addField('field-name', 'Your name', 'text', 'Player');
        } else if (mode === 'p2p') {
            els.joinTitle.textContent = 'Online (P2P)';

            const label = document.createElement('label');
            label.textContent = 'How do you want to connect?';
            const select = document.createElement('select');
            select.id = 'field-p2p-mode';
            [
                ['host', 'Host a new table (get a code to share)'],
                ['join', 'Join by code'],
                ['quick', 'Quick match (find a random open table)'],
            ].forEach(([value, text]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                select.appendChild(opt);
            });
            els.joinFields.appendChild(label);
            els.joinFields.appendChild(select);

            addField('field-name', 'Your name', 'text', 'Player');
            const codeField = addField('field-code', 'Room code', 'text', '');

            const hostOnlyFields = [
                addField('field-chips', 'Starting chips', 'number', 1000),
                addField('field-sb', 'Small blind', 'number', 5),
                addField('field-bb', 'Big blind', 'number', 10),
                addField('field-seats', 'Max seats (2-8)', 'number', 6),
            ];

            const setFieldVisible = (input, visible) => {
                input.style.display = input.previousElementSibling.style.display = visible ? '' : 'none';
            };
            const updateVisibility = () => {
                const sub = select.value;
                setFieldVisible(codeField, sub === 'join');
                hostOnlyFields.forEach((f) => setFieldVisible(f, sub !== 'join'));
            };
            select.addEventListener('change', updateVisibility);
            updateVisibility();
        }
    }

    function startFromJoinScreen() {
        if (pendingMode === 'local') {
            const seats = Math.max(2, Math.min(8, Number(document.getElementById('field-seats').value) || 2));
            const chips = Number(document.getElementById('field-chips').value) || 1000;
            const sb = Number(document.getElementById('field-sb').value) || 5;
            const bb = Number(document.getElementById('field-bb').value) || 10;
            const game = new Game(sb, bb);
            for (let i = 1; i <= seats; i++) game.addPlayer(new Player(`p${i}`, `Player ${i}`, chips));
            startLocalController(new LocalController(game, {}));
        } else if (pendingMode === 'ai') {
            const name = document.getElementById('field-name').value.trim() || 'Player';
            const bots = Math.max(1, Math.min(7, Number(document.getElementById('field-bots').value) || 1));
            const chips = Number(document.getElementById('field-chips').value) || 1000;
            const sb = Number(document.getElementById('field-sb').value) || 5;
            const bb = Number(document.getElementById('field-bb').value) || 10;
            const game = new Game(sb, bb);
            game.addPlayer(new Player('you', name, chips));
            for (let i = 1; i <= bots; i++) {
                const bot = new Player(`bot${i}`, `Bot ${i}`, chips);
                bot.isAI = true;
                game.addPlayer(bot);
            }
            startLocalController(new LocalController(game, { fixedViewerId: 'you' }));
        } else if (pendingMode === 'online') {
            const url = document.getElementById('field-server').value.trim();
            const name = document.getElementById('field-name').value.trim() || 'Player';
            if (!url) {
                els.joinStatus.textContent = 'Enter a server URL.';
                return;
            }
            activeController = new NetworkController(url, name);
        } else if (pendingMode === 'p2p') {
            const sub = document.getElementById('field-p2p-mode').value;
            const name = document.getElementById('field-name').value.trim() || 'Player';
            const chips = Number(document.getElementById('field-chips').value) || 1000;
            const sb = Number(document.getElementById('field-sb').value) || 5;
            const bb = Number(document.getElementById('field-bb').value) || 10;
            const maxSeats = Math.max(2, Math.min(8, Number(document.getElementById('field-seats').value) || 6));

            if (sub === 'host') {
                hostTable({ name, chips, sb, bb, maxSeats });
            } else if (sub === 'join') {
                const code = document.getElementById('field-code').value.trim().toUpperCase();
                if (!code) {
                    els.joinStatus.textContent = 'Enter a room code.';
                    return;
                }
                joinTable(code, name);
            } else if (sub === 'quick') {
                showScreen('quickmatch');
                els.quickmatchStatus.textContent = 'Looking for an open table…';
                scanLobby().then(({ found, keepAnnouncing }) => {
                    if (els.quickmatchScreen.classList.contains('hidden')) return; // user cancelled
                    if (found) {
                        els.quickmatchStatus.textContent = `Found a table — joining ${found.tableId}…`;
                        joinTable(found.tableId, name);
                    } else {
                        els.quickmatchStatus.textContent = 'No open tables — starting one and waiting for others…';
                        hostTable({ name, chips, sb, bb, maxSeats, keepAnnouncing });
                    }
                });
            }
        }
    }

    function startLocalController(controller) {
        activeController = controller;
        showScreen('table');
        controller.afterStateChange();
    }

    els.modeLocal.addEventListener('click', () => {
        pendingMode = 'local';
        renderJoinFields('local');
        showScreen('join');
    });
    els.modeAi.addEventListener('click', () => {
        pendingMode = 'ai';
        renderJoinFields('ai');
        showScreen('join');
    });
    els.modeOnline.addEventListener('click', () => {
        pendingMode = 'online';
        renderJoinFields('online');
        showScreen('join');
    });
    els.modeP2p.addEventListener('click', () => {
        pendingMode = 'p2p';
        renderJoinFields('p2p');
        showScreen('join');
    });
    els.backBtn.addEventListener('click', () => showScreen('mode'));
    els.joinBtn.addEventListener('click', startFromJoinScreen);
    els.quickmatchCancelBtn.addEventListener('click', () => showScreen('mode'));

    // ---------------------------------------------------------------- load save (from mode screen) ----
    els.loadHexFile.addEventListener('change', () => {
        const file = els.loadHexFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            els.loadHexInput.value = String(reader.result ?? '');
        };
        reader.readAsText(file);
    });

    els.loadHexBtn.addEventListener('click', () => {
        const text = els.loadHexInput.value.trim();
        if (!text) {
            els.loadStatus.textContent = 'Paste a hex save or choose a file first.';
            return;
        }
        try {
            const game = importGameFromHex(text);
            const humans = game.players.filter((p) => !p.isAI);
            const controller =
                humans.length === 1 && game.players.length > 1
                    ? new LocalController(game, { fixedViewerId: humans[0].id })
                    : new LocalController(game, {});
            els.loadStatus.textContent = '';
            startLocalController(controller);
        } catch (err) {
            els.loadStatus.textContent = `Could not load save: ${err.message}`;
        }
    });

    // ---------------------------------------------------------------- reveal overlay / action buttons ----
    els.revealBtn.addEventListener('click', () => {
        if (activeController instanceof LocalController) activeController.confirmReveal();
    });

    els.startBtn.addEventListener('click', () => activeController?.start());
    els.foldBtn.addEventListener('click', () => activeController?.submitAction('fold'));
    els.checkBtn.addEventListener('click', () => activeController?.submitAction('check'));
    els.callBtn.addEventListener('click', () => activeController?.submitAction('call'));
    els.allinBtn.addEventListener('click', () => activeController?.submitAction('allin'));
    els.betBtn.addEventListener('click', () => {
        const amount = Number(els.amountInput.value);
        if (!Number.isFinite(amount) || amount <= 0) return;
        activeController?.submitAction('bet', amount);
    });
    els.raiseBtn.addEventListener('click', () => {
        const amount = Number(els.amountInput.value);
        if (!Number.isFinite(amount) || amount <= 0) return;
        activeController?.submitAction('raise', amount);
    });

    els.voiceToggleBtn.addEventListener('click', () => activeController?.toggleVoice?.());

    els.leaveBtn.addEventListener('click', () => {
        activeController?.leave?.();
        activeController = null;
        els.revealOverlay.classList.add('hidden');
        els.voiceControls.classList.remove('active');
        els.voiceToggleBtn.textContent = '🎤 Enable Voice Chat';
        els.voiceStatus.textContent = '';
        els.remoteAudio.innerHTML = '';
        showScreen('mode');
    });

    els.saveBtn.addEventListener('click', () => {
        const content = activeController?.exportHex();
        if (!content) return;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `poker-save-${Date.now()}.hex.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });

    els.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = els.chatInput.value.trim();
        if (!text || !activeController?.sendChat) return;
        activeController.sendChat(text);
        els.chatInput.value = '';
    });

    showScreen('mode');
})();
