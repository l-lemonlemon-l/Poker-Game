import unittest

from holdem.cards import cards
from holdem.evaluator import evaluate, evaluate5, HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH


class Evaluate5Tests(unittest.TestCase):
    def test_royal_flush(self):
        score = evaluate5(cards("As Ks Qs Js Ts"))
        self.assertEqual(score[0], STRAIGHT_FLUSH)
        self.assertEqual(score[1], 14)

    def test_ace_low_wheel_straight(self):
        score = evaluate5(cards("As 2h 3d 4c 5s"))
        self.assertEqual(score[0], STRAIGHT)
        self.assertEqual(score[1], 5)

    def test_four_of_a_kind_kicker(self):
        score = evaluate5(cards("9s 9h 9d 9c Ks"))
        self.assertEqual(score[0], QUADS)
        self.assertEqual(score[1:], (9, 13))

    def test_full_house_trips_first(self):
        score = evaluate5(cards("4s 4h 4d 9c 9s"))
        self.assertEqual(score[0], FULL_HOUSE)
        self.assertEqual(score[1:], (4, 9))

    def test_flush_ranked_by_kickers(self):
        score = evaluate5(cards("2s 5s 9s Js Ks"))
        self.assertEqual(score[0], FLUSH)
        self.assertEqual(score[1:], (13, 11, 9, 5, 2))

    def test_two_pair_with_kicker(self):
        score = evaluate5(cards("Ks Kh 3d 3c 7s"))
        self.assertEqual(score[0], TWO_PAIR)
        self.assertEqual(score[1:], (13, 3, 7))

    def test_high_card(self):
        score = evaluate5(cards("2s 5h 9d Jc Ks"))
        self.assertEqual(score[0], HIGH_CARD)
        self.assertEqual(score, (HIGH_CARD, 13, 11, 9, 5, 2))

    def test_higher_category_always_wins_regardless_of_kickers(self):
        pair = evaluate5(cards("2s 2h 9d Jc Ks"))
        high_card = evaluate5(cards("3s 5h 9c Jd As"))
        self.assertGreater(pair, high_card)


class EvaluateBestOfSevenTests(unittest.TestCase):
    def test_finds_the_best_five_of_seven(self):
        seven = cards("As Ah 2s 5s 9s Js 3d")
        score = evaluate(seven)
        # Best 5 of these 7 is the spade flush, not the pair of aces.
        self.assertEqual(score[0], FLUSH)

    def test_requires_at_least_five_cards(self):
        with self.assertRaises(ValueError):
            evaluate(cards("As Ah"))


if __name__ == "__main__":
    unittest.main()
