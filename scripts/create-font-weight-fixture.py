from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'test-output/fixture-deps'))
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as ReportLabFont
from fontTools.ttLib import TTFont
from fontTools.pens.reportLabPen import ReportLabPen
from fontTools.pens.boundsPen import BoundsPen
out=Path(__file__).resolve().parents[1]/'test-output';records=[]
c=canvas.Canvas(str(out/'font-weight-outlines.pdf'),pagesize=(612,792))
samples=[('Name:',True,48,700,False),('Jamie Morgan',False,190,700,False),('Regular weight',False,48,650,False),('Bold weight',True,48,600,False),('11',False,48,550,False),('11',True,190,550,False),('Reference:',True,48,500,False),('Sample Name',False,190,500,False),('Regular gray text',False,48,450,True),('Bold gray text',True,48,400,True)]
for text,bold,x,y,gray in samples:
    font=TTFont(r'C:\Windows\Fonts\arialbd.ttf' if bold else r'C:\Windows\Fonts\arial.ttf');glyphs=font.getGlyphSet();cmap=font.getBestCmap();units=font['head'].unitsPerEm;size=10.875;boxes=[]
    c.setFillColorRGB(.45,.45,.45) if gray else c.setFillColorRGB(0,0,0)
    for char in text:
        name=cmap[ord(char)];bounds=BoundsPen(glyphs);glyphs[name].draw(bounds)
        if bounds.bounds:
            a,b,r,t=bounds.bounds;boxes.append((x+a*size/units,y+b*size/units,x+r*size/units,y+t*size/units))
        c.saveState();c.translate(x,y);c.scale(size/units,size/units);path=c.beginPath();path.closePath=path.close;glyphs[name].draw(ReportLabPen(glyphs,path));c.drawPath(path,fill=1,stroke=0);c.restoreState();x+=font['hmtx'][name][0]*size/units
    a=min(b[0] for b in boxes);b=min(b[1] for b in boxes);r=max(b[2] for b in boxes);t=max(b[3] for b in boxes)
    records.append({'text':text,'confidence':100,'bold':bold,'rect':{'x':a,'y':792-t,'w':r-a,'h':t-b}})
c.save();(out/'font-weight-lines.json').write_text(json.dumps(records))
for name,path in [('OriginalRegular',r'C:\Windows\Fonts\arial.ttf'),('OriginalBold',r'C:\Windows\Fonts\arialbd.ttf')]:pdfmetrics.registerFont(ReportLabFont(name,path))
c=canvas.Canvas(str(out/'font-weight-native.pdf'),pagesize=(612,792))
for name,y,text in [('OriginalRegular',700,'Regular text 12345.'),('OriginalBold',660,'Bold text 12345.')]:c.setFont(name,10.875);c.drawString(48,y,text)
c.save();print('Regular, bold, mixed-label/name, gray and native font-weight fixtures created.')
