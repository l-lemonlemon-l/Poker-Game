import unittest

from holdem.engine import Player, Table


def make_table(names, chips=1000, sb=5, bb=10):
    players = [Player(name=n, chips=chips) for n in names]
    return Table(players, small_blind=sb, big_blind=bb)


class BlindsAndDealingTests(unittest.TestCase):
    def test_three_handed_blinds_are_left_of_the_button_not_on_it(self):
        table = make_table(["Alice", "Bob", "Carol"])
        table.start_hand()
        # Button is seat 0 on the very first hand; blinds are the two seats left of it.
        self.assertEqual(table.button, 0)
        self.assertEqual(table.players[1].bet, 5)
        self.assertEqual(table.players[2].bet, 10)
        self.assertEqual(table.players[0].bet, 0)
        for p in table.players:
            self.assertEqual(len(p.hole), 2)

    def test_heads_up_button_posts_small_blind(self):
        table = make_table(["Alice", "Bob"])
        table.start_hand()
        self.assertEqual(table.players[0].bet, 5)
        self.assertEqual(table.players[1].bet, 10)

    def test_rejects_starting_with_fewer_than_two_funded_players(self):
        table = make_table(["Alice"])
        with self.assertRaises(Exception):
            table.start_hand()


class BettingProgressionTests(unittest.TestCase):
    def test_advances_to_the_flop_once_everyone_has_called(self):
        table = make_table(["Alice", "Bob", "Carol"])
        table.start_hand()
        # 3-handed preflop: action starts on the button (UTG wraps around to it).
        self.assertEqual(table.actor, 0)
        table.act(0, "call")
        table.act(1, "call")
        table.act(2, "check")
        self.assertEqual(table.stage, "flop")
        self.assertEqual(len(table.board), 3)
        self.assertEqual(table.current_bet, 0)

    def test_rejects_acting_out_of_turn(self):
        table = make_table(["Alice", "Bob", "Carol"])
        table.start_hand()
        with self.assertRaises(Exception):
            table.act(2, "check")

    def test_folding_to_one_player_awards_the_pot_immediately(self):
        table = make_table(["Alice", "Bob", "Carol"])
        table.start_hand()
        pot_before = table.pot
        table.act(0, "fold")
        table.act(1, "fold")
        self.assertFalse(table.hand_active)
        self.assertEqual(table.players[2].chips, 1000 - 10 + pot_before)


class SidePotAndShowdownTests(unittest.TestCase):
    def test_no_chips_are_created_or_destroyed_across_a_full_hand(self):
        table = make_table(["Alice", "Bob"], chips=1000)
        table.start_hand()
        while table.hand_active:
            seat = table.actor
            to_call = table.current_bet - table.players[seat].bet
            table.act(seat, "call" if to_call > 0 else "check")
        total = sum(p.chips for p in table.players)
        self.assertEqual(total, 2000)


if __name__ == "__main__":
    unittest.main()
