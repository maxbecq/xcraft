"""Image to 3D model through the TRELLIS Hugging Face Space (MIT licence), a free alternative to Meshy.
The image's plain background is cut away first (flooded from the corners), or TRELLIS models it as grey
slabs round the figure. Uses the HF_TOKEN in the environment (a free account's ZeroGPU quota).
Usage: python3 tools/meshy/trellis.py in.png out.glb [seed]   (needs: pip install gradio_client pillow)
"""
import os
import shutil
import sys
import tempfile
import time

from gradio_client import Client, handle_file
from PIL import Image, ImageDraw, ImageFilter

src, dst = sys.argv[1:3]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
start = time.time()

im = Image.open(src).convert("RGB")
flood = im.copy()
KEY = (255, 0, 255)
for corner in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
    ImageDraw.floodfill(flood, corner, KEY, thresh=18)
alpha = Image.new("L", im.size, 255)
alpha.putdata([0 if p == KEY else 255 for p in flood.getdata()])
im.putalpha(alpha.filter(ImageFilter.MinFilter(3)))
cut = os.path.join(tempfile.mkdtemp(), "cut.png")
im.save(cut)

client = Client("trellis-community/TRELLIS", token=os.environ["HF_TOKEN"], verbose=False)
client.predict(api_name="/start_session")
_, _, glb = client.predict(
    image=handle_file(cut), multiimages=[], seed=seed, ss_guidance_strength=7.5, ss_sampling_steps=12,
    slat_guidance_strength=3.0, slat_sampling_steps=12, multiimage_algo="stochastic",
    mesh_simplify=0.95, texture_size=1024, api_name="/generate_and_extract_glb",
)
shutil.copy(glb if isinstance(glb, str) else glb["path"], dst)
print(f"TRELLIS {src} -> {dst} in {time.time() - start:.0f} s")
