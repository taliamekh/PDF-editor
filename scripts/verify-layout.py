from pathlib import Path
import pdfplumber
from pypdf import PdfReader, PdfWriter

root = Path(__file__).resolve().parents[1] / 'test-output'
reader = PdfReader(root / 'fixture.pdf')
writer = PdfWriter()
writer.append(reader)
writer.pages[0].rotate(90)
writer.pages[0].cropbox.lower_left = (20, 30)
writer.pages[0].cropbox.upper_right = (590, 770)
with (root / 'rotated-page.pdf').open('wb') as stream:
    writer.write(stream)

for name in ['edited.pdf', 'all-edits.pdf']:
    result = PdfReader(root / name)
    assert len(result.pages) == 2
    with pdfplumber.open(root / name) as pdf:
        selected = [c for c in pdf.pages[0].chars if c['fontname'].endswith('ArialMT') and 650 < c['y0'] < 680]
        assert selected and all(abs(c['size'] - 13.5) < 0.00001 for c in selected)
print('Independent size checks passed. Rotated/cropped fixture created.')
