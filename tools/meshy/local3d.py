"""Image to 3D model on this Mac, no quota: TRELLIS.2 (MIT) through the trellis-silicon port (PyTorch MPS).
Same interface as trellis.py, so the rest of the chain (simplify.mjs, flatten.py, rigto.py) does not change.
The plain background is cut away first, as in trellis.py; an image with real alpha skips TRELLIS.2's remover.

Usage:
  python3 tools/meshy/local3d.py in.png out.glb [seed]
  python3 tools/meshy/local3d.py --queue                    # the shared queue: ~/xcraft-3d/queue/inbox, see below
  python3 tools/meshy/local3d.py --queue in_dir [out_dir]   # every in_dir/*.png with no out_dir/<name>.glb yet
  python3 tools/meshy/local3d.py --gpu cmd args...          # any other GPU job (a Blender render) waits its turn
One GPU job at a time on this Mac: every mode takes ~/xcraft-3d/gpu.lock first and waits for it ("en attente du
GPU"); two jobs at once make the macOS watchdog cut the meshes.
Shared queue: drop <session>-<model>.json first ({"session", "model", "seed", "resolution": 512, "output": path}, all
optional), then <session>-<model>.png last (mv, so it is never read half-written). `--queue` processes the inbox
until it is empty, one model load for all, into queue/done/ (glb + log, glb also copied to "output") or
queue/failed/ (png + json + log), and appends one line to queue/recap.log.
Env: LOCAL3D_HOME (default ~/xcraft-3d/trellis-silicon), LOCAL3D_PIPELINE (512 | 1024 | 1024_cascade, default 512),
     LOCAL3D_TEXTURE (512 | 1024 | 2048, default 1024), BAKE_MAX_FACES (default 3000).
On the M1 Max 64 GB: 512 takes about 4 min and 16 GB; 1024 takes 10 min and 32 GB, and its mesh came out cut to a
sliver by the GPU watchdog with no error, so stay on 512.
Install: see the tools/meshy/ lines in README.md.
"""
import fcntl
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.expanduser("~/xcraft-3d")
QUEUE = os.path.join(ROOT, "queue")


def gpu_lock():
    """Blocks until this process is the only GPU job; the lock lasts as long as the returned file stays open."""
    os.makedirs(ROOT, exist_ok=True)
    f = open(os.path.join(ROOT, "gpu.lock"), "a+")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        f.seek(0)
        print(f"en attente du GPU (tenu par : {f.read().strip() or '?'})", flush=True)
        fcntl.flock(f, fcntl.LOCK_EX)
    f.seek(0)
    f.truncate()
    f.write(f"pid {os.getpid()} {' '.join(sys.argv)}\n")
    f.flush()
    return f


if sys.argv[1:2] == ["--gpu"]:
    lock = gpu_lock()
    sys.exit(subprocess.call(sys.argv[2:]))

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
loaded = {}


def pipeline_for(kind):
    if kind not in loaded:
        loaded.clear()  # one model in memory at a time: 16 GB at 512, 32 GB at 1024
        import gc
        import torch
        gc.collect()
        torch.mps.empty_cache()
        loaded[kind] = load_pipeline(kind)
        if os.environ.get("LOCAL3D_SYNC", "1") == "1":
            # The watchdog fires in the SLat decoders, after texture sampling: PyTorch packs a whole decoder pass
            # into a few long command buffers. A sync after each layer commits them one layer at a time.
            for key in ("shape_slat_decoder", "tex_slat_decoder"):
                for m in loaded[kind].models[key].modules():
                    if not list(m.children()):
                        m.register_forward_hook(lambda *_: torch.mps.synchronize())
    return loaded[kind]


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


