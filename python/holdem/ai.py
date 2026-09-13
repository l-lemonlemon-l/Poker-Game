"""Computer opponents.

Preflop the bots use a cheap positional hand score; from the flop on they run a
short Monte Carlo rollout to estimate equity, then compare it to the pot odds
they are being offered. Each style shifts how loose and how aggressive that
comparison is, so a table of bots does not play like one player copied six times.
"""

from __future__ import annotations

import random

from .cards import full_deck
from .evaluator import evaluate

STYLES = {
    #                  looseness  aggression  bluff
    "rock":           (0.86,      0.55,       0.02),
    "tight":          (0.95,      0.85,       0.05),
    "balanced":       (1.00,      1.00,       0.10),
    "loose":          (1.12,      1.15,       0.16),
    "maniac":         (1.30,      1.60,       0.30),
    "calling-station":(1.20,      0.35,       0.03),
}

STYLE_NAMES = list(STYLES)


def chen_score(hole) -> float:
    """Bill Chen's preflop formula: roughly -1 (72o) to 20 (AA)."""
    a, b = sorted(hole, key=lambda c: -c.value)
    high = {14: 10.0, 13: 8.0, 12: 7.0, 11: 6.0}.get(a.value, a.value / 2.0)
    score = high
    if a.value == b.value:
        score = max(5.0, high * 2)
    if a.suit == b.suit:
        score += 2
    gap = a.value - b.value - 1
    score -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
    if gap <= 1 and a.value < 12 and a.value != b.value:
        score += 1
    return score


def equity(hole, board, opponents, rng, sims=140) -> float:
    """Share of the pot this hand wins on average against random holdings."""
    known = set(hole) | set(board)
    deck = [c for c in full_deck() if c not in known]
    need = 5 - len(board)
    wins = 0.0
    for _ in range(sims):
        draw = rng.sample(deck, need + 2 * opponents)
        community = list(board) + draw[:need]
        mine = evaluate(list(hole) + community)
        best_other = None
        for i in range(opponents):
            pair = draw[need + 2 * i: need + 2 * i + 2]
            theirs = evaluate(list(pair) + community)
            if best_other is None or theirs > best_other:
                best_other = theirs
        if best_other is None or mine > best_other:
            wins += 1.0
        elif mine == best_other:
            wins += 0.5
    return wins / sims


def decide(table, seat, rng=None):
    """Pick an action for a bot. Returns (action, amount)."""
    rng = rng or random.Random()
    player = table.players[seat]
    moves = table.legal_actions(seat)
    to_call = table.current_bet - player.bet
    pot = table.pot
    opponents = max(1, len([p for p in table.players if p.contender and p.seat != seat]))
    looseness, aggression, bluff_rate = STYLES.get(player.style, STYLES["balanced"])

    if table.board:
        eq = equity(player.hole, table.board, min(opponents, 3), rng)
    else:
        # Map the Chen score onto something equity-shaped.
        eq = min(0.92, max(0.20, 0.30 + chen_score(player.hole) / 26.0))
        if opponents > 2:
            eq -= 0.04 * (opponents - 2)

    eq *= looseness
    pot_odds = to_call / float(pot + to_call) if to_call > 0 else 0.0
    can_raise = "raise" in moves or "bet" in moves
    key = "bet" if "bet" in moves else "raise"

    def sized_raise(fraction):
        lo, hi = moves[key]
        target = int(player.bet + to_call + max(pot, table.big_blind) * fraction)
        target = max(lo, min(hi, target))
        # Shove rather than leave a token amount behind.
        if hi - target < table.big_blind * 2:
            target = hi
        return ("raise" if key == "raise" else "bet", target)

    # No bet to face: check, or take a stab at it.
    if to_call <= 0:
        if can_raise and (eq > 0.62 or rng.random() < bluff_rate):
            fraction = 0.5 + 0.35 * rng.random()
            if eq > 0.85:
                fraction += 0.3
            return sized_raise(fraction * aggression)
        return ("check", 0)

    # Facing a bet.
    if eq > 0.80 and can_raise and rng.random() < 0.75 * aggression:
        return sized_raise(0.8 + 0.6 * rng.random())
    if eq > 0.62 and can_raise and rng.random() < 0.30 * aggression:
        return sized_raise(0.55)
    if eq >= pot_odds + 0.02:
        return ("call", 0)
    # A cheap call closing the action is worth it with any live hand.
    if to_call <= table.big_blind and eq > 0.30 and rng.random() < 0.6:
        return ("call", 0)
    if can_raise and rng.random() < bluff_rate * 0.5 and eq < 0.25:
        return sized_raise(0.9)
    return ("fold", 0)


def bot_names(count, rng=None):
    """Distinct table personalities for filling empty seats."""
    rng = rng or random.Random()
    pool = [
        ("Ace", "tight"), ("Slick", "loose"), ("Mabel", "rock"),
        ("Dutch", "maniac"), ("Rounder", "balanced"), ("Kitty", "calling-station"),
        ("Doc", "tight"), ("Vega", "loose"), ("Tex", "balanced"),
    ]
    rng.shuffle(pool)
    return pool[:count]
