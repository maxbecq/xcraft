"""Saves what tools/sprites/bake.html posts (PNG and JSON) into a folder.

Usage: python3 tools/sprites/receive.py OUT_DIR [PORT]
"""
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
os.makedirs(OUT, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        name = os.path.basename(self.path)
        data = self.rfile.read(int(self.headers["Content-Length"]))
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
        self.send_response(200)
        self.cors()
        self.end_headers()
        print("saved", name, len(data), flush=True)


HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
