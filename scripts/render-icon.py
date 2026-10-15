"""Draw the Rustbox app icon. Run from the repo root before `npm run tauri icon`."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

draw.rounded_rectangle((64, 64, 960, 960), radius=190, fill=(224, 122, 61, 255))
draw.rounded_rectangle((220, 230, 804, 820), radius=64, fill=(255, 247, 240, 255))
draw.rounded_rectangle((220, 230, 392, 820), radius=64, fill=(28, 22, 18, 255))
draw.rectangle((300, 230, 392, 820), fill=(28, 22, 18, 255))

for index, top in enumerate((330, 470, 610)):
    fill = (224, 122, 61, 255) if index == 0 else (140, 122, 110, 255)
    draw.ellipse((268, top, 332, top + 64), fill=fill)

destination = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "source.png"
destination.parent.mkdir(parents=True, exist_ok=True)
image.save(destination)
print(destination)
