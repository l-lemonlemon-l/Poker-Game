"""Terminal rendering: colour, card art, and the table view."""

from __future__ import annotations

import os
import shutil
import sys

from .cards import SUIT_SYMBOL, card

USE_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
CYAN = "\033[96m"
WHITE = "\033[97m"
GREY = "\033[90m"

SUIT_COLOR = {"s": WHITE, "c": GREEN, "h": RED, "d": BLUE}


def c(text: str, colour: str) -> str:
    return "%s%s%s" % (colour, text, RESET) if USE_COLOR else str(text)


def width() -> int:
    return shutil.get_terminal_size((80, 24)).columns


def clear() -> None:
    if USE_COLOR:
        sys.stdout.write("\033[2J\033[H")
        sys.stdout.flush()


def card_text(code: str) -> str:
    """A single card inline, e.g. 'A♠' in colour."""
    cd = card(code)
    return c(cd.rank + SUIT_SYMBOL[cd.suit], SUIT_COLOR[cd.suit])


def hand_text(codes, hidden: int = 0) -> str:
    parts = [card_text(x) for x in (codes or [])]
    parts += [c("??", GREY)] * hidden
    return " ".join(parts) if parts else c("--", GREY)


def card_art(codes, hidden: int = 0) -> list:
    """Three lines of mini card art for a row of cards."""
    tops, mids, bots = [], [], []
    for code in codes or []:
        cd = card(code)
        face = (cd.rank + SUIT_SYMBOL[cd.suit]).ljust(3)
        tops.append("╭───╮")
        mids.append("│" + c(face, SUIT_COLOR[cd.suit]) + "│")
        bots.append("╰───╯")
    for _ in range(hidden):
        tops.append("╭───╮")
        mids.append("│" + c("▚▚▚", GREY) + "│")
        bots.append("╰───╯")
    if not tops:
        return ["", c("  (no cards yet)", GREY), ""]
    return [" ".join(tops), " ".join(mids), " ".join(bots)]


def banner() -> str:
    art = r"""
   ______              _         __   __  __      __    __              
  /_  __/__ ______ _  (_)__  ___/ /  / /_/ /__   / /___/ /__ __ _       
   / / / -_) __/  ' \/ / _ \/ _  /  / __/ / _ \ / / _  / -_)  ' \      
  /_/  \__/_/ /_/_/_/_/_//_/\_,_/   \__/_/\___//_/\_,_/\__/_/_/_/       
"""
    return c(art, CYAN) + c("            no-limit texas hold'em, in your terminal\n", GREY)


def _seat_line(p, state, you) -> str:
    tag = []
    if p["seat"] == state["button"]:
        tag.append(c("D", YELLOW))
    if p["seat"] == state["actor"]:
        tag.append(c("*", GREEN))
    marker = "".join(tag).ljust(2 if not USE_COLOR else 12)[:20]

    name = p["name"][:14]
    if p["seat"] == you:
        name = c(name.ljust(14), BOLD + CYAN)
    elif p["is_bot"]:
        name = c(name.ljust(14), MAGENTA)
    else:
        name = name.ljust(14)

    if p["sitting_out"] and not p["in_hand"]:
        status = c("out", GREY)
    elif p["folded"]:
        status = c("folded", GREY)
    elif p["all_in"]:
        status = c("ALL IN", YELLOW)
    elif not p.get("connected", True):
        status = c("away", GREY)
    else:
        status = p["last_action"] or ""

    if p["hole"]:
        cards_shown = hand_text(p["hole"])
    elif p["in_hand"] and not p["folded"]:
        cards_shown = hand_text([], hidden=2)
    else:
        cards_shown = c("     ", GREY)

    bet = ("bet %d" % p["bet"]) if p["bet"] else ""
    return "  %s %s %s  %s  %-10s %s" % (
        marker,
        name,
        cards_shown,
        c(("%7d" % p["chips"]), GREEN if p["chips"] else GREY),
        bet,
        status,
    )


def render(state, events=None, message="") -> str:
    """The whole table as a block of text."""
    w = min(max(width(), 62), 100)
    out = []
    rule = c("─" * w, GREY)
    out.append(rule)
    head = " Hand #%d   %s   blinds %d/%d   pot %s" % (
        state["hand_no"],
        state["stage"].upper(),
        state["small_blind"],
        state["big_blind"],
        c(str(state["pot"]), BOLD + YELLOW),
    )
    out.append(head)
    out.append(rule)

    art = card_art(state["board"])
    label = c("  BOARD", GREY)
    out.append("")
    for i, line in enumerate(art):
        out.append("   " + line + (label if i == 1 else ""))
    out.append("")

    for p in state["players"]:
        out.append(_seat_line(p, state, state.get("you")))
    out.append("")

    if state.get("showdown"):
        out.append(c("  Showdown:", BOLD))
        for s in state["showdown"]:
            out.append("    %-14s %s  %s" % (s["name"], hand_text(s["hole"]), c(s["label"], YELLOW)))
        out.append("")

    if events:
        out.append(rule)
        for line in events[-8:]:
            out.append("  " + c(line, GREY))
    if message:
        out.append(rule)
        out.append("  " + message)
    out.append(rule)
    return "\n".join(out)


def prompt_line(moves, chips) -> str:
    """The one-line summary of what the player may do."""
    bits = []
    if "check" in moves:
        bits.append(c("[k]", GREEN) + "check")
    if "call" in moves:
        bits.append(c("[c]", GREEN) + "call %d" % moves["call"])
    if "bet" in moves:
        lo, hi = moves["bet"]
        bits.append(c("[b]", YELLOW) + "bet %d-%d" % (lo, hi))
    if "raise" in moves:
        lo, hi = moves["raise"]
        bits.append(c("[r]", YELLOW) + "raise to %d-%d" % (lo, hi))
    bits.append(c("[a]", MAGENTA) + "all-in %d" % moves.get("allin", chips))
    bits.append(c("[f]", RED) + "fold")
    return "  ".join(bits)


def parse_action(text, moves):
    """Turn typed input into (action, amount). Returns None if unusable."""
    text = (text or "").strip().lower()
    if not text:
        return None
    parts = text.split()
    word = parts[0]
    amount = 0
    if len(parts) > 1:
        try:
            amount = int(parts[1].replace(",", ""))
        except ValueError:
            return None

    alias = {
        "f": "fold", "fold": "fold",
        "k": "check", "check": "check", "x": "check",
        "c": "call", "call": "call",
        "b": "bet", "bet": "bet",
        "r": "raise", "raise": "raise",
        "a": "allin", "allin": "allin", "all-in": "allin", "all": "allin",
    }
    action = alias.get(word)
    if action is None:
        return None
    if action == "check" and "check" not in moves and "call" in moves:
        action = "call"      # "check" facing a bet almost always means call
    if action in ("bet", "raise"):
        key = "bet" if "bet" in moves else "raise"
        action = key
        if not amount:
            return None
        # Treat a raise below the current bet as "raise BY this much".
        lo, hi = moves.get(key, (0, 0))
        if amount < lo and amount + lo <= hi:
            amount = min(hi, amount + lo)
    return (action, amount)
