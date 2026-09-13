"""Online play over plain TCP, one JSON object per line.

The server owns the only copy of the game. Clients never see another player's
hole cards: every snapshot is built for one seat, and cards are revealed only at
a showdown. Empty seats can be filled with bots so a hand can start with a
single human at the table.

    server -> client   welcome / state / events / turn / chat / info / error / bye
    client -> server   join / action / chat / sitout / leave
"""

from __future__ import annotations

import json
import queue
import random
import socket
import sys
import threading
import time

from . import ai, ui
from .engine import IllegalAction, Player, Table

PROTOCOL = 1
DEFAULT_PORT = 7777
ENCODING = "utf-8"


def send(sock, lock, message) -> bool:
    line = (json.dumps(message) + "\n").encode(ENCODING)
    try:
        with lock:
            sock.sendall(line)
        return True
    except OSError:
        return False


def read_lines(sock):
    """Yield decoded JSON messages from a socket until it closes."""
    buffer = b""
    while True:
        try:
            chunk = sock.recv(4096)
        except OSError:
            return
        if not chunk:
            return
        buffer += chunk
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            raw = raw.strip()
            if not raw:
                continue
            try:
                yield json.loads(raw.decode(ENCODING))
            except (ValueError, UnicodeDecodeError):
                continue


# =============================================================== server side

class Connection:
    def __init__(self, sock, address):
        self.sock = sock
        self.address = address
        self.lock = threading.Lock()
        self.name = None
        self.seat = None
        self.alive = True

    def send(self, message):
        if not send(self.sock, self.lock, message):
            self.alive = False

    def close(self):
        self.alive = False
        try:
            self.sock.close()
        except OSError:
            pass


