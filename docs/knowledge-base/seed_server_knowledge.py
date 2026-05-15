"""
Seed the server-side knowledge base by uploading all articles in
Docs/knowledge-base/articles/ to the running FastAPI server.

Each .txt file is uploaded as a document.  The companion .yaml file
provides title / author / source / url metadata.  If no .yaml exists
the filename is used as the title.

Usage (from the Docs/knowledge-base/ directory):
    python seed_server_knowledge.py

The script will prompt for API base URL, admin email, and password.
Override with env vars to skip prompts:
    set API_BASE_URL=http://localhost:3001
    set ADMIN_EMAIL=admin@example.com
    set ADMIN_PASSWORD=yourpassword
    python seed_server_knowledge.py

Options (pass as arguments):
    --skip-existing      skip files whose filename is already ACTIVE on the server
    --poll-timeout 120   seconds to wait for each doc to finish processing (default 120)
"""

import argparse
import os
import sys
import time

import requests
import yaml

ARTICLES_DIR = os.path.join(os.path.dirname(__file__), "articles")


# ── helpers ────────────────────────────────────────────────────────────────────

def _load_yaml_meta(txt_path: str) -> dict:
    base = os.path.splitext(txt_path)[0]
    yaml_path = base + ".yaml"
    if os.path.exists(yaml_path):
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return {
            "title":  data.get("title") or os.path.basename(txt_path),
            "author": data.get("author"),
            "source": data.get("source"),
            "url":    data.get("url"),
        }
    return {
        "title":  os.path.basename(txt_path),
        "author": None,
        "source": None,
        "url":    None,
    }


def _login(base_url: str, email: str, password: str) -> str:
    resp = requests.post(
        f"{base_url}/api/v1/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    if resp.status_code != 200:
        sys.exit(f"Login failed ({resp.status_code}): {resp.text}")
    token = resp.json().get("access_token")
    if not token:
        sys.exit(f"Login response did not contain access_token: {resp.text}")
    return token


def _list_active_filenames(base_url: str, headers: dict) -> set[str]:
    resp = requests.get(
        f"{base_url}/api/v1/admin/knowledge/documents",
        headers=headers,
        timeout=15,
    )
    if resp.status_code != 200:
        print(f"  Warning: could not fetch existing documents ({resp.status_code}) — will upload all.")
        return set()
    docs = resp.json().get("documents", [])
    return {d["filename"] for d in docs if d.get("status") == "ACTIVE"}


def _upload(base_url: str, headers: dict, txt_path: str, meta: dict) -> str | None:
    filename = os.path.basename(txt_path)
    with open(txt_path, "rb") as f:
        content = f.read()

    data = {
        "title": meta["title"],
    }
    if meta["author"]:
        data["author"] = meta["author"]
    if meta["source"]:
        data["source"] = meta["source"]
    if meta["url"]:
        data["url"] = meta["url"]

    resp = requests.post(
        f"{base_url}/api/v1/admin/knowledge/documents",
        headers=headers,
        files={"file": (filename, content, "text/plain")},
        data=data,
        timeout=30,
    )

    if resp.status_code == 202:
        doc_id = resp.json().get("id")
        return str(doc_id)
    elif resp.status_code == 409:
        print(f"    Already exists (ACTIVE) — skipping.")
        return None
    else:
        print(f"    Upload failed ({resp.status_code}): {resp.text}")
        return None


def _poll_until_done(base_url: str, headers: dict, doc_id: str, timeout: int, filename: str) -> bool:
    deadline = time.time() + timeout
    interval = 3
    while time.time() < deadline:
        resp = requests.get(
            f"{base_url}/api/v1/admin/knowledge/documents/{doc_id}",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            print(f"    Poll error ({resp.status_code}) — retrying.")
            time.sleep(interval)
            continue

        data = resp.json()
        status = data.get("status")
        chunk_count = data.get("chunk_count")

        if status == "ACTIVE":
            print(f"    ACTIVE — {chunk_count} chunks indexed.")
            return True
        elif status == "FAILED":
            print(f"    FAILED — {data.get('error_message', 'no error detail')}")
            return False
        else:
            print(f"    {status} ... waiting.", end="\r")
            time.sleep(interval)

    print(f"\n    Timed out after {timeout}s waiting for {filename}.")
    return False


# ── main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed server knowledge base from articles directory.")
    parser.add_argument("--skip-existing", action="store_true", help="Skip files already ACTIVE on server.")
    parser.add_argument("--poll-timeout", type=int, default=120, help="Seconds to wait per document (default 120).")
    args = parser.parse_args()

    # ── config ─────────────────────────────────────────────────────────────────
    base_url = os.environ.get("API_BASE_URL") or input("API base URL (e.g. http://localhost:3001): ").strip().rstrip("/")
    email    = os.environ.get("ADMIN_EMAIL")  or input("Admin email: ").strip()
    password = os.environ.get("ADMIN_PASSWORD") or input("Admin password: ")

    print(f"\nConnecting to {base_url} ...")
    token   = _login(base_url, email, password)
    headers = {"Authorization": f"Bearer {token}"}
    print("Logged in successfully.\n")

    # ── collect articles ────────────────────────────────────────────────────────
    txt_files = sorted(f for f in os.listdir(ARTICLES_DIR) if f.endswith(".txt"))
    if not txt_files:
        sys.exit(f"No .txt files found in {ARTICLES_DIR}")

    print(f"Found {len(txt_files)} articles.\n")

    # ── optionally fetch existing active filenames ──────────────────────────────
    active_on_server: set[str] = set()
    if args.skip_existing:
        active_on_server = _list_active_filenames(base_url, headers)
        print(f"Server already has {len(active_on_server)} ACTIVE document(s).\n")

    # ── upload loop ─────────────────────────────────────────────────────────────
    succeeded = 0
    failed    = 0
    skipped   = 0

    for i, filename in enumerate(txt_files, start=1):
        txt_path = os.path.join(ARTICLES_DIR, filename)
        meta     = _load_yaml_meta(txt_path)

        print(f"[{i:>2}/{len(txt_files)}] {filename}")
        print(f"        Title  : {meta['title']}")
        print(f"        Source : {meta['source'] or '(none)'}")

        if args.skip_existing and filename in active_on_server:
            print(f"        Already ACTIVE on server — skipped.")
            skipped += 1
            continue

        doc_id = _upload(base_url, headers, txt_path, meta)
        if doc_id is None:
            skipped += 1
            continue

        print(f"        Uploaded → doc_id {doc_id}. Waiting for processing ...")
        ok = _poll_until_done(base_url, headers, doc_id, args.poll_timeout, filename)
        if ok:
            succeeded += 1
        else:
            failed += 1

        # small pause between uploads — avoids hammering Celery with simultaneous jobs
        if i < len(txt_files):
            time.sleep(1)

    # ── summary ─────────────────────────────────────────────────────────────────
    print(f"\n{'='*55}")
    print(f"  Done.  {succeeded} succeeded  |  {failed} failed  |  {skipped} skipped")
    print(f"{'='*55}")
    print("Server-side RAG is now in sync. Mobile apps will download")
    print("the updated knowledge_meta.json on their next launch.")

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
