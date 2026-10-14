from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'test-output/fixture-deps'))
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as ReportLabFont
from fontTools.ttLib import TTFont
from fontTools.pens.reportLabPen import ReportLabPen

out=Path(__file__).resolve().parents[1]/'test-output'
font=TTFont(r'C:\Windows\Fonts\arial.ttf');glyphs=font.getGlyphSet();cmap=font.getBestCmap();units=font['head'].unitsPerEm
c=canvas.Canvas(str(out/'spaced-outlines.pdf'),pagesize=(612,792))
# A page-level transform remains active, matching the export failure's trigger.
c._code.append('0.75 0 0 -0.75 0 792 cm')
def outlined(text,x,y,size):
    for char in text:
        name=cmap[ord(char)];c.saveState();c.translate(x/.75,(792-y)/.75);c.scale(size/units/.75,-size/units/.75)
        path=c.beginPath();path.closePath=path.close;pen=ReportLabPen(glyphs,path);glyphs[name].draw(pen);c.drawPath(path,fill=1,stroke=0);c.restoreState();x+=font['hmtx'][name][0]*size/units
outlined('Separate fields stay put',60,710,20)
outlined('Name:',60,650,13);outlined('Alex Example',250,650,13)
outlined('Reference:',60,610,13);outlined('12345',250,610,13)
outlined('Each field saves when you click away.',60,550,13)
c.save()
pdfmetrics.registerFont(ReportLabFont('EmbeddedArial',r'C:\Windows\Fonts\arial.ttf'))
c=canvas.Canvas(str(out/'spaced-native.pdf'),pagesize=(612,792))
c.setFont('EmbeddedArial',13.5);c.drawString(60,650,'Name:'+' '*25+'Alex Example')
c.drawString(60,610,'Reference:'+' '*18+'12345');c.save()
print('Spaced native and transformed outline fixtures created.')
