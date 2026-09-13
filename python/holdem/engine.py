"""No-limit Texas Hold'em rules engine.

The engine is a state machine driven from the outside, one action at a time,
so the same code backs both the single-player game and the network server:

    table.start_hand()
    while table.hand_active:
        seat = table.actor
        table.act(seat, "call")        # or fold / check / bet / raise / allin

Streets are dealt, all-ins are run out, and pots are awarded automatically as
soon as the action allows it. Everything worth showing a player is appended to
`table.events` as a plain string.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .cards import new_deck
from .evaluator import best_five, describe, evaluate

PREFLOP = "preflop"
FLOP = "flop"
TURN = "turn"
RIVER = "river"
SHOWDOWN = "showdown"
STREETS = (PREFLOP, FLOP, TURN, RIVER)


@dataclass
class Player:
    """One seat at the table."""

    name: str
    chips: int
    is_bot: bool = False
    style: str = "balanced"
    seat: int = 0

    hole: list = field(default_factory=list)
    bet: int = 0           # chips wagered on the current street
    committed: int = 0     # chips wagered over the whole hand
    in_hand: bool = False   # was dealt into this hand
    folded: bool = False
    all_in: bool = False
    has_acted: bool = False
    last_action: str = ""
    sitting_out: bool = False
    connected: bool = True

    @property
    def active(self) -> bool:
        """Still in the hand and still able to put chips in."""
        return self.in_hand and not self.folded and not self.all_in

    @property
    def contender(self) -> bool:
        """Still in the hand, whether or not they can bet."""
        return self.in_hand and not self.folded


class IllegalAction(ValueError):
    """Raised when a seat tries something the rules do not allow."""


class Table:
    def __init__(self, players, small_blind=10, big_blind=20, ante=0, rng=None):
        self.players = list(players)
        for i, p in enumerate(self.players):
            p.seat = i
        self.small_blind = small_blind
        self.big_blind = big_blind
        self.ante = ante
        self.rng = rng or random.SystemRandom()

        self.button = -1
        self.hand_no = 0
        self.deck = []
        self.board = []
        self.stage = "idle"
        self.actor = None
        self.current_bet = 0
        self.last_raise = big_blind
        self.hand_active = False
        self.events = []
        self.results = []      # filled in when a hand ends
        self.showdown = []     # [{seat, hole, five, score, label}] when cards are shown

    # ---------------------------------------------------------------- helpers

    def seated(self):
        """Players with chips who are not sitting out."""
        return [p for p in self.players if p.chips > 0 and not p.sitting_out]

    def contenders(self):
        return [p for p in self.players if p.contender]

    def actives(self):
        return [p for p in self.players if p.active]

    @property
    def pot(self) -> int:
        return sum(p.committed for p in self.players)

    def log(self, message: str) -> None:
        self.events.append(message)

    def _next_seat(self, start: int, predicate):
        """Seat index of the next player after `start` matching `predicate`."""
        n = len(self.players)
        for step in range(1, n + 1):
            idx = (start + step) % n
            if predicate(self.players[idx]):
                return idx
        return None

    def _post(self, player: Player, amount: int, label: str) -> int:
        """Move chips from a stack into the pot, capped at the stack."""
        amount = max(0, min(amount, player.chips))
        player.chips -= amount
        player.bet += amount
        player.committed += amount
        if player.chips == 0:
            player.all_in = True
        if amount and label:
            self.log("%s posts %s %d" % (player.name, label, amount))
        return amount

    # ------------------------------------------------------------- hand setup

    def start_hand(self) -> None:
        eligible = self.seated()
        if len(eligible) < 2:
            raise IllegalAction("need at least two players with chips")

        self.hand_no += 1
        self.events = []
        self.results = []
        self.showdown = []
        self.board = []
        self.deck = new_deck(self.rng)
        self.stage = PREFLOP
        self.hand_active = True

        for p in self.players:
            p.hole = []
            p.bet = 0
            p.committed = 0
            p.folded = False
            p.all_in = False
            p.has_acted = False
            p.last_action = ""
            p.in_hand = p in eligible

        self.button = self._next_seat(self.button, lambda p: p.in_hand)
        self.log("--- Hand #%d ---" % self.hand_no)
        self.log("%s has the button" % self.players[self.button].name)

        if self.ante:
            for p in self.players:
                if p.in_hand:
                    self._post(p, self.ante, "ante")
            for p in self.players:
                p.bet = 0  # antes are dead money, not a bet to be matched

        heads_up = len([p for p in self.players if p.in_hand]) == 2
        if heads_up:
            sb_seat = self.button
        else:
            sb_seat = self._next_seat(self.button, lambda p: p.in_hand)
        bb_seat = self._next_seat(sb_seat, lambda p: p.in_hand)

        self._post(self.players[sb_seat], self.small_blind, "small blind")
        self._post(self.players[bb_seat], self.big_blind, "big blind")

        # The big blind is a live bet even when its poster is all-in for less.
        self.current_bet = self.big_blind
        self.last_raise = self.big_blind

        for _ in range(2):
            seat = sb_seat
            for _ in range(len(self.players)):
                p = self.players[seat]
                if p.in_hand:
                    p.hole.append(self.deck.pop())
                seat = (seat + 1) % len(self.players)

        self.actor = self._next_seat(bb_seat, lambda p: p.active)
        if self.actor is None:
            self._close_betting()

    # ------------------------------------------------------------ legal moves

    def legal_actions(self, seat=None):
        """What the player to act may do, as {name: value}.

        'call' maps to the chip cost; 'bet'/'raise' map to (min_total, max_total)
        where the totals are the player's bet for the whole street.
        """
        seat = self.actor if seat is None else seat
        if seat is None or not self.hand_active:
            return {}
        p = self.players[seat]
        to_call = self.current_bet - p.bet
        moves = {"fold": True}

        if to_call <= 0:
            moves["check"] = True
        else:
            moves["call"] = min(to_call, p.chips)

        if p.chips > to_call:
            max_total = p.bet + p.chips
            min_total = min(self.current_bet + self.last_raise, max_total)
            if self.current_bet == 0:
                min_total = min(max(self.big_blind, self.last_raise), max_total)
            moves["raise" if self.current_bet > 0 else "bet"] = (min_total, max_total)
        moves["allin"] = p.bet + p.chips
        return moves

    # ---------------------------------------------------------------- actions

    def act(self, seat: int, action: str, amount: int = 0) -> None:
        """Apply one action and advance the hand as far as it will go."""
        if not self.hand_active:
            raise IllegalAction("no hand in progress")
        if seat != self.actor:
            raise IllegalAction("it is %s's turn" % self.players[self.actor].name)

        p = self.players[seat]
        action = action.lower()
        moves = self.legal_actions(seat)
        to_call = self.current_bet - p.bet

        if action == "fold":
            p.folded = True
            p.last_action = "fold"
            self.log("%s folds" % p.name)

        elif action == "check":
            if "check" not in moves:
                raise IllegalAction("cannot check facing a bet of %d" % to_call)
            p.last_action = "check"
            self.log("%s checks" % p.name)

        elif action == "call":
            if "call" not in moves:
                raise IllegalAction("nothing to call")
            paid = self._post(p, to_call, "")
            p.last_action = "all-in %d" % p.committed if p.all_in else "call %d" % paid
            self.log("%s calls %d%s" % (p.name, paid, " and is all in" if p.all_in else ""))

        elif action in ("bet", "raise", "allin"):
            if action == "allin":
                total = p.bet + p.chips
            else:
                total = int(amount)
            key = "raise" if self.current_bet > 0 else "bet"
            if key not in moves and action != "allin":
                raise IllegalAction("no chips left to %s" % key)
            max_total = p.bet + p.chips
            if total > max_total:
                raise IllegalAction("you only have %d" % p.chips)
            if total <= self.current_bet and total < max_total:
                raise IllegalAction("must %s to at least %d" % (key, moves[key][0]))
            if action != "allin" and total < moves.get(key, (0, 0))[0] and total < max_total:
                raise IllegalAction("minimum %s is %d" % (key, moves[key][0]))
            if total <= self.current_bet and total >= max_total and self.current_bet > 0:
                # An all-in that does not even match the current bet is just a call.
                paid = self._post(p, max_total - p.bet, "")
                p.last_action = "all-in %d" % paid
                self.log("%s calls all in for %d" % (p.name, paid))
                self._finish_action(p, reopened=False)
                return

            increment = total - self.current_bet
            paid = self._post(p, total - p.bet, "")
            full_raise = increment >= self.last_raise
            if full_raise:
                self.last_raise = increment
            self.current_bet = total
            verb = "bets" if key == "bet" else "raises to"
            p.last_action = ("all-in %d" % total) if p.all_in else "%s %d" % (key, total)
            self.log("%s %s %d%s" % (p.name, verb, total, " and is all in" if p.all_in else ""))
            self._finish_action(p, reopened=full_raise)
            return

        else:
            raise IllegalAction("unknown action %r" % action)

        self._finish_action(p, reopened=False)

    def _finish_action(self, player: Player, reopened: bool) -> None:
        player.has_acted = True
        if reopened:
            # A full-size raise gives everyone else a fresh turn.
            for other in self.players:
                if other is not player and other.active:
                    other.has_acted = False
        self._advance()

    # -------------------------------------------------------------- machinery

    def _betting_closed(self) -> bool:
        if len(self.contenders()) <= 1:
            return True
        actives = self.actives()
        if not actives:
            return True
        return all(p.has_acted and p.bet == self.current_bet for p in actives)

    def _advance(self) -> None:
        """Move the hand forward until it needs another decision."""
        while True:
            if len(self.contenders()) <= 1:
                self._end_hand()
                return
            if not self._betting_closed():
                nxt = self._next_seat(self.actor, lambda p: p.active)
                # Skip anyone who is already square with the bet and has acted.
                for _ in range(len(self.players)):
                    p = self.players[nxt]
                    if not (p.has_acted and p.bet == self.current_bet):
                        break
                    nxt = self._next_seat(nxt, lambda q: q.active)
                self.actor = nxt
                return
            if not self._close_betting():
                return

    def _close_betting(self) -> bool:
        """End the street. Returns True if another betting round starts."""
        for p in self.players:
            p.bet = 0
            p.has_acted = False
        self.current_bet = 0
        self.last_raise = self.big_blind

        if len(self.contenders()) <= 1:
            self._end_hand()
            return False

        # Nobody left to bet: run the board out and show cards.
        if len(self.actives()) <= 1:
            while len(self.board) < 5:
                self._deal_street(silent_stage=True)
            self._end_hand()
            return False

        if self.stage == RIVER:
            self._end_hand()
            return False

        self._deal_street()
        self.actor = self._next_seat(self.button, lambda p: p.active)
        return True

    def _deal_street(self, silent_stage: bool = False) -> None:
        self.deck.pop()  # burn card
        if not self.board:
            self.board.extend(self.deck.pop() for _ in range(3))
            self.stage = FLOP
        elif len(self.board) == 3:
            self.board.append(self.deck.pop())
            self.stage = TURN
        else:
            self.board.append(self.deck.pop())
            self.stage = RIVER
        self.log("%s: %s" % (self.stage.upper(), " ".join(str(c) for c in self.board)))

    # ------------------------------------------------------------- pot payout

    def _side_pots(self):
        """Split the pot into main and side pots as [(amount, [eligible seats])]."""
        stakes = sorted({p.committed for p in self.players if p.committed > 0})
        pots = []
        previous = 0
        for level in stakes:
            amount = sum(
                min(p.committed, level) - min(p.committed, previous)
                for p in self.players
            )
            eligible = [
                p.seat for p in self.players if p.contender and p.committed >= level
            ]
            if amount > 0 and eligible:
                pots.append((amount, eligible))
            elif amount > 0 and pots:
                # Money from folded players joins the pot below it.
                below, seats = pots[-1]
                pots[-1] = (below + amount, seats)
            previous = level
        return pots

    def _end_hand(self) -> None:
        contenders = self.contenders()
        scores = {}
        if len(contenders) > 1:
            for p in contenders:
                scores[p.seat] = evaluate(p.hole + self.board)
            self.stage = SHOWDOWN
            for p in contenders:
                self.showdown.append({
                    "seat": p.seat,
                    "name": p.name,
                    "hole": [c.code for c in p.hole],
                    "five": [c.code for c in best_five(p.hole + self.board)],
                    "label": describe(scores[p.seat]),
                })

        winnings = {p.seat: 0 for p in self.players}
        for amount, eligible in self._side_pots():
            if len(contenders) == 1:
                winners = [contenders[0].seat]
            else:
                best = max(scores[s] for s in eligible)
                winners = [s for s in eligible if scores[s] == best]
            share, odd = divmod(amount, len(winners))
            for s in winners:
                winnings[s] += share
            # Odd chips go to the first winner left of the button.
            seat = self.button
            while odd:
                seat = (seat + 1) % len(self.players)
                if seat in winners:
                    winnings[seat] += 1
                    odd -= 1

        for p in self.players:
            p.chips += winnings[p.seat]

        self.results = []
        for p in self.players:
            if p.in_hand:
                self.results.append({
                    "seat": p.seat,
                    "name": p.name,
                    "won": winnings[p.seat],
                    "net": winnings[p.seat] - p.committed,
                    "chips": p.chips,
                    "label": describe(scores[p.seat]) if p.seat in scores else "",
                    "folded": p.folded,
                })

        for r in sorted(self.results, key=lambda r: -r["won"]):
            if r["won"]:
                tail = " with %s" % r["label"] if r["label"] else ""
                self.log("%s wins %d%s" % (r["name"], r["won"], tail))

        self.hand_active = False
        self.actor = None
        for p in self.players:
            if p.chips == 0:
                p.sitting_out = True

    # ---------------------------------------------------------------- viewing

    def snapshot(self, viewer=None, reveal=False):
        """Everything a client may know, from `viewer`'s seat."""
        players = []
        for p in self.players:
            show = reveal or (viewer is not None and p.seat == viewer)
            players.append({
                "seat": p.seat,
                "name": p.name,
                "chips": p.chips,
                "bet": p.bet,
                "committed": p.committed,
                "folded": p.folded,
                "all_in": p.all_in,
                "in_hand": p.in_hand,
                "is_bot": p.is_bot,
                "sitting_out": p.sitting_out,
                "connected": p.connected,
                "last_action": p.last_action,
                "hole": [c.code for c in p.hole] if (show and p.hole) else None,
            })
        return {
            "hand_no": self.hand_no,
            "stage": self.stage,
            "board": [c.code for c in self.board],
            "pot": self.pot,
            "current_bet": self.current_bet,
            "button": self.button,
            "actor": self.actor,
            "you": viewer,
            "players": players,
            "small_blind": self.small_blind,
            "big_blind": self.big_blind,
            "hand_active": self.hand_active,
            "showdown": self.showdown,
            "results": self.results,
        }
