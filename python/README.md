# Terminal Hold'em

No-limit Texas Hold'em that runs in a terminal, plays online over TCP, and
saves your profile as a hexadecimal text file.

Pure Python 3 standard library — nothing to install.

```bash
python3 poker.py
```

## Playing

| Command | What it does |
| --- | --- |
| `python3 poker.py` | interactive menu |
| `python3 poker.py --play --bots 4` | single player against the bots |
| `python3 poker.py --host --port 7777 --bots 2` | open an online table |
| `python3 poker.py --join 192.168.1.20:7777 --name leon` | sit down at a table |
| `python3 poker.py --export save.txt` | write your save as hex text |
| `python3 poker.py --import save.txt` | load a hex save back in |
| `python3 poker.py --show save.txt` | verify a hex save without loading it |

At the table you type `f` fold, `k` check, `c` call, `b 150` bet, `r 400`
raise to 400, `a` all-in. A raise amount smaller than the minimum is read as
"raise *by* that much". Online you also get `/say hello`, `/help` and `/quit`.

## Online play

The host runs a table; everyone else dials in:

```bash
python3 poker.py --host --bots 2          # prints the address to share
python3 poker.py --join 10.0.0.5:7777     # from any other machine
```

The host can join their own table from a second terminal with
`--join 127.0.0.1:7777`. Empty seats are filled with bots, so a hand can start
with one human at the table. Over the internet you need to forward the port, or
put both machines on the same VPN/LAN.

The server owns the only copy of the game state. Each player receives a
snapshot built for their seat alone, so hole cards are never sent to anyone
else until a showdown. Players who disconnect are folded and their seat is
freed; a player who runs out of time is checked or folded automatically
(`--turn-clock`, default 60s).

Protocol is one JSON object per line over TCP:

```
server -> client   welcome  state  events  turn  chat  info  error  results  bye
client -> server   join  action  chat  leave
```

## The hex save file

A save is JSON, compressed and checksummed, then written as hexadecimal digits
in a plain `.txt` file — mailable, pasteable, and diffable:

```
# Terminal Hold'em save file
# format THPS v1 - hexadecimal, 64 digits per line
54485053010BF6A27378DA6D50C16E842010FD15C3591340CBAAB77E43F7D634
04950A59040364CD66B3FFDE196B3DF5320CEFBD9937334F3246ADB29E485F10
...
```

The container is `magic "THPS" | version | crc32 | zlib(json)`. The checksum
means an edited or truncated file is rejected on load instead of restoring a
half-broken game:

```
$ python3 poker.py --show tampered.txt
  tampered.txt: checksum mismatch - the file is corrupt or was edited
```

Your profile lives at `~/.terminal-holdem/profile.hex.txt` in exactly this
format and is rewritten after every hand, so a crash costs you nothing.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

Pure standard library here too (`unittest`, no pytest needed). Covers hand
evaluation, blind posting/turn order (including the 3+-handed case where the
button does *not* post a blind), fold-to-one-winner payouts, chip conservation
across a full hand, and the hex save format's round trip and tamper detection.

## Layout

```
poker.py            command line and menu
holdem/
  cards.py          cards, deck, shuffling
  evaluator.py      5- and 7-card hand ranking
  engine.py         betting rounds, blinds, all-ins, side pots
  ai.py             bots: Chen preflop, Monte Carlo equity after the flop
  saves.py          the hex save format
  ui.py             card art, table rendering, input parsing
  local.py          single-player career mode
  net.py            TCP server and client
```

The bots estimate their equity with a short Monte Carlo rollout and compare it
to the pot odds they are being offered. Six styles — `rock`, `tight`,
`balanced`, `loose`, `maniac`, `calling-station` — shift how loose and how
aggressive that comparison is, so a table does not play like one opponent
copied six times.

## Rules covered

Blinds and dead-button rotation, heads-up blind reversal, minimum raise
tracking, short all-in raises, side pots for any number of all-ins at different
stack depths, split pots with odd chips going to the first seat left of the
button, uncalled bets returned, and automatic board run-out when nobody can
act.

## Note

`src/` holds an earlier, non-functional TypeScript sketch of this idea and is
not used by the game. Delete it whenever you like.
