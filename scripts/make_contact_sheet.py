"""Create contact sheets from PDF page PNGs. Requires Pillow."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    files = sorted(args.input_dir.glob("page-*.png"))
    if not files:
        parser.error("Input directory contains no page-*.png files")
    output_dir = args.output_dir or args.input_dir.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    width, gap, columns = 300, 16, 3
    for batch_index in range(0, len(files), 9):
        thumbnails = []
        for source in files[batch_index:batch_index + 9]:
            with Image.open(source) as image:
                image = image.convert("RGB")
                thumb = image.resize((width, int(image.height * width / image.width)))
            thumb = ImageOps.expand(thumb, border=2, fill="#9AA8B2")
            canvas = Image.new("RGB", (thumb.width, thumb.height + 24), "white")
            canvas.paste(thumb, (0, 24))
            ImageDraw.Draw(canvas).text((8, 5), source.stem, fill="#15283B")
            thumbnails.append(canvas)
        rows = (len(thumbnails) + columns - 1) // columns
        height = max(item.height for item in thumbnails)
        sheet = Image.new("RGB", (columns * (width + 4) + (columns - 1) * gap,
                                  rows * height + (rows - 1) * gap), "#DCE3E8")
        for index, thumb in enumerate(thumbnails):
            sheet.paste(thumb, ((index % columns) * (width + 4 + gap),
                               (index // columns) * (height + gap)))
        sheet.save(output_dir / f"supervisor-contact-{batch_index // 9 + 1}.png")


if __name__ == "__main__":
    main()
