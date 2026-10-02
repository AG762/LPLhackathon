"""Minimal text-only PDF writer (no dependencies), enough for the Certificate of Disposal.

Lines are (text, style) pairs; style is "title", "heading", "bold", "body" or "small". Long lines
wrap, and pages break automatically. Text is limited to Latin-1, which the base-14 fonts cover.
"""
import textwrap

PAGE_W, PAGE_H = 612, 792  # US Letter, points
MARGIN = 54

STYLES = {  # font resource, size, leading, wrap width in characters
    "title": ("F2", 18, 26, 60),
    "heading": ("F2", 12, 20, 80),
    "bold": ("F2", 10, 14, 95),
    "body": ("F1", 10, 14, 95),
    "small": ("F1", 8, 11, 120),
}


def _escape(text):
    text = text.encode("latin-1", "replace").decode("latin-1")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _pages(lines):
    pages, current, y = [], [], PAGE_H - MARGIN
    for text, style in lines:
        font, size, leading, width = STYLES[style]
        for part in textwrap.wrap(text, width) or [""]:
            if y - leading < MARGIN:
                pages.append(current)
                current, y = [], PAGE_H - MARGIN
            y -= leading
            current.append(f"BT /{font} {size} Tf {MARGIN} {y} Td ({_escape(part)}) Tj ET")
    pages.append(current)
    return pages


def render(lines, title="Document"):
    pages = _pages(lines)
    objects = []  # object n is objects[n - 1]

    def add(body):
        objects.append(body)
        return len(objects)

    catalog = add(None)
    pages_obj = add(None)
    regular = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    kids = []
    for ops in pages:
        stream = "\n".join(ops).encode("latin-1")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(add(
            f"<< /Type /Page /Parent {pages_obj} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 {regular} 0 R /F2 {bold} 0 R >> >> /Contents {content} 0 R >>".encode()
        ))
    objects[catalog - 1] = f"<< /Type /Catalog /Pages {pages_obj} 0 R >>".encode()
    objects[pages_obj - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    info = add(f"<< /Title ({_escape(title)}) /Producer (ShredSafe) >>".encode("latin-1"))

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1, catalog, info, xref)
    return bytes(out)
