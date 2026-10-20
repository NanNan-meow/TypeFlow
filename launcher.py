"""Start and supervise both servers, reuse a running instance, open the user's browser."""
import argparse
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent


def health(port, path, expected):
    try:
        with urlopen(f"http://127.0.0.1:{port}{path}", timeout=.5) as response:
            return json.load(response).get("app") == expected
    except Exception:
        return False


def find_pair():
    for port in range(8765, 8865, 2):
        sockets = []
        try:
            for candidate in (port, port + 1):
                s = socket.socket()
                sockets.append(s)
                if sys.platform == "win32":
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                s.bind(("127.0.0.1", candidate))
            return port, port + 1
        except OSError:
            continue
        finally:
            for s in sockets:
                s.close()
    raise RuntimeError("No available local port pair (8765-8864).")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    runtime = ROOT / "data" / "runtime.json"
    try:
        previous = json.loads(runtime.read_text())
        port, api_port = previous["frontend"], previous["backend"]
        if health(port, "/health", "typeflow-frontend") and health(api_port, "/api/health", "typeflow"):
            print(f"TypeFlow is already running: http://127.0.0.1:{port}")
            if not args.no_browser:
                webbrowser.open(f"http://127.0.0.1:{port}")
            return
    except (OSError, ValueError, KeyError):
        pass
    port, api_port = find_pair()
    children, handles = [], []
    log_dir = ROOT / "logs"
    log_dir.mkdir(exist_ok=True)
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    try:
        commands = [([str(ROOT / "backend" / "server.py"), "--port", str(api_port), "--frontend-port", str(port)], "backend.log"),
                    ([str(ROOT / "frontend_server.py"), "--port", str(port), "--api-port", str(api_port)], "frontend.log")]
        for command, name in commands:
            handle = (log_dir / name).open("w", encoding="utf-8")
            handles.append(handle)
            children.append(subprocess.Popen([sys.executable, "-u", *command], cwd=ROOT, stdout=handle, stderr=handle, creationflags=creationflags))
        for _ in range(100):
            if any(p.poll() is not None for p in children):
                raise RuntimeError("A server failed to start. See logs/backend.log and logs/frontend.log.")
            if health(port, "/health", "typeflow-frontend") and health(port, "/api/health", "typeflow"):
                break
            time.sleep(.1)
        else:
            raise RuntimeError("Startup timed out. Please check the logs folder.")
        runtime.write_text(json.dumps({"frontend": port, "backend": api_port}), encoding="utf-8")
        print(f"\nTypeFlow is ready: http://127.0.0.1:{port}", flush=True)
        print("Frontend and backend are running. Keep this window open.")
        print("Press Ctrl+C to stop both services. Your progress is saved automatically.\n", flush=True)
        if not args.no_browser:
            webbrowser.open(f"http://127.0.0.1:{port}")
        while all(p.poll() is None for p in children):
            time.sleep(.5)
        raise RuntimeError("A service stopped unexpectedly. Please restart TypeFlow.")
    except KeyboardInterrupt:
        print("\nStopping TypeFlow...")
    finally:
        for p in children:
            if p.poll() is None:
                p.terminate()
        for p in children:
            try:
                p.wait(timeout=4)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        for handle in handles:
            handle.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Startup failed: {error}", file=sys.stderr)
        sys.exit(1)
