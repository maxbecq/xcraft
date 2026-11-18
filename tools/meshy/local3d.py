"""Image to 3D model on this Mac, no quota: TRELLIS.2 (MIT) through the trellis-silicon port (PyTorch MPS).
Same interface as trellis.py, so the rest of the chain (simplify.mjs, flatten.py, rigto.py) does not change.
The plain background is cut away first, as in trellis.py; an image with real alpha skips TRELLIS.2's remover.

Usage:
  python3 tools/meshy/local3d.py in.png out.glb [seed]
  python3 tools/meshy/local3d.py --queue in_dir [out_dir]   # every in_dir/*.png with no out_dir/<name>.glb yet,
                                                             # one model load for all (night runs)
Env: LOCAL3D_HOME (default ~/xcraft-3d/trellis-silicon), LOCAL3D_PIPELINE (512 | 1024 | 1024_cascade, default 512),
     LOCAL3D_TEXTURE (512 | 1024 | 2048, default 1024), BAKE_MAX_FACES (default 3000).
On the M1 Max 64 GB: 512 takes about 4 min and 16 GB; 1024 takes 10 min and 32 GB, and its mesh came out cut to a
sliver by the GPU watchdog with no error, so stay on 512.
Install: see the "Local image to 3D" lines in tools/README.md.
"""
import glob
import os
import sys
import tempfile
import time

HOME = os.path.expanduser(os.environ.get("LOCAL3D_HOME", "~/xcraft-3d/trellis-silicon"))
VENV_PY = os.path.join(HOME, ".venv", "bin", "python")
if os.path.realpath(sys.prefix) != os.path.realpath(os.path.join(HOME, ".venv")):
    os.execv(VENV_PY, [VENV_PY, os.path.abspath(__file__), *sys.argv[1:]])  # run inside the port's venv

# The macOS GPU watchdog kills the decoder's long Metal kernels at random (an empty mesh, seen on this M1 Max at
# 512 and 1024); Metal capture mode extends its timeout. Must be set before torch loads Metal.
os.environ.setdefault("MTL_CAPTURE_ENABLED", "1")
# Texture baked straight onto a light mesh: Blender's decimation (simplify.mjs) stalls near 12 700 faces on the
# raw 190 000-face output (non-manifold edges).
os.environ.setdefault("BAKE_MAX_FACES", "3000")

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402
from trellis_silicon.core import WatchdogEmptyMeshError, generate_glb, load_pipeline  # noqa: E402  (MPS env before torch)

PIPELINE = os.environ.get("LOCAL3D_PIPELINE", "512")
TEXTURE = int(os.environ.get("LOCAL3D_TEXTURE", "1024"))


def cut(path):
    """The plain background flooded from the corners becomes alpha (same as trellis.py)."""
    im = Image.open(path).convert("RGB")
    flood = im.copy()
    key = (255, 0, 255)
    for corner in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
        ImageDraw.floodfill(flood, corner, key, thresh=18)
    alpha = Image.new("L", im.size, 255)
    alpha.putdata([0 if p == key else 255 for p in flood.getdata()])
    im.putalpha(alpha.filter(ImageFilter.MinFilter(3)))
    return im


def run(pipeline, src, dst, seed):
    start = time.time()
    base = os.path.join(tempfile.mkdtemp(), "out")
    for attempt in range(4):
        # The watchdog only prints to stderr (from Metal, not Python) and often leaves half a mesh with no
        # exception, so stderr is caught at the file descriptor and read for its message.
        log = tempfile.TemporaryFile()
        saved = os.dup(2)
        sys.stderr.flush()
        os.dup2(log.fileno(), 2)
        try:
            result = generate_glb(pipeline, cut(src), seed=seed, pipeline_type=PIPELINE, texture_size=TEXTURE,
                                  output_base=base)
        except WatchdogEmptyMeshError:
            result = None
        finally:
            sys.stderr.flush()
            os.dup2(saved, 2)
            os.close(saved)
            log.seek(0)
            text = log.read()
            os.write(2, text)
        if result and b"ImpactingInteractivity" not in text:
            break
        if attempt == 3:
            raise RuntimeError(f"GPU watchdog cut the mesh in every attempt: {src}")
        print(f"GPU watchdog cut the mesh, retrying {src}", flush=True)
    os.replace(result["glb_path"], dst)
    print(f"local TRELLIS.2 {src} -> {dst} in {time.time() - start:.0f} s", flush=True)


args = sys.argv[1:]
if args[:1] == ["--queue"]:
    src_dir = args[1]
    out_dir = args[2] if len(args) > 2 else src_dir
    jobs = [(p, os.path.join(out_dir, os.path.splitext(os.path.basename(p))[0] + ".glb"))
            for p in sorted(glob.glob(os.path.join(src_dir, "*.png")))]
    jobs = [j for j in jobs if not os.path.exists(j[1])]
else:
    jobs = [(args[0], args[1])]
seed = int(args[2]) if args[:1] != ["--queue"] and len(args) > 2 else 0

pipeline = load_pipeline(PIPELINE)
for src, dst in jobs:
    try:
        run(pipeline, src, dst, seed)
    except Exception as e:  # a failed image must not stop the night's queue
        if len(jobs) == 1:
            raise
        print(f"FAILED {src}: {e}", flush=True)
