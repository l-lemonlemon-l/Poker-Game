"""Single-player career mode: you, some bots, and an autosaving hex profile."""

from __future__ import annotations

import random
import time

from . import ai, saves, ui
from .engine import IllegalAction, Player, Table
from .evaluator import CATEGORY_NAMES, evaluate

HELP = """
  Commands while it is your turn
    f / fold              give up the hand
    k / check             check when there is nothing to call
    c / call              match the current bet
    b <n> / bet <n>       bet n chips
    r <n> / raise <n>     raise to a total of n (or by n, if n is small)
    a / allin             push your whole stack
  Anytime
    ?                     this help
    save                  write the hex save file now
    quit                  save and leave the table
"""


def _ask(prompt):
    try:
        return input(prompt)
    except EOFError:
        return "quit"
    except KeyboardInterrupt:
        print()
        return "quit"


class Career:
    def __init__(self, data, path, speed=0.9):
        self.data = data
        self.path = path
        self.speed = speed
        self.rng = random.Random()
        self.quit = False

        settings = data["settings"]
        self.hero = Player(data["player"]["name"], data["player"]["chips"])
        bots = [
            Player(name, self._bot_stack(), is_bot=True, style=style)
            for name, style in ai.bot_names(settings.get("bots", 3), self.rng)
        ]
        self.table = Table(
            [self.hero] + bots,
            small_blind=settings.get("small_blind", 10),
            big_blind=settings.get("big_blind", 20),
        )
        data["stats"]["sessions"] = data["stats"].get("sessions", 0) + 1

    def _bot_stack(self) -> int:
        base = max(self.data["player"]["chips"], self.data["settings"].get("big_blind", 20) * 50)
        return int(base * self.rng.uniform(0.7, 1.4) // 10 * 10)

    # -------------------------------------------------------------- rendering

    def show(self, message="", reveal=False):
        ui.clear()
        print(ui.banner())
        state = self.table.snapshot(viewer=self.hero.seat, reveal=reveal)
        print(ui.render(state, self.table.events, message))

    def pause(self, factor=1.0):
        if self.speed:
            time.sleep(self.speed * factor)

    # ------------------------------------------------------------- one action

    def human_turn(self):
        moves = self.table.legal_actions(self.hero.seat)
        while True:
            self.show()
            print("\n  Your hand: %s   stack %d   to call %d"
                  % (ui.hand_text([c.code for c in self.hero.hole]),
                     self.hero.chips,
                     max(0, self.table.current_bet - self.hero.bet)))
            print("  " + ui.prompt_line(moves, self.hero.chips))
            raw = _ask("\n  > ").strip()
            low = raw.lower()

            if low in ("?", "h", "help"):
                print(HELP)
                _ask("  press enter ")
                continue
            if low in ("save",):
                self.persist()
                print("  saved to %s" % self.path)
                _ask("  press enter ")
                continue
            if low in ("quit", "q", "exit"):
                self.quit = True
                moves = self.table.legal_actions(self.hero.seat)
                self.table.act(self.hero.seat, "check" if "check" in moves else "fold")
                return

            parsed = ui.parse_action(raw, moves)
            if not parsed:
                print(ui.c("  Did not understand that. Type ? for help.", ui.RED))
                self.pause(0.6)
                continue
            action, amount = parsed
            try:
                self.table.act(self.hero.seat, action, amount)
                return
            except IllegalAction as exc:
                print(ui.c("  %s" % exc, ui.RED))
                self.pause(1.0)

    def bot_turn(self, seat):
        player = self.table.players[seat]
        self.show(message="  %s is thinking..." % player.name)
        self.pause(0.5)
        action, amount = ai.decide(self.table, seat, self.rng)
        try:
            self.table.act(seat, action, amount)
        except IllegalAction:
            # Never let a bot stall the table on a rules mistake.
            moves = self.table.legal_actions(seat)
            self.table.act(seat, "check" if "check" in moves else "fold")

    # --------------------------------------------------------------- one hand

    def play_hand(self):
        self.table.start_hand()
        while self.table.hand_active:
            seat = self.table.actor
            if seat == self.hero.seat:
                self.human_turn()
            else:
                self.bot_turn(seat)
        self.finish_hand()

    def finish_hand(self):
        reveal = len(self.table.showdown) > 1
        self.show(reveal=reveal)
        result = next((r for r in self.table.results if r["seat"] == self.hero.seat), None)
        if result:
            if result["net"] > 0:
                print("  " + ui.c("You win %d chips (%+d for the hand)" % (result["won"], result["net"]), ui.GREEN))
            elif result["net"] == 0:
                print("  " + ui.c("You break even.", ui.GREY))
            else:
                print("  " + ui.c("You lose %d chips." % -result["net"], ui.RED))
        self.record(result)
        if not self.quit:
            answer = _ask("\n  enter to deal, or 'quit' to cash out: ").strip().lower()
            if answer in ("quit", "q", "exit"):
                self.quit = True

    # ------------------------------------------------------------ persistence

    def record(self, result):
        stats = self.data["stats"]
        stats["hands_played"] = stats.get("hands_played", 0) + 1
        stats["biggest_pot"] = max(stats.get("biggest_pot", 0), self.table.pot)
        if result:
            if result["won"] > 0:
                stats["hands_won"] = stats.get("hands_won", 0) + 1
                if len(self.table.showdown) > 1:
                    stats["showdowns_won"] = stats.get("showdowns_won", 0) + 1
            stats["net_winnings"] = stats.get("net_winnings", 0) + result["net"]
            self.data["history"] = (self.data.get("history", []) + [result["net"]])[-100:]
        if self.hero.contender and self.table.board:
            score = evaluate(self.hero.hole + self.table.board)
            from .evaluator import describe
            best = stats.get("best_hand_rank", -1)
            if score[0] > best:
                stats["best_hand_rank"] = score[0]
                stats["best_hand"] = describe(score)
        stats["peak_chips"] = max(stats.get("peak_chips", 0), self.hero.chips)
        self.persist()

    def persist(self):
        self.data["player"]["chips"] = self.hero.chips
        saves.write(self.path, self.data)

    # ------------------------------------------------------------- table care

    def keep_bots_alive(self):
        """Rebuy busted bots and top up the table so the game keeps going."""
        for p in self.table.players:
            if p.is_bot and p.chips <= 0:
                p.chips = self._bot_stack()
                p.sitting_out = False
                self.table.log("%s buys back in for %d" % (p.name, p.chips))

    def hero_broke(self) -> bool:
        if self.hero.chips > 0:
            return False
        print("\n  " + ui.c("You are out of chips.", ui.RED))
        answer = _ask("  Buy back in for 1000? [y/N] ").strip().lower()
        if answer.startswith("y"):
            self.hero.chips = 1000
            self.hero.sitting_out = False
            self.data["stats"]["rebuys"] = self.data["stats"].get("rebuys", 0) + 1
            self.persist()
            return False
        return True

    # ------------------------------------------------------------------- loop

    def run(self):
        while not self.quit:
            self.keep_bots_alive()
            if self.hero_broke():
                break
            self.hero.sitting_out = False
            if len(self.table.seated()) < 2:
                break
            try:
                self.play_hand()
            except IllegalAction as exc:
                print("  table error: %s" % exc)
                break
        self.persist()
        ui.clear()
        print(ui.banner())
        print("  Session over. Profile saved as hex to:\n    %s\n" % self.path)
        print(saves.summary(self.data))
        print()


def play(data, path, speed=0.9):
    Career(data, path, speed).run()
