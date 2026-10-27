"""Enable Actions-based Pages using existing Git credentials (never prints credentials)."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
RELEASE_FILES = [".github/workflows/pages.yml", ".gitignore", "README.md", "frontend/index.html", "frontend/app.js", "frontend/browser-store.js", "frontend/preferences.js", "frontend/styles.css", "package.json", "tests/test_app.py", "tests/browser-store.test.mjs", "tests/pages.test.mjs", "tests/preferences.test.mjs", "tests/scoring-parity.test.mjs", "tests/scoring-fixtures.json", "tools/build-pages.mjs", "tools/configure_github_pages.py", "tools/scoring-fixtures.py", "tools/profile-smoke.mjs"]
RELEASE_FILES += ["frontend/themes.css", "tools/browser-test-harness.mjs", "tools/theme-smoke.mjs", "tools/theme-error-smoke.mjs", "tools/theme-review.mjs"]
RELEASE_FILES += ["backend/server.py", "backend/key_timings.py", "frontend/key-timings.js", "frontend/key-analysis-view.js", "tests/key-timings.test.mjs", "tests/test_key_timings.py", "tools/key-analysis-smoke.mjs"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Read repository/Pages state without changes")
    parser.add_argument("--publish", action="store_true", help="Commit the tested Pages changes through the GitHub API")
    parser.add_argument("--status", action="store_true", help="Show the workflow for the last published commit")
    parser.add_argument("--verify", action="store_true", help="Verify the deployed site and published static assets")
    parser.add_argument("--repository", default="NanNan-meow/TypeFlow")
    args = parser.parse_args()
    environment = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    credential = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n", text=True, capture_output=True, env=environment)
    # A managed Windows session may prevent Git's sh-based helper launcher.
    # Use the configured manager directly, without changing or printing credentials.
    helper = subprocess.run(["git", "config", "--get", "credential.helper"], capture_output=True, text=True).stdout.strip()
    manager = Path(r"C:\Program Files\Git\mingw64\bin\git-credential-manager.exe")
    if credential.returncode != 0 and helper == "manager" and manager.is_file():
        credential = subprocess.run([str(manager), "get"], input="protocol=https\nhost=github.com\n\n", text=True, capture_output=True, env=environment)
    fields = dict(line.split("=", 1) for line in credential.stdout.splitlines() if "=" in line) if credential.returncode == 0 else {}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or fields.get("password")
    proxy = subprocess.run(["git", "config", "--get-urlmatch", "http.proxy", "https://github.com"], capture_output=True, text=True).stdout.strip()
    opener = build_opener(ProxyHandler({"https": proxy} if proxy else {}))
    def request(method, path, body=None):
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "TypeFlow-Pages-Setup", "X-GitHub-Api-Version": "2022-11-28"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = Request("https://api.github.com" + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            with opener.open(req, timeout=20) as response:
                payload = response.read()
                return response.status, json.loads(payload) if payload else {}
        except HTTPError as error:
            with error:
                try:
                    message = json.load(error).get("message", "GitHub API request failed")
                except ValueError:
                    message = "GitHub API request failed"
                return error.code, {"message": message}
    prefix = f"/repos/{args.repository}"
    status, repo = request("GET", prefix)
    if status != 200:
        raise RuntimeError(f"Repository lookup failed (HTTP {status}): {repo.get('message')}")
    pages_status, pages = request("GET", prefix + "/pages")
    state = {"repository": args.repository, "authenticated": bool(token), "defaultBranch": repo["default_branch"],
             "admin": repo.get("permissions", {}).get("admin", False), "pagesHttpStatus": pages_status,
             "buildType": pages.get("build_type"), "url": pages.get("html_url")}
    if args.check:
        print(json.dumps(state, ensure_ascii=True))
        return
    if args.status:
        deployment = json.loads((ROOT / ".pages-deployment.json").read_text(encoding="utf-8"))
        status, data = request("GET", prefix + f"/actions/runs?head_sha={deployment['sha']}&per_page=20")
        if status != 200:
            raise RuntimeError(f"Workflow lookup failed (HTTP {status}): {data.get('message')}")
        runs = [run for run in data.get("workflow_runs", []) if run.get("path") == ".github/workflows/pages.yml"]
        result = {"sha": deployment["sha"], "runs": [{key: run.get(key) for key in ("id", "status", "conclusion", "html_url")} for run in runs]}
        for run in runs:
            if run.get("conclusion") == "failure":
                _, jobs = request("GET", prefix + f"/actions/runs/{run['id']}/jobs")
                result["failedJobs"] = [{"name": job["name"], "steps": job.get("steps", [])} for job in jobs.get("jobs", []) if job.get("conclusion") == "failure"]
        print(json.dumps(result, ensure_ascii=True))
        return
    if args.verify:
        url = pages.get("html_url")
        if not url:
            raise RuntimeError("Pages URL is not available")
        with opener.open(Request(url, headers={"User-Agent": "TypeFlow-Pages-Setup"}), timeout=20) as response:
            html = response.read().decode("utf-8")
        if 'name="typeflow-storage" content="browser"' not in html:
            raise RuntimeError("Deployed page has not updated to browser-storage mode")
        for asset in ("app.js", "browser-store.js", "preferences.js", "key-timings.js", "key-analysis-view.js", "styles.css", "themes.css", "engine.js", "favicon.svg"):
            with opener.open(url + asset, timeout=20) as response:
                if response.status != 200:
                    raise RuntimeError(f"Published asset is unavailable: {asset}")
        with opener.open(url + "corpus.json", timeout=20) as response:
            published = json.load(response)
        if len(published.get("lessons", [])) != 106 or "chineseSourceRoot" in published:
            raise RuntimeError("Published corpus did not pass the release check")
        print(json.dumps({"verified": True, "url": url, "lessons": len(published["lessons"]), "assets": "ok"}, ensure_ascii=True))
        return
    if not token:
        raise RuntimeError("No existing GitHub credential was available. Select GitHub Actions in repository Settings > Pages.")
    if pages_status == 404:
        status, data = request("POST", prefix + "/pages", {"build_type": "workflow", "source": {"branch": repo["default_branch"], "path": "/"}})
    elif pages_status == 200:
        status, data = request("PUT", prefix + "/pages", {"build_type": "workflow"})
    else:
        raise RuntimeError(f"Pages lookup failed (HTTP {pages_status}): {pages.get('message')}")
    if status not in (200, 201, 204):
        raise RuntimeError(f"Pages setup failed (HTTP {status}): {data.get('message')}")
    status, data = request("GET", prefix + "/pages")
    if status != 200 or data.get("build_type") != "workflow":
        raise RuntimeError("GitHub did not confirm Actions-based Pages configuration")
    if args.publish:
        branch = repo["default_branch"]
        if branch != "main":
            raise RuntimeError("This release workflow expects the main branch")
        status, ref = request("GET", prefix + "/git/ref/heads/main")
        if status != 200:
            raise RuntimeError("Could not read the main branch")
        parent = ref["object"]["sha"]
        local_parent = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        if parent != local_parent:
            status, comparison = request("GET", prefix + f"/compare/{local_parent}...{parent}")
            if status != 200 or comparison.get("status") not in ("ahead", "identical"):
                raise RuntimeError("Remote branch changed; inspect it before publishing")
            conflicts = {item["filename"] for item in comparison.get("files", [])} & set(RELEASE_FILES)
            if conflicts:
                raise RuntimeError("Remote changes overlap the release files: " + ", ".join(sorted(conflicts)))
        status, parent_data = request("GET", prefix + f"/git/commits/{parent}")
        if status != 200:
            raise RuntimeError("Could not read the parent commit tree")
        tree = [{"path": path, "mode": "100644", "type": "blob", "content": (ROOT / path).read_text(encoding="utf-8")} for path in RELEASE_FILES]
        status, created_tree = request("POST", prefix + "/git/trees", {"base_tree": parent_data["tree"]["sha"], "tree": tree})
        if status != 201:
            raise RuntimeError(f"Tree creation failed (HTTP {status}): {created_tree.get('message')}")
        status, commit = request("POST", prefix + "/git/commits", {"message": "Deploy TypeFlow to GitHub Pages with browser-local progress", "tree": created_tree["sha"], "parents": [parent]})
        if status != 201:
            raise RuntimeError(f"Commit creation failed (HTTP {status}): {commit.get('message')}")
        # A concurrent update cannot be overwritten: this update must fast-forward.
        status, updated = request("PATCH", prefix + "/git/refs/heads/main", {"sha": commit["sha"], "force": False})
        if status != 200:
            raise RuntimeError(f"Main branch update failed (HTTP {status}): {updated.get('message')}")
        (ROOT / ".pages-deployment.json").write_text(json.dumps({"repository": args.repository, "sha": commit["sha"]}), encoding="utf-8")
        print(json.dumps({"repository": args.repository, "sha": commit["sha"], "commitUrl": commit.get("html_url"), "url": data.get("html_url"), "buildType": "workflow"}, ensure_ascii=True))
        return
    print(json.dumps({"repository": args.repository, "buildType": data["build_type"], "url": data.get("html_url"), "status": data.get("status")}, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Pages setup failed: {error}", file=sys.stderr)
        sys.exit(1)
