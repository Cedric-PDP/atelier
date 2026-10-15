# Réduit les illustrations téléchargées en WebP de 260 px de large au plus (qualité 68).
# Usage : python -E -P scripts/thumbs.py <jobs.json>   où jobs.json = [[source, destination.webp], ...]
import json
import sys

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 60_000_000  # refuse les images démesurées

def main(job_file):
    with open(job_file, encoding="utf-8") as f:
        jobs = json.load(f)
    ok = bad = 0
    for src, dest in jobs:
        try:
            with Image.open(src) as im:
                im = ImageOps.exif_transpose(im)
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA" if "transparency" in im.info or im.mode in ("LA", "P") else "RGB")
                im.thumbnail((260, 380))
                im.save(dest, "WEBP", quality=68, method=6)
            ok += 1
        except Exception as e:  # image illisible : la carte gardera son cadre sans illustration
            bad += 1
            print(f"illisible : {src} ({e.__class__.__name__})", file=sys.stderr)
    print(f"{ok} vignettes WebP, {bad} illisibles")

if __name__ == "__main__":
    main(sys.argv[1])
