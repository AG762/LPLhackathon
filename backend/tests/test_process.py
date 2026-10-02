import importlib.util
import os
import sys
import unittest

# Load backend/process/handler.py the way Lambda does (its folder on the path, plain
# `from classify import ...`). It is loaded under another name because the api Lambda
# also has a module called `handler`.
PROCESS_DIR = os.path.join(os.path.dirname(__file__), "..", "process")
sys.path.append(PROCESS_DIR)
_spec = importlib.util.spec_from_file_location("process_handler", os.path.join(PROCESS_DIR, "handler.py"))
process_handler = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(process_handler)
compute_sha256 = process_handler.compute_sha256
extract_readable_text = process_handler.extract_readable_text

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
