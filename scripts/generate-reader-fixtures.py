"""Public, authored fixtures only. No private course content."""
from pathlib import Path
import hashlib
import io
import json
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/reader'
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path('C:/Windows/Fonts/msyh.ttc')
pdfmetrics.registerFont(TTFont('ReaderChinese', str(FONT), subfontIndex=0))

def page(c, n, w, h, label='公开自制验证夹具'):
    c.setPageSize((w, h))
    c.setFont('ReaderChinese', 22)
    c.drawString(45, h-60, f'{label} · 第 {n} 页')
    c.setFont('ReaderChinese', 16)
    c.drawString(45, h-115, '单行中文选择：学习资料保留原版面。')
    c.drawString(45, h-150, '跨行中文第一行：框选公式、图形和表格。')
    c.drawString(45, h-180, '跨行中文第二行：批注跟随页面坐标。')
    c.setFont('Helvetica', 20)
    c.drawString(45, h-230, 'E = mc')
    c.setFont('Helvetica', 12)
    c.drawString(119, h-220, '2')
    c.setStrokeColorRGB(.1, .5, .35)
    for x, y in [(45, 60), (w*.45, h*.4), (w-120, h-110)]:
        c.rect(x, y, 65, 35)
    c.circle(w-120, h-230, 38)
    c.setFont('ReaderChinese', 10)
    for row in range(4):
        for col in range(8):
            x, y = 45+col*(w-90)/8, 105+row*28
            c.rect(x, y, (w-90)/8, 28)
            c.drawString(x+4, y+8, f'表 {row+1}-{col+1}')
    c.showPage()

for name, label in [('mixed.pdf','公开自制验证夹具'), ('same-name-v2.pdf','内容不同的第二版本')]:
    c = canvas.Canvas(str(OUT/name), invariant=1)
    page(c, 1, 800, 600, label)
    page(c, 2, 600, 800, label)
    image = Image.new('RGB', (800, 600), '#f5eee2')
    d = ImageDraw.Draw(image)
    f = ImageFont.truetype(str(FONT), 28)
    d.text((50, 80), '图片页：没有文字层，请框选此区域。', fill='black', font=f)
    d.rectangle((100, 200, 600, 400), outline='#22745e', width=4)
    png = io.BytesIO(); image.save(png, format='PNG'); png.seek(0)
    from reportlab.lib.utils import ImageReader
    c.setPageSize((800,600)); c.drawImage(ImageReader(png),0,0,800,600); c.showPage(); c.save()
c = canvas.Canvas(str(OUT/'representative-12p.pdf'), invariant=1)
for n in range(1,13): page(c,n,800,600,'代表性课程小样（非真实课件）')
c.save()
prs = Presentation(); prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
for n in range(1,6):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(.5), Inches(.5), Inches(9), Inches(2))
    box.text_frame.text = f'公开自制 PPTX 小样 第 {n} 页\n中文、公式 E = mc²、图形与宽表格'
    for p in box.text_frame.paragraphs:
        for run in p.runs: run.font.name='Microsoft YaHei'; run.font.size=Pt(24)
    slide.shapes.add_shape(9, Inches(1), Inches(3), Inches(2), Inches(1))
    table=slide.shapes.add_table(3,6, Inches(.5), Inches(5), Inches(9), Inches(1.5)).table
    for i in range(3):
        for j in range(6): table.cell(i,j).text=f'单元 {i+1}-{j+1}'
prs.save(str(OUT/'representative-5p.pptx'))
(OUT/'corrupt.pdf').write_bytes(b'%PDF-1.7\ninvalid fixture')
files=[]
for p in sorted(OUT.iterdir()):
    if p.suffix not in ['.pdf','.pptx']: continue
    files.append({'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'source':'authored public fixture','permission':'CC0-1.0; generated fixture content only; system fonts not redistributed','pages': 12 if '12p' in p.name else 5 if p.suffix=='.pptx' else None if 'corrupt' in p.name else 3,'textLayer': 'PDF pages 1-2 yes, page 3 image only' if p.name in ['mixed.pdf','same-name-v2.pdf'] else 'not yet verified' })
(OUT/'manifest.json').write_text(json.dumps(files,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(files,ensure_ascii=False,indent=2))