class GameServer:
    def __init__(self, port=DEFAULT_PORT, seats=6, bots=2, buyin=2000,
                 small_blind=10, big_blind=20, turn_seconds=60, host=""):
        self.port = port
        self.host = host
        self.buyin = buyin
        self.turn_seconds = turn_seconds
        self.rng = random.Random()
        self.lock = threading.RLock()
        self.connections = {}          # seat -> Connection
        self.inbox = queue.Queue()     # (seat, message) from any client
        self.running = True
        self.sent_events = 0

        seats = max(2, min(seats, 9))
        bots = max(0, min(bots, seats - 1))
        players = [Player("-- empty --", 0) for _ in range(seats)]
        for i, (name, style) in enumerate(ai.bot_names(bots, self.rng)):
            p = players[seats - 1 - i]
            p.name = name
            p.chips = buyin
            p.is_bot = True
            p.style = style
            p.sitting_out = False
        self.table = Table(players, small_blind=small_blind, big_blind=big_blind)

    # ------------------------------------------------------------- plumbing

    def log(self, text):
        print("  " + text, flush=True)

    def broadcast(self, message):
        for conn in list(self.connections.values()):
            conn.send(message)

    def push_state(self, reveal=False, message=""):
        with self.lock:
            for seat, conn in list(self.connections.items()):
                conn.send({
                    "t": "state",
                    "state": self.table.snapshot(viewer=seat, reveal=reveal),
                    "message": message,
                })
            new = self.table.events[self.sent_events:]
            if new:
                self.broadcast({"t": "events", "lines": new})
                for line in new:
                    self.log(line)
                self.sent_events = len(self.table.events)

    def free_seat(self):
        for p in self.table.players:
            if not p.is_bot and p.seat not in self.connections and p.chips == 0:
                return p.seat
        return None

    # ------------------------------------------------------------ connections

    def serve(self):
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((self.host, self.port))
        listener.listen(16)
        listener.settimeout(1.0)

        print(ui.banner())
        self.log("table open on port %d - %d seats, %d bots, blinds %d/%d"
                 % (self.port, len(self.table.players),
                    sum(1 for p in self.table.players if p.is_bot),
                    self.table.small_blind, self.table.big_blind))
        for address in local_addresses():
            self.log("players join with:  python3 poker.py --join %s:%d" % (address, self.port))
        self.log("ctrl-c to close the table")

        threading.Thread(target=self.game_loop, daemon=True).start()
        try:
            while self.running:
                try:
                    sock, address = listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                threading.Thread(target=self.handle_client, args=(sock, address),
                                 daemon=True).start()
        except KeyboardInterrupt:
            self.log("closing the table")
        finally:
            self.running = False
            self.broadcast({"t": "bye", "text": "the host closed the table"})
            listener.close()

    def handle_client(self, sock, address):
        conn = Connection(sock, address)
        stream = read_lines(sock)
        try:
            hello = next(stream, None)
            if not hello or hello.get("t") != "join":
                conn.send({"t": "error", "text": "expected a join message"})
                conn.close()
                return
            name = str(hello.get("name") or "guest")[:14].strip() or "guest"

            with self.lock:
                seat = self.free_seat()
                if seat is None:
                    conn.send({"t": "bye", "text": "the table is full"})
                    conn.close()
                    return
                taken = {c.name for c in self.connections.values()}
                base, n = name, 2
                while name in taken:
                    name = "%s%d" % (base[:12], n)
                    n += 1
                player = self.table.players[seat]
                player.name = name
                player.chips = self.buyin
                player.is_bot = False
                player.connected = True
                player.sitting_out = self.table.hand_active  # join in on the next hand
                conn.name, conn.seat = name, seat
                self.connections[seat] = conn

            conn.send({"t": "welcome", "seat": seat, "name": name,
                       "protocol": PROTOCOL, "buyin": self.buyin})
            self.log("%s joined from %s in seat %d" % (name, address[0], seat))
            self.broadcast({"t": "info", "text": "%s sits down with %d chips" % (name, self.buyin)})
            self.push_state()

            for message in stream:
                if not self.running:
                    break
                kind = message.get("t")
                if kind == "chat":
                    text = str(message.get("text", ""))[:200]
                    self.broadcast({"t": "chat", "from": name, "text": text})
                    self.log("%s: %s" % (name, text))
                elif kind == "leave":
                    break
                else:
                    self.inbox.put((seat, message))
        finally:
            self.drop(conn)

    def drop(self, conn):
        if conn.seat is None:
            conn.close()
            return
        with self.lock:
            self.connections.pop(conn.seat, None)
            player = self.table.players[conn.seat]
            player.connected = False
            if self.table.hand_active and player.contender:
                self.inbox.put((conn.seat, {"t": "action", "action": "fold"}))
            else:
                self._clear_seat(player)
        conn.close()
        self.log("%s left" % conn.name)
        self.broadcast({"t": "info", "text": "%s left the table" % conn.name})
        self.push_state()

    def _clear_seat(self, player):
        player.name = "-- empty --"
        player.chips = 0
        player.sitting_out = True
        player.connected = True
        player.in_hand = False

    def humans(self):
        return [p for p in self.table.players
                if not p.is_bot and p.seat in self.connections and p.chips > 0]

    # -------------------------------------------------------------- game loop

    def wait_for_action(self, seat):
        """Block until this seat acts, or the clock runs out."""
        conn = self.connections.get(seat)
        moves = self.table.legal_actions(seat)
        if conn:
            conn.send({"t": "turn", "moves": _jsonable(moves), "seconds": self.turn_seconds})
        deadline = time.time() + self.turn_seconds
        while time.time() < deadline:
            if not self.running:
                return ("fold", 0)
            try:
                who, message = self.inbox.get(timeout=0.5)
            except queue.Empty:
                if seat not in self.connections:
                    return ("fold", 0)
                continue
            if who != seat or message.get("t") != "action":
                other = self.connections.get(who)
                if other:
                    other.send({"t": "error", "text": "not your turn"})
                continue
            action = str(message.get("action", "")).lower()
            try:
                amount = int(message.get("amount") or 0)
            except (TypeError, ValueError):
                amount = 0
            return (action, amount)
        conn = self.connections.get(seat)
        if conn:
            conn.send({"t": "info", "text": "time up - acting for you"})
        return ("check", 0) if "check" in moves else ("fold", 0)

    def run_hand(self):
        self.table.start_hand()
        self.sent_events = 0
        self.push_state()
        while self.table.hand_active and self.running:
            seat = self.table.actor
            player = self.table.players[seat]
            if player.is_bot:
                self.push_state(message="%s is thinking..." % player.name)
                time.sleep(0.8)
                action, amount = ai.decide(self.table, seat, self.rng)
            else:
                action, amount = self.wait_for_action(seat)
            try:
                self.table.act(seat, action, amount)
            except IllegalAction as exc:
                conn = self.connections.get(seat)
                if conn:
                    conn.send({"t": "error", "text": str(exc)})
                if player.is_bot or not conn:
                    moves = self.table.legal_actions(seat)
                    self.table.act(seat, "check" if "check" in moves else "fold")
                continue
            self.push_state()

        self.push_state(reveal=len(self.table.showdown) > 1)
        self.broadcast({"t": "results", "results": self.table.results})

        with self.lock:
            for p in self.table.players:
                if p.is_bot and p.chips <= 0:
                    p.chips = self.buyin
                    p.sitting_out = False
                elif not p.is_bot and p.seat not in self.connections:
                    self._clear_seat(p)
                elif not p.is_bot and p.chips <= 0 and p.seat in self.connections:
                    p.chips = self.buyin      # friendly rebuy for online tables
                    p.sitting_out = False
                    self.connections[p.seat].send(
                        {"t": "info", "text": "you busted - rebuying for %d" % self.buyin})
                elif p.chips > 0:
                    p.sitting_out = False

    def game_loop(self):
        waiting = False
        while self.running:
            if len(self.humans()) < 1 or len(self.table.seated()) < 2:
                if not waiting:
                    self.log("waiting for players...")
                    waiting = True
                time.sleep(1.0)
                continue
            waiting = False
            self.broadcast({"t": "info", "text": "next hand in 3..."})
            time.sleep(3.0)
            if len(self.humans()) < 1:
                continue
            try:
                self.run_hand()
            except IllegalAction as exc:
                self.log("hand aborted: %s" % exc)
                time.sleep(1.0)
            time.sleep(2.5)


