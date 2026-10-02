import unittest
from backend.process.handler import compute_sha256, extract_readable_text

class TestProcessPipeline(unittest.TestCase):
    def test_compute_sha256(self):
        data = b"Hello ShredSafe"
        digest = compute_sha256(data)
        self.assertEqual(len(digest), 64)
        self.assertIsInstance(digest, str)

    def test_extract_readable_text(self):
        text_sample = b"Client Name: Alice\nAccount: 12345"
        res = extract_readable_text(text_sample, "statement.txt")
        self.assertIn("Alice", res)
        self.assertIn("12345", res)

    def test_extract_binary_fallback(self):
        binary_junk = b"\x00\x01\x02\x03\xff\xfe"
        res = extract_readable_text(binary_junk, "image.png")
        self.assertIn("Binary or unparsed", res)

if __name__ == "__main__":
    unittest.main()
