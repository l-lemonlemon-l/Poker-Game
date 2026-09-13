"""Poker hand evaluation.

A hand's strength is a plain tuple: the first element is the category
(0 = high card ... 8 = straight flush) and the rest are tie-breakers in
descending order of importance. Tuples compare exactly the way poker hands
do, so `max()` and `>` do the right thing everywhere else in the code.
"""

from __future__ import annotations

from collections import Counter
from itertools import combinations

from .cards import RANK_NAME, VALUE_RANK

HIGH_CARD = 0
PAIR = 1
TWO_PAIR = 2
TRIPS = 3
STRAIGHT = 4
FLUSH = 5
FULL_HOUSE = 6
QUADS = 7
STRAIGHT_FLUSH = 8

CATEGORY_NAMES = {
    HIGH_CARD: "High Card",
    PAIR: "Pair",
    TWO_PAIR: "Two Pair",
    TRIPS: "Three of a Kind",
    STRAIGHT: "Straight",
    FLUSH: "Flush",
    FULL_HOUSE: "Full House",
    QUADS: "Four of a Kind",
    STRAIGHT_FLUSH: "Straight Flush",
}


def _straight_high(values) -> int:
    """Top card of the best straight in `values`, or 0. Aces play low too."""
    unique = set(values)
    if 14 in unique:
        unique.add(1)  # the wheel: A-2-3-4-5
    ordered = sorted(unique, reverse=True)
    run = 1
    for i in range(1, len(ordered)):
        if ordered[i] == ordered[i - 1] - 1:
            run += 1
            if run >= 5:
                return ordered[i] + 4
        else:
            run = 1
    return 0


def evaluate5(hand) -> tuple:
    """Score exactly five cards."""
    values = sorted((c.value for c in hand), reverse=True)
    flush = len({c.suit for c in hand}) == 1
    high = _straight_high(values)

    if flush and high:
        return (STRAIGHT_FLUSH, high)

    # Groups of equal rank, most-numerous first then highest rank first.
    groups = sorted(Counter(values).items(), key=lambda kv: (-kv[1], -kv[0]))
    shape = [count for _, count in groups]
    ranked = [value for value, _ in groups]

    if shape[0] == 4:
        return (QUADS, ranked[0], ranked[1])
    if shape[0] == 3 and shape[1] == 2:
        return (FULL_HOUSE, ranked[0], ranked[1])
    if flush:
        return (FLUSH,) + tuple(values)
    if high:
        return (STRAIGHT, high)
    if shape[0] == 3:
        return (TRIPS, ranked[0], ranked[1], ranked[2])
    if shape[0] == 2 and shape[1] == 2:
        return (TWO_PAIR, ranked[0], ranked[1], ranked[2])
    if shape[0] == 2:
        return (PAIR,) + tuple(ranked)
    return (HIGH_CARD,) + tuple(values)


def evaluate(hand) -> tuple:
    """Best five-card score from 5, 6, or 7 cards."""
    hand = list(hand)
    if len(hand) < 5:
        raise ValueError("need at least five cards to evaluate")
    if len(hand) == 5:
        return evaluate5(hand)
    return max(evaluate5(five) for five in combinations(hand, 5))


def best_five(hand) -> list:
    """The five cards that make the best hand, for showing at showdown."""
    hand = list(hand)
    if len(hand) == 5:
        return hand
    return list(max(combinations(hand, 5), key=evaluate5))


def describe(score) -> str:
    """A readable name for a score tuple, e.g. 'Full House, Kings full of Nines'."""
    cat = score[0]
    name = CATEGORY_NAMES[cat]

    def one(v):
        return RANK_NAME[v]

    def many(v):
        return RANK_NAME[v] + ("es" if v in (6,) else "s")

    if cat == STRAIGHT_FLUSH:
        if score[1] == 14:
            return "Royal Flush"
        return "%s, %s high" % (name, one(score[1]))
    if cat == QUADS:
        return "%s, %s" % (name, many(score[1]))
    if cat == FULL_HOUSE:
        return "%s, %s full of %s" % (name, many(score[1]), many(score[2]))
    if cat == FLUSH:
        return "%s, %s high" % (name, one(score[1]))
    if cat == STRAIGHT:
        return "%s, %s high" % (name, one(score[1]))
    if cat == TRIPS:
        return "%s, %s" % (name, many(score[1]))
    if cat == TWO_PAIR:
        return "%s, %s and %s" % (name, many(score[1]), many(score[2]))
    if cat == PAIR:
        return "%s of %s" % (name, many(score[1]))
    return "%s, %s high" % (name, one(score[1]))


def short_describe(score) -> str:
    """Compact form used in tight table layouts."""
    cat = score[0]
    if cat == STRAIGHT_FLUSH and score[1] == 14:
        return "Royal Flush"
    if cat in (QUADS, FULL_HOUSE, TRIPS, PAIR, TWO_PAIR):
        return CATEGORY_NAMES[cat]
    return "%s (%s)" % (CATEGORY_NAMES[cat], VALUE_RANK[score[1]])
