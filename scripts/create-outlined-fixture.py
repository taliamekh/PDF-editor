from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'test-output/fixture-deps'))
from reportlab.pdfgen import canvas
from fontTools.ttLib import TTFont
from fontTools.pens.reportLabPen import ReportLabPen

out=Path(__file__).resolve().parents[1]/'test-output'
font=TTFont(r'C:\Windows\Fonts\arial.ttf')
glyphs=font.getGlyphSet()
cmap=font.getBestCmap()
units=font['head'].unitsPerEm
c=canvas.Canvas(str(out/'outlined-fixture.pdf'),pagesize=(612,792))
def outlined(text,x,y,size):
    for char in text:
        name=cmap[ord(char)]
        c.saveState();c.translate(x,y);c.scale(size/units,size/units)
        path=c.beginPath();path.closePath=path.close
        pen=ReportLabPen(glyphs,path);glyphs[name].draw(pen)
        c.drawPath(path,fill=1,stroke=0);c.restoreState()
        x+=font['hmtx'][name][0]*size/units
outlined('Outlined PDF editing test',60,710,20)
outlined('Click this text and type directly.',60,650,13)
outlined('Keep the surrounding page unchanged.',60,610,13)
outlined('Reference number 12345.',60,560,12)
c.setStrokeColorRGB(.2,.6,.4);c.line(60,540,520,540)
c.save()
print('Synthetic outlined PDF fixture created.')
