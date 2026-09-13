import unittest

from holdem import saves


class HexSaveTests(unittest.TestCase):
    def test_round_trips_a_save_through_the_hex_format(self):
        data = saves.new_save("Alice", chips=750, small_blind=25, big_blind=50)
        text = saves.encode(data)
        self.assertTrue(text.splitlines()[0].startswith("#"))
        restored = saves.decode(text)
        self.assertEqual(restored["player"]["name"], "Alice")
        self.assertEqual(restored["player"]["chips"], 750)
        self.assertEqual(restored["settings"]["small_blind"], 25)
        self.assertEqual(restored["settings"]["big_blind"], 50)

    def test_rejects_a_tampered_save(self):
        data = saves.new_save("Bob")
        text = saves.encode(data)
        lines = text.splitlines()
        # Flip one hex digit in the payload to corrupt it without breaking the hex format itself.
        digit_line = next(i for i, l in enumerate(lines) if l and not l.startswith("#"))
        tampered_char = "0" if lines[digit_line][0] != "0" else "1"
        lines[digit_line] = tampered_char + lines[digit_line][1:]
        tampered = "\n".join(lines) + "\n"
        with self.assertRaises(ValueError):
            saves.decode(tampered)

    def test_rejects_non_hex_garbage(self):
        with self.assertRaises(ValueError):
            saves.decode("not a save file at all")


if __name__ == "__main__":
    unittest.main()