def _jsonable(moves):
    """Tuples survive JSON as lists; make that explicit."""
    out = {}
    for key, value in moves.items():
        out[key] = list(value) if isinstance(value, tuple) else value
    return out


def local_addresses():
    """Best-effort list of addresses other machines can dial."""
    found = ["127.0.0.1"]
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))       # no packets are actually sent
        found.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    return list(dict.fromkeys(found))


# =============================================================== client side

class GameClient:
    def __init__(self, host, port, name):
        self.host = host
        self.port = port
        self.name = name
        self.sock = None
        self.lock = threading.Lock()
        self.seat = None
        self.state = None
        self.moves = None
        self.events = []
        self.chat = []
        self.message = ""
        self.running = True

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self.sock.settimeout(None)
        send(self.sock, self.lock, {"t": "join", "name": self.name})

    def render(self):
        ui.clear()
        print(ui.banner())
        if self.state:
            print(ui.render(self.state, self.events, self.message))
        else:
            print("  connected - waiting for the table...")
        for line in self.chat[-5:]:
            print("  " + ui.c(line, ui.CYAN))
        if self.moves:
            me = None
            if self.state:
                me = next((p for p in self.state["players"] if p["seat"] == self.seat), None)
            print("\n  " + ui.c("YOUR TURN", ui.BOLD + ui.GREEN)
                  + "   hand: %s" % ui.hand_text(me["hole"] if me and me["hole"] else []))
            print("  " + ui.prompt_line(self.moves, me["chips"] if me else 0))
            print("  (or /say something, /help, /quit)")
        sys.stdout.write("\n  > ")
        sys.stdout.flush()

    def reader(self):
        for message in read_lines(self.sock):
            kind = message.get("t")
            if kind == "welcome":
                self.seat = message["seat"]
                self.name = message["name"]
                self.message = "seated in seat %d with %d chips" % (self.seat, message["buyin"])
            elif kind == "state":
                self.state = message["state"]
                self.message = message.get("message", "")
                if self.state.get("actor") != self.seat:
                    self.moves = None
                self.render()
            elif kind == "events":
                self.events.extend(message["lines"])
                self.events = self.events[-40:]
            elif kind == "turn":
                self.moves = message["moves"]
                self.render()
            elif kind == "chat":
                self.chat.append("%s: %s" % (message["from"], message["text"]))
                self.render()
            elif kind == "info":
                self.message = message["text"]
                self.render()
            elif kind == "error":
                self.message = ui.c(message["text"], ui.RED)
                self.render()
            elif kind == "results":
                mine = next((r for r in message["results"] if r["seat"] == self.seat), None)
                if mine:
                    if mine["net"] > 0:
                        self.message = ui.c("you win %d (%+d)" % (mine["won"], mine["net"]), ui.GREEN)
                    elif mine["net"] < 0:
                        self.message = ui.c("you lose %d" % -mine["net"], ui.RED)
            elif kind == "bye":
                self.message = message.get("text", "disconnected")
                self.running = False
                break
        self.running = False
        print("\n  " + ui.c("disconnected from the table", ui.RED))

    def run(self):
        self.connect()
        threading.Thread(target=self.reader, daemon=True).start()
        self.render()
        while self.running:
            try:
                raw = input().strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not raw:
                self.render()
                continue
            if raw.startswith("/"):
                parts = raw[1:].split(" ", 1)
                command = parts[0].lower()
                rest = parts[1] if len(parts) > 1 else ""
                if command in ("say", "chat", "s"):
                    send(self.sock, self.lock, {"t": "chat", "text": rest})
                elif command in ("quit", "q", "leave"):
                    send(self.sock, self.lock, {"t": "leave"})
                    break
                elif command in ("help", "h", "?"):
                    self.message = ("f fold | k check | c call | b <n> bet | "
                                    "r <n> raise | a all-in | /say <text> | /quit")
                    self.render()
                else:
                    self.message = "unknown command /%s" % command
                    self.render()
                continue

            if not self.moves:
                self.message = "not your turn - use /say to talk"
                self.render()
                continue
            parsed = ui.parse_action(raw, self.moves)
            if not parsed:
                self.message = "did not understand that - /help for the list"
                self.render()
                continue
            action, amount = parsed
            send(self.sock, self.lock, {"t": "action", "action": action, "amount": amount})
            self.moves = None
            self.message = "sent: %s%s" % (action, (" %d" % amount) if amount else "")
            self.render()
        try:
            self.sock.close()
        except OSError:
            pass
        print("  left the table")
