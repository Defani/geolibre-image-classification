"""Static server with CORS and byte ranges, for loading the plugin and test GeoTIFFs into web.geolibre.app.

python tools/serve.py <port> <dir> [<dir> ...]   -> /<n>/path serves from the n-th dir (0-based); /plugin/... from the first.
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
ROOTS = [os.path.abspath(d) for d in sys.argv[2:]]


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split("?", 1)[0]
        m = re.match(r"^/(\d+)/(.*)$", path)
        root, rest = (ROOTS[int(m.group(1))], m.group(2)) if m and int(m.group(1)) < len(ROOTS) else (ROOTS[0], path.lstrip("/"))
        full = os.path.abspath(os.path.join(root, *[p for p in rest.split("/") if p not in ("", ".", "..")]))
        return full if full.startswith(root) else root

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            self.wfile.write(f.read(end - start + 1))

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
