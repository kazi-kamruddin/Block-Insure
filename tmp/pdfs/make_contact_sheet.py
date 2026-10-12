from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

src = Path(r"E:\4-1\4100 thesis\project\Block-Insure\tmp\pdfs\rendered-supervisor")
out_dir = src.parent
files = sorted(src.glob("page-*.png"))
thumb_w = 300
gap = 16
cols = 3
for batch_index in range(0, len(files), 9):
    batch = files[batch_index:batch_index + 9]
    thumbs = []
    for path in batch:
        image = Image.open(path).convert("RGB")
        ratio = thumb_w / image.width
        thumb = image.resize((thumb_w, int(image.height * ratio)))
        thumb = ImageOps.expand(thumb, border=2, fill="#9AA8B2")
        canvas = Image.new("RGB", (thumb.width, thumb.height + 24), "white")
        canvas.paste(thumb, (0, 24))
        ImageDraw.Draw(canvas).text((8, 5), path.stem, fill="#15283B")
        thumbs.append(canvas)
    rows = (len(thumbs) + cols - 1) // cols
    cell_h = max(item.height for item in thumbs)
    sheet = Image.new("RGB", (cols * (thumb_w + 4) + (cols - 1) * gap, rows * cell_h + (rows - 1) * gap), "#DCE3E8")
    for index, thumb in enumerate(thumbs):
        x = (index % cols) * (thumb_w + 4 + gap)
        y = (index // cols) * (cell_h + gap)
        sheet.paste(thumb, (x, y))
    sheet.save(out_dir / f"supervisor-contact-{batch_index // 9 + 1}.png")
