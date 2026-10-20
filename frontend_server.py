"""Static frontend plus same-origin API proxy. No external packages."""
import argparse
from http.client import HTTPConnection
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

FRONTEND = Path(__file__).resolve().parent / "frontend"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def proxy(self):
        connection = HTTPConnection("127.0.0.1", self.server.api_port, timeout=15)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 <= size <= 100000:
                self.send_error(413)
                return
            headers = {k: self.headers[k] for k in ["Content-Type", "Origin"] if k in self.headers}
            connection.request(self.command, self.path, body=self.rfile.read(size) if size else None, headers=headers)
            response = connection.getresponse()
            data = response.read()
            self.send_response(response.status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (OSError, ValueError):
            self.send_error(502, "Backend unavailable")
        finally:
            connection.close()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.proxy()
        if self.path == "/health":
            data = b'{"app":"typeflow-frontend","ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        # Do not expose directory listings or any backend/data files.
        path = (FRONTEND / urlparse(self.path).path.lstrip("/")).resolve()
        if not path.is_relative_to(FRONTEND) or (path.is_dir() and path != FRONTEND):
            return self.send_error(404)
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.proxy()
        self.send_error(404)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--api-port", type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.api_port = args.api_port
    print(f"Frontend ready: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()
