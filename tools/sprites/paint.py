"""Paints a building's sprite from its reference render, through Mistral's conversations API (image_generation tool).
The model sees the render and draws a new picture after it: not pixel-tied, so the result is re-fitted afterwards
(fit.py). Key from MISTRAL_API_KEY, never printed.

Usage: python3 tools/sprites/paint.py REF.png OUT.png "what the building is"
"""
import base64
import io
import json
import os
import sys
import urllib.request

KEY = os.environ["MISTRAL_API_KEY"]
API = "https://api.mistral.ai/v1"

PROMPT = """Here is a 3D render of a building from my real-time strategy game, seen from the game's fixed camera.
Generate ONE new image: a hand-painted game sprite of THIS SAME building ({what}).
Strict rules:
- a faithful repaint, like a paint-over of the render: exactly the same design, do NOT invent, add or remove parts (no extra guns, dishes, antennas);
- exactly the same camera: seen from HIGH above at 35 degrees, isometric-like, the roof largely visible, the bottom edge of the base seen from above; same orientation, silhouette and proportions, centred, the whole building visible;
- painted style of a classic 2000s RTS (StarCraft / Warcraft III concept art), crisp readable shapes, strong light from the upper left, soft ambient occlusion at the base;
- rusted orange-brown steel plates, rivets, dark gunmetal, glowing cyan lights and screens;
- pure saturated BLUE only on the few panels that are blue in the render (team colour), nowhere else; lights are cyan, not blue;
- plain flat pure white background, no ground, no shadow on the ground, no text, no frame."""


def call(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    req.add_header("Authorization", f"Bearer {KEY}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def file_ids(node):
    if isinstance(node, dict):
        if node.get("type") == "tool_file" and node.get("file_id"):
            yield node["file_id"]
        for v in node.values():
            yield from file_ids(v)
    elif isinstance(node, list):
        for v in node:
            yield from file_ids(v)


ref, out, what = sys.argv[1], sys.argv[2], sys.argv[3]
# The render on white, as the model is asked to paint it.
from PIL import Image  # noqa: E402

im = Image.open(ref).convert("RGBA")
bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
bg.alpha_composite(im)
buf = io.BytesIO()
bg.convert("RGB").save(buf, "PNG")
data = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
inputs = [{"role": "user", "content": [{"type": "text", "text": PROMPT.format(what=what)}, {"type": "image_url", "image_url": data}]}]
res = json.loads(call(f"{API}/conversations", {"model": "mistral-medium-latest", "inputs": inputs, "tools": [{"type": "image_generation"}], "store": False}))
ids = list(file_ids(res))
if ids:
    open(out, "wb").write(call(f"{API}/files/{ids[0]}/content"))
    print("ok", out)
    sys.exit(0)
urls = [json.loads(o["info"]["result"]).get("url") for o in res.get("outputs", []) if o.get("type") == "tool.execution" and o.get("info", {}).get("result")]
urls = [u for u in urls if u]
if not urls:
    print("no image:", json.dumps(res)[:500])
    sys.exit(1)
with urllib.request.urlopen(urls[0], timeout=120) as r:
    open(out, "wb").write(r.read())
print("ok", out)
