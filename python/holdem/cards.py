"""Playing cards: representation, deck building, and text rendering."""

from __future__ import annotations

import random
from dataclasses import dataclass

RANKS = "23456789TJQKA"
SUITS = "cdhs"
RANK_VALUE = {r: i + 2 for i, r in enumerate(RANKS)}
VALUE_RANK = {v: r for r, v in RANK_VALUE.items()}
SUIT_SYMBOL = {"c": "♣", "d": "♦", "h": "♥", "s": "♠"}
RANK_NAME = {
    2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
    8: "Eight", 9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen",
    13: "King", 14: "Ace",
}


@dataclass(frozen=True, order=True)
class Card:
    """A single card. `value` is 2-14 (14 = ace), `suit` is one of 'cdhs'."""

    value: int
    suit: str

    @property
    def code(self) -> str:
        """Two-character machine form, e.g. 'As' or 'Th'."""
        return VALUE_RANK[self.value] + self.suit

    @property
    def rank(self) -> str:
        return VALUE_RANK[self.value]

    @property
    def symbol(self) -> str:
        return SUIT_SYMBOL[self.suit]

    def __str__(self) -> str:
        return self.rank + self.symbol


def card(code: str) -> Card:
    """Parse 'As', 'th', '7d' into a Card."""
    code = code.strip()
    if len(code) != 2:
        raise ValueError("card code must be two characters, got %r" % code)
    rank, suit = code[0].upper(), code[1].lower()
    if rank not in RANK_VALUE or suit not in SUITS:
        raise ValueError("not a card: %r" % code)
    return Card(RANK_VALUE[rank], suit)


def cards(codes) -> list:
    """Parse a whitespace-separated string or an iterable of codes."""
    if isinstance(codes, str):
        codes = codes.split()
    return [card(c) for c in codes]


def full_deck() -> list:
    return [Card(v, s) for s in SUITS for v in range(2, 15)]


def new_deck(rng=None) -> list:
    """A freshly shuffled deck. Defaults to the OS entropy source."""
    deck = full_deck()
    (rng or random.SystemRandom()).shuffle(deck)
    return deck