def run(kind, src, dst, seed, journal=None):
    pipeline = pipeline_for(kind)
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
            result = generate_glb(pipeline, cut(src), seed=seed, pipeline_type=kind, texture_size=TEXTURE,
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
            if journal:
                journal.write(text)
        if result and b"ImpactingInteractivity" not in text:
            break
        if attempt == 3:
            raise RuntimeError(f"GPU watchdog cut the mesh in every attempt: {src}")
        print(f"GPU watchdog cut the mesh, retrying {src}", flush=True)
    os.replace(result["glb_path"], dst)
    print(f"local TRELLIS.2 {src} -> {dst} in {time.time() - start:.0f} s", flush=True)


def inbox():
    """Processes the shared queue until the inbox is empty (files dropped meanwhile are taken too)."""
    box, done, failed = (os.path.join(QUEUE, d) for d in ("inbox", "done", "failed"))
    for d in (box, done, failed):
        os.makedirs(d, exist_ok=True)
    ok, ko, start = [], [], time.time()
    while True:
        # A png younger than 10 s may still be arriving.
        pngs = [p for p in glob.glob(os.path.join(box, "*.png")) if time.time() - os.path.getmtime(p) > 10]
        if not pngs:
            break
        metas = {}
        for p in pngs:
            try:
                metas[p] = json.load(open(p[:-4] + ".json")) if os.path.exists(p[:-4] + ".json") else {}
            except ValueError as e:
                metas[p] = {"error": f"bad json: {e}"}
            if str(metas[p].get("resolution", PIPELINE)) not in ("512", "1024", "1024_cascade"):
                metas[p] = {"error": f"resolution must be 512, 1024 or 1024_cascade: {metas[p].get('resolution')}"}
        # The resolution already loaded first, so the model is swapped as rarely as possible.
        png = min(pngs, key=lambda p: (str(metas[p].get("resolution", PIPELINE)) not in loaded, p))
        meta, name = metas[png], os.path.basename(png)[:-4]
        glb = os.path.join(done, name + ".glb")
        with open(os.path.join(QUEUE, name + ".log"), "wb") as journal:  # moved once the job ends: a kill leaves no log in done/
            journal.write(f"{time.strftime('%Y-%m-%d %H:%M')} {json.dumps(meta)}\n".encode())
            try:
                if "error" in meta:
                    raise ValueError(meta["error"])
                run(str(meta.get("resolution", PIPELINE)), png, glb, int(meta.get("seed", 0)), journal)
                if meta.get("output"):
                    out = os.path.expanduser(meta["output"])
                    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
                    shutil.copy(glb, out)
                ok.append(name)
            except Exception as e:  # a failed image must not stop the night's queue
                journal.write(f"FAILED: {e}\n".encode())
                print(f"FAILED {png}: {e}", flush=True)
                ko.append(name)
        dest = done if ko[-1:] != [name] else failed
        for f in (png, png[:-4] + ".json", os.path.join(QUEUE, name + ".log")):
            if os.path.exists(f):
                shutil.move(f, os.path.join(dest, os.path.basename(f)))
    line = (f"{time.strftime('%Y-%m-%d %H:%M')} queue: {len(ok)} done, {len(ko)} failed"
            f"{' (' + ', '.join(ko) + ')' if ko else ''} in {(time.time() - start) / 60:.0f} min")
    print(line, flush=True)
    with open(os.path.join(QUEUE, "recap.log"), "a") as f:
        f.write(line + "\n")


args = sys.argv[1:]
lock = gpu_lock()
if args == ["--queue"]:
    inbox()
    sys.exit()
if args[:1] == ["--queue"]:
    src_dir = args[1]
    out_dir = args[2] if len(args) > 2 else src_dir
    jobs = [(p, os.path.join(out_dir, os.path.splitext(os.path.basename(p))[0] + ".glb"))
            for p in sorted(glob.glob(os.path.join(src_dir, "*.png")))]
    jobs = [j for j in jobs if not os.path.exists(j[1])]
else:
    jobs = [(args[0], args[1])]
seed = int(args[2]) if args[:1] != ["--queue"] and len(args) > 2 else 0

for src, dst in jobs:
    try:
        run(PIPELINE, src, dst, seed)
    except Exception as e:  # a failed image must not stop the night's queue
        if len(jobs) == 1:
            raise
        print(f"FAILED {src}: {e}", flush=True)
