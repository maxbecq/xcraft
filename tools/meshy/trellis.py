"""Image to 3D model through the TRELLIS Hugging Face Space (MIT licence), a free alternative to Meshy.
Uses the HF_TOKEN in the environment (a free account's ZeroGPU quota). Prints the time it took.
Usage: python3 tools/meshy/trellis.py in.png out.glb [seed]   (needs: pip install gradio_client)
"""
import os
import shutil
import sys
import time

from gradio_client import Client, handle_file

src, dst = sys.argv[1:3]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
start = time.time()
client = Client("trellis-community/TRELLIS", token=os.environ["HF_TOKEN"], verbose=False)
client.predict(api_name="/start_session")
_, _, glb = client.predict(
    image=handle_file(src), multiimages=[], seed=seed, ss_guidance_strength=7.5, ss_sampling_steps=12,
    slat_guidance_strength=3.0, slat_sampling_steps=12, multiimage_algo="stochastic",
    mesh_simplify=0.95, texture_size=1024, api_name="/generate_and_extract_glb",
)
shutil.copy(glb if isinstance(glb, str) else glb["path"], dst)
print(f"TRELLIS {src} -> {dst} in {time.time() - start:.0f} s")
