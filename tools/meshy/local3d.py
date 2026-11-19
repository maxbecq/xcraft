"""Image to 3D model on this Mac, no quota: TRELLIS.2 (MIT) through the trellis-silicon port (PyTorch MPS).
Same interface as trellis.py, so the rest of the chain (simplify.mjs, flatten.py, rigto.py) does not change.
The background and its drop shadow are removed by TRELLIS.2's BiRefNet; an image with real alpha keeps it.

Usage:
  python3 tools/meshy/local3d.py in.png out.glb [seed]
  python3 tools/meshy/local3d.py --queue                    # the shared queue: ~/xcraft-3d/queue/inbox, see below
  python3 tools/meshy/local3d.py --queue in_dir [out_dir]   # every in_dir/*.png with no out_dir/<name>.glb yet
  python3 tools/meshy/local3d.py --gpu cmd args...          # any other GPU job (a Blender render) waits its turn
One GPU job at a time on this Mac: every mode takes ~/xcraft-3d/gpu.lock first and waits for it ("en attente du
GPU"); two jobs at once make the macOS watchdog cut the meshes.
Shared queue: drop <session>-<model>.json first ({"session", "model", "seed", "resolution": 512, "output": path}, all
optional), then <session>-<model>.png last (mv, so it is never read half-written). `--queue` processes the inbox
until it is empty, into queue/done/ (glb + log, glb also copied to "output") or
queue/failed/ (png + json + log), and appends one line to queue/recap.log.
Env: LOCAL3D_HOME (default ~/xcraft-3d/trellis-silicon), LOCAL3D_PIPELINE (512 | 1024 | 1024_cascade, default 512),
     LOCAL3D_TEXTURE (512 | 1024 | 2048, default 1024), BAKE_MAX_FACES (default 3000),
     LOCAL3D_STEPS (sampler steps, default 12), LOCAL3D_COLOR_MATCH (1: baked colours moved toward the input).
On the M1 Max 64 GB: 512 takes about 4 min and 16 GB; 1024 takes 10 min and 32 GB, and its mesh came out cut to a
sliver by the GPU watchdog with no error, so stay on 512.
Each attempt at each image runs in a fresh child process (--one), which loads the model and exits: MPS memory
leaks from one generation to the next in a single process (out of memory after two jobs), and an exit frees it all.
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
import threading
import time

ROOT = os.path.expanduser(os.environ.get("LOCAL3D_ROOT", "~/xcraft-3d"))  # lock and queue
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
PIPELINE = os.environ.get("LOCAL3D_PIPELINE", "512")
TEXTURE = int(os.environ.get("LOCAL3D_TEXTURE", "1024"))
CUT = 3  # child exit code: the GPU watchdog cut the mesh


def one(src, dst, seed):
    """Child: one attempt, in the port's venv. Exit 0, CUT, or an error."""
    parent = int(os.environ.get("LOCAL3D_PARENT", os.getppid()))

    def orphan_guard():  # a killed queue must not leave its child holding the GPU
        while os.getppid() == parent:
            time.sleep(5)
        os._exit(1)
    threading.Thread(target=orphan_guard, daemon=True).start()
    if os.path.realpath(sys.prefix) != os.path.realpath(os.path.join(HOME, ".venv")):
        os.execv(VENV_PY, [VENV_PY, os.path.abspath(__file__), "--one", src, dst, str(seed)])
    # The macOS GPU watchdog kills the decoder's long Metal kernels at random (an empty mesh, seen on this M1 Max at
    # 512 and 1024); Metal capture mode extends its timeout. Must be set before torch loads Metal.
    os.environ.setdefault("MTL_CAPTURE_ENABLED", "1")
    # Texture baked straight onto a light mesh: Blender's decimation (simplify.mjs) stalls near 12 700 faces on the
    # raw 190 000-face output (non-manifold edges).
    os.environ.setdefault("BAKE_MAX_FACES", "3000")
    from PIL import Image
    from trellis_silicon.core import WatchdogEmptyMeshError, generate_glb, load_pipeline
    import torch  # after trellis_silicon.core, which sets PYTORCH_ENABLE_MPS_FALLBACK (segment_reduce has no MPS kernel)

    # No colour cut: TRELLIS.2's own remover (BiRefNet) gets the plain image. A corner flood fill left the drop
    # shadows, which TRELLIS modelled as dark sheets, and a chroma cut ate grey, white or brown parts of the object;
    # BiRefNet kept the object and dropped the shadow on all 53 concepts tried (Meshy sketches, the queue's images).
    im = Image.open(src)
    im = im if im.mode == "RGBA" and im.getextrema()[3][0] < 255 else im.convert("RGB")  # real alpha is kept
    pipeline = load_pipeline(PIPELINE)
    if os.environ.get("LOCAL3D_SYNC", "1") == "1":
        # The watchdog fires in the SLat decoders, after texture sampling: PyTorch packs a whole decoder pass
        # into a few long command buffers. A sync after each layer commits them one layer at a time.
        for k in ("shape_slat_decoder", "tex_slat_decoder"):
            for m in pipeline.models[k].modules():
                if not list(m.children()):
                    m.register_forward_hook(lambda *_: torch.mps.synchronize())
    try:
        result = generate_glb(pipeline, im, seed=seed, pipeline_type=PIPELINE, texture_size=TEXTURE,
                              output_base=os.path.join(tempfile.mkdtemp(), "out"),
                              steps=int(os.environ.get("LOCAL3D_STEPS", 0)) or None,  # 0: the pipeline's 12
                              color_match=os.environ.get("LOCAL3D_COLOR_MATCH") == "1")  # bake toward the input's colours
    except WatchdogEmptyMeshError:
        sys.exit(CUT)
    os.replace(result["glb_path"], dst)


def run(kind, src, dst, seed, journal=None):
    """Up to 4 child attempts; the watchdog often leaves half a mesh with no exception, only its message on stderr."""
    start = time.time()
    for attempt in range(4):
        child = subprocess.Popen([VENV_PY, os.path.abspath(__file__), "--one", src, dst, str(seed)],
                                 env=dict(os.environ, LOCAL3D_PIPELINE=kind, LOCAL3D_PARENT=str(os.getpid())),
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        cut = False
        for line in child.stdout:
            sys.stdout.buffer.write(line)
            sys.stdout.flush()
            if journal:
                journal.write(line)
            cut = cut or b"ImpactingInteractivity" in line
        code = child.wait()
        if code == 0 and not cut:
            print(f"local TRELLIS.2 {src} -> {dst} in {time.time() - start:.0f} s", flush=True)
            return
        if code not in (0, CUT):
            raise RuntimeError(f"child exit {code}: {src}")
        if os.path.exists(dst):
            os.remove(dst)
        if journal:
            journal.write(b"GPU watchdog cut the mesh, retrying\n")
        print(f"GPU watchdog cut the mesh, retrying {src}", flush=True)
    raise RuntimeError(f"GPU watchdog cut the mesh in every attempt: {src}")


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
        png = min(pngs)
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
if args[:1] == ["--one"]:
    one(args[1], args[2], int(args[3]))
    sys.exit()
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
