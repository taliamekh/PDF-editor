from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'test-output/fixture-deps'))
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as ReportLabFont
from fontTools.ttLib import TTFont
from fontTools.pens.reportLabPen import ReportLabPen
from fontTools.pens.boundsPen import BoundsPen
out=Path(__file__).resolve().parents[1]/'test-output'
c=canvas.Canvas(str(out/'font-style-outlines.pdf'),pagesize=(612,792));records=[]
samples=[('Regular date 2026-10-14',False,710),('11',False,660),('Ref:',False,610),('Italic reference line',True,550),('11',True,500),('Actual italic text',True,450)]
for text,italic,y in samples:
    font=TTFont(r'C:\Windows\Fonts\ariali.ttf' if italic else r'C:\Windows\Fonts\arial.ttf');glyphs=font.getGlyphSet();cmap=font.getBestCmap();units=font['head'].unitsPerEm;size=14;x=60;boxes=[]
    for char in text:
        name=cmap[ord(char)];bounds=BoundsPen(glyphs);glyphs[name].draw(bounds)
        if bounds.bounds:
            a,b,r,t=bounds.bounds;boxes.append((x+a*size/units,y+b*size/units,x+r*size/units,y+t*size/units))
        c.saveState();c.translate(x,y);c.scale(size/units,size/units);path=c.beginPath();path.closePath=path.close;glyphs[name].draw(ReportLabPen(glyphs,path));c.drawPath(path,fill=1,stroke=0);c.restoreState();x+=font['hmtx'][name][0]*size/units
    a=min(b[0] for b in boxes);b=min(b[1] for b in boxes);r=max(b[2] for b in boxes);t=max(b[3] for b in boxes)
    records.append({'text':text,'confidence':100,'italic':italic,'rect':{'x':a,'y':792-t,'w':r-a,'h':t-b}})
c.save();(out/'font-style-lines.json').write_text(json.dumps(records))
pdfmetrics.registerFont(ReportLabFont('OriginalItalic',r'C:\Windows\Fonts\ariali.ttf'))
c=canvas.Canvas(str(out/'font-style-native.pdf'),pagesize=(612,792));c.setFont('OriginalItalic',14);c.drawString(60,710,'Italic text 12345.');c.save()
print('Upright and italic font-style fixtures created.')
