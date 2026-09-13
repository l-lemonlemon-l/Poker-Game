#!/usr/bin/env python3
"""Terminal Hold'em - no-limit Texas Hold'em for the terminal.

    python3 poker.py                      menu
    python3 poker.py --play               single player against the bots
    python3 poker.py --host               open an online table
    python3 poker.py --join HOST:PORT     sit down at someone's table
    python3 poker.py --export game.txt    write your save as hexadecimal text
    python3 poker.py --import game.txt    load a hex save back in
    python3 poker.py --show game.txt      verify and describe a hex save

Standard library only - no installation, no dependencies.
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from holdem import saves, ui
from holdem.net import DEFAULT_PORT


def ask(prompt, default=""):
    try:
        answer = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return default
    return answer or default


def load_profile(path, name=None):
    """Open the hex profile, creating one on first run."""
    path = os.path.expanduser(path)
    if os.path.exists(path):
        try:
            return saves.read(path)
        except ValueError as exc:
            print(ui.c("  cannot read %s: %s" % (path, exc), ui.RED))
            if not ask("  start a fresh profile instead? [y/N] ").lower().startswith("y"):
                sys.exit(1)
    return saves.new_save(name or ask("  your name: ", "Player"))


# ------------------------------------------------------------------ commands

def cmd_export(args):
    data = load_profile(args.save)
    path = saves.write(args.export, data)
    size = os.path.getsize(path)
    print("  exported %s (%d bytes of hex text)" % (path, size))
    print(saves.summary(data))


def cmd_import(args):
    try:
        data = saves.read(args.import_path)
    except (ValueError, OSError) as exc:
        print(ui.c("  import failed: %s" % exc, ui.RED))
        return 1
    print("  read %s" % args.import_path)
    print(saves.summary(data))
    target = os.path.expanduser(args.save)
    if os.path.exists(target):
        if not ask("\n  overwrite the profile at %s? [y/N] " % target).lower().startswith("y"):
            print("  left the existing profile alone")
            return 0
    saves.write(target, data)
    print("  profile restored to %s" % target)
    return 0


def cmd_show(args):
    try:
        data = saves.read(args.show)
    except (ValueError, OSError) as exc:
        print(ui.c("  %s: %s" % (args.show, exc), ui.RED))
        return 1
    print("  %s - checksum ok, format v%d" % (args.show, data.get("version", 1)))
    print(saves.summary(data))
    return 0


def cmd_play(args):
    from holdem import local
    data = load_profile(args.save, args.name)
    if args.name:
        data["player"]["name"] = args.name
    if args.bots is not None:
        data["settings"]["bots"] = max(1, min(args.bots, 8))
    if args.sb:
        data["settings"]["small_blind"] = args.sb
    if args.bb:
        data["settings"]["big_blind"] = args.bb
    path = os.path.expanduser(args.save)
    local.play(data, path, speed=0.0 if args.fast else 0.9)
    return 0


def cmd_host(args):
    from holdem.net import GameServer
    GameServer(
        port=args.port,
        seats=args.seats,
        bots=args.bots if args.bots is not None else 2,
        buyin=args.chips,
        small_blind=args.sb or 10,
        big_blind=args.bb or 20,
        turn_seconds=args.turn_clock,
    ).serve()
    return 0


def cmd_join(args):
    from holdem.net import GameClient
    target = args.join
    if ":" in target:
        host, _, port = target.rpartition(":")
        port = int(port)
    else:
        host, port = target, args.port
    name = args.name or ask("  your name: ", "guest")
    client = GameClient(host, port, name)
    try:
        client.run()
    except (OSError, ConnectionError) as exc:
        print(ui.c("  could not reach %s:%d - %s" % (host, port, exc), ui.RED))
        return 1
    return 0


# ---------------------------------------------------------------------- menu

MENU = """
  1  play against the bots
  2  host an online table
  3  join an online table
  4  export my save as a hex text file
  5  import a hex save file
  6  show my profile
  q  quit
