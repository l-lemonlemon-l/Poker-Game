"""Save files, stored as hexadecimal text.

A save is a small JSON document. Before it is written out it gets compressed
and wrapped in a checksummed container, then rendered as hex digits in a plain
.txt file you can mail, paste into chat, or keep in version control:

    magic 'THPS' | version | crc32 of the payload | zlib(json utf-8)

The checksum means a truncated or hand-edited file is rejected on load instead
of silently restoring a half-broken game.
"""

from __future__ import annotations

import binascii
import datetime
import json
import os
import zlib

MAGIC = b"THPS"
FORMAT_VERSION = 1
LINE_WIDTH = 64

HEADER = """\
# Terminal Hold'em save file
# format THPS v{version} - hexadecimal, {width} digits per line
# written {stamp}
# restore with:  python3 poker.py --import <this file>
"""


def default_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".terminal-holdem", "profile.hex.txt")


def new_save(name: str, chips: int = 2000, small_blind: int = 10, big_blind: int = 20):
    now = _now()
    return {
        "format": "terminal-holdem",
        "version": FORMAT_VERSION,
        "created": now,
        "saved": now,
        "player": {"name": name, "chips": chips},
        "settings": {"small_blind": small_blind, "big_blind": big_blind, "bots": 3},
        "stats": {
            "sessions": 0,
            "hands_played": 0,
            "hands_won": 0,
            "showdowns_won": 0,
            "biggest_pot": 0,
            "best_hand": "",
            "net_winnings": 0,
            "peak_chips": chips,
        },
        "history": [],
    }


def _now() -> str:
    return datetime.datetime.now().replace(microsecond=0).isoformat()


# ------------------------------------------------------------------ encoding

def encode(data) -> str:
    """Serialise a save into the hex text that goes in the .txt file."""
    payload = zlib.compress(json.dumps(data, sort_keys=True).encode("utf-8"), 9)
    crc = binascii.crc32(payload) & 0xFFFFFFFF
    blob = MAGIC + bytes([FORMAT_VERSION]) + crc.to_bytes(4, "big") + payload
    digits = binascii.hexlify(blob).decode("ascii").upper()
    lines = [digits[i:i + LINE_WIDTH] for i in range(0, len(digits), LINE_WIDTH)]
    header = HEADER.format(version=FORMAT_VERSION, width=LINE_WIDTH, stamp=data.get("saved", _now()))
    return header + "\n".join(lines) + "\n"


def decode(text: str):
    """Parse hex save text back into a save. Raises ValueError if damaged."""
    digits = "".join(
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )
    digits = "".join(digits.split())
    if not digits:
        raise ValueError("file contains no hex data")
    if len(digits) % 2:
        raise ValueError("odd number of hex digits - the file looks truncated")
    try:
        blob = binascii.unhexlify(digits)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("not valid hexadecimal: %s" % exc)

    if len(blob) < 9 or blob[:4] != MAGIC:
        raise ValueError("not a Terminal Hold'em save file")
    version = blob[4]
    if version > FORMAT_VERSION:
        raise ValueError(
            "save was written by a newer version (v%d, this build reads v%d)"
            % (version, FORMAT_VERSION)
        )
    stored_crc = int.from_bytes(blob[5:9], "big")
    payload = blob[9:]
    if (binascii.crc32(payload) & 0xFFFFFFFF) != stored_crc:
        raise ValueError("checksum mismatch - the file is corrupt or was edited")
    try:
        data = json.loads(zlib.decompress(payload).decode("utf-8"))
    except (zlib.error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("could not read save contents: %s" % exc)
    if data.get("format") != "terminal-holdem":
        raise ValueError("hex decoded, but this is not a poker save")
    return data


# --------------------------------------------------------------------- files

def write(path: str, data) -> str:
    data["saved"] = _now()
    path = os.path.expanduser(path)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(encode(data))
    os.replace(tmp, path)   # never leave a half-written save behind
    return path


def read(path: str):
    path = os.path.expanduser(path)
    with open(path, "r", encoding="utf-8") as fh:
        return decode(fh.read())


def load_or_create(path: str, name: str = "Player", chips: int = 2000):
    path = os.path.expanduser(path)
    if os.path.exists(path):
        return read(path)
    return new_save(name, chips)


def summary(data) -> str:
    """A few lines describing a save, for the menu and for --import."""
    p = data["player"]
    s = data["stats"]
    played = s.get("hands_played", 0) or 1
    lines = [
        "  player      %s" % p["name"],
        "  chips       %d" % p["chips"],
        "  hands       %d played, %d won (%.0f%%)"
        % (s.get("hands_played", 0), s.get("hands_won", 0), 100.0 * s.get("hands_won", 0) / played),
        "  net         %+d" % s.get("net_winnings", 0),
        "  peak stack  %d" % s.get("peak_chips", p["chips"]),
        "  biggest pot %d" % s.get("biggest_pot", 0),
        "  best hand   %s" % (s.get("best_hand") or "-"),
        "  saved       %s" % data.get("saved", "?"),
    ]
    return "\n".join(lines)