"""


def menu(args):
    while True:
        ui.clear()
        print(ui.banner())
        path = os.path.expanduser(args.save)
        if os.path.exists(path):
            try:
                print(saves.summary(saves.read(path)))
            except ValueError as exc:
                print(ui.c("  profile unreadable: %s" % exc, ui.RED))
        else:
            print("  no profile yet - it is created when you first play")
        print(MENU)
        choice = ask("  > ").lower()

        if choice == "1":
            cmd_play(args)
            ask("\n  enter to return to the menu ")
        elif choice == "2":
            args.port = int(ask("  port [%d]: " % args.port, str(args.port)))
            args.bots = int(ask("  bots to fill seats [2]: ", "2"))
            cmd_host(args)
            return 0
        elif choice == "3":
            args.join = ask("  host:port [127.0.0.1:%d]: " % DEFAULT_PORT,
                            "127.0.0.1:%d" % DEFAULT_PORT)
            cmd_join(args)
            ask("\n  enter to return to the menu ")
        elif choice == "4":
            target = ask("  file to write [poker-save.txt]: ", "poker-save.txt")
            args.export = target
            cmd_export(args)
            ask("\n  enter to continue ")
        elif choice == "5":
            args.import_path = ask("  file to read: ")
            if args.import_path:
                cmd_import(args)
            ask("\n  enter to continue ")
        elif choice == "6":
            cmd_show(argparse.Namespace(show=path))
            ask("\n  enter to continue ")
        elif choice in ("q", "quit", "exit"):
            return 0


# ---------------------------------------------------------------------- main

def build_parser():
    p = argparse.ArgumentParser(
        prog="poker.py",
        description="No-limit Texas Hold'em in the terminal, with online play "
                    "and hexadecimal save files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  python3 poker.py --play --bots 4
  python3 poker.py --host --port 7777 --bots 2
  python3 poker.py --join 192.168.1.20:7777 --name leon
  python3 poker.py --export ~/Desktop/my-poker-save.txt
  python3 poker.py --import ~/Desktop/my-poker-save.txt
""")
    mode = p.add_argument_group("modes")
    mode.add_argument("--play", action="store_true", help="single player against bots")
    mode.add_argument("--host", action="store_true", help="run an online table")
    mode.add_argument("--join", metavar="HOST[:PORT]", help="join an online table")
    mode.add_argument("--export", metavar="FILE", help="write the save as a hex .txt file")
    mode.add_argument("--import", dest="import_path", metavar="FILE",
                      help="restore a hex save file")
    mode.add_argument("--show", metavar="FILE", help="verify and describe a hex save file")

    opt = p.add_argument_group("options")
    opt.add_argument("--name", help="your table name")
    opt.add_argument("--save", default=saves.default_path(),
                     metavar="FILE", help="profile location (default: %(default)s)")
    opt.add_argument("--chips", type=int, default=2000, help="starting stack online")
    opt.add_argument("--bots", type=int, help="number of computer players")
    opt.add_argument("--seats", type=int, default=6, help="seats at an online table")
    opt.add_argument("--port", type=int, default=DEFAULT_PORT, help="tcp port")
    opt.add_argument("--sb", type=int, help="small blind")
    opt.add_argument("--bb", type=int, help="big blind")
    opt.add_argument("--turn-clock", type=int, default=60,
                     metavar="SECONDS", help="seconds a player has to act online")
    opt.add_argument("--fast", action="store_true", help="no pauses between bot actions")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.export:
        return cmd_export(args) or 0
    if args.import_path:
        return cmd_import(args) or 0
    if args.show:
        return cmd_show(args) or 0
    if args.host:
        return cmd_host(args) or 0
    if args.join:
        return cmd_join(args) or 0
    if args.play:
        return cmd_play(args) or 0
    return menu(args) or 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n  bye")
        sys.exit(0)
