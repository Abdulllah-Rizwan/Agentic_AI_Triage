"""
Upload all .txt articles from docs/knowledge-base/articles/ to the server.

- Reads companion .yaml for title/author/source/url
- Skips articles whose filename is already present as an ACTIVE document
- Polls until every uploaded document reaches ACTIVE or FAILED
- Prints a final summary

Usage:
    cd docs/knowledge-base
    python upload_articles.py
"""

import os
import sys
import time
import json
import yaml
import requests

API_BASE   = "http://localhost:3001"
ADMIN_EMAIL    = "admin@medireach.app"
ADMIN_PASSWORD = "admin123"
ARTICLES_DIR   = os.path.join(os.path.dirname(__file__), "articles")
POLL_INTERVAL  = 5   # seconds between status checks
POLL_TIMEOUT   = 180 # seconds before giving up on a single document


def login() -> str:
    resp = requests.post(
        f"{API_BASE}/api/v1/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    if resp.status_code != 200:
        sys.exit(f"Login failed ({resp.status_code}): {resp.text}")
    token = resp.json().get("access_token")
    if not token:
        sys.exit(f"No access_token in login response: {resp.text}")
    print(f"Logged in as {ADMIN_EMAIL}")
    return token


def get_existing_documents(token: str) -> set[str]:
    """Return set of filenames already on the server (any status)."""
    resp = requests.get(
        f"{API_BASE}/api/v1/admin/knowledge/documents",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code != 200:
        print(f"  WARNING: could not list existing documents ({resp.status_code}) — uploading all")
        return set()
    body = resp.json()
    # The API returns {"documents": [...]}
    docs = body if isinstance(body, list) else body.get("documents", [])
    return {d["filename"] for d in docs}


def load_yaml_meta(txt_path: str) -> dict:
    base      = os.path.splitext(txt_path)[0]
    yaml_path = base + ".yaml"
    if os.path.exists(yaml_path):
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return {
            "title":  data.get("title", ""),
            "author": data.get("author", ""),
            "source": data.get("source", ""),
            "url":    data.get("url", ""),
        }
    return {"title": "", "author": "", "source": "", "url": ""}


def upload_document(token: str, txt_path: str, meta: dict) -> str | None:
    """Upload one .txt file. Returns document id on success, None on failure."""
    filename = os.path.basename(txt_path)
    with open(txt_path, "rb") as f:
        files = {"file": (filename, f, "text/plain")}
        data  = {k: v for k, v in meta.items() if v}   # omit empty strings
        resp  = requests.post(
            f"{API_BASE}/api/v1/admin/knowledge/documents",
            headers={"Authorization": f"Bearer {token}"},
            files=files,
            data=data,
            timeout=30,
        )
    if resp.status_code in (200, 201, 202):
        doc_id = resp.json().get("id")
        return doc_id
    print(f"    Upload failed ({resp.status_code}): {resp.text}")
    return None


def poll_until_done(token: str, doc_id: str, title: str) -> str:
    """Poll GET /documents/{id} until status is ACTIVE or FAILED. Returns final status."""
    deadline = time.time() + POLL_TIMEOUT
    while time.time() < deadline:
        resp = requests.get(
            f"{API_BASE}/api/v1/admin/knowledge/documents/{doc_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            time.sleep(POLL_INTERVAL)
            continue
        doc    = resp.json()
        status = doc.get("status", "UNKNOWN")
        chunks = doc.get("chunk_count") or 0
        if status == "ACTIVE":
            print(f"    ACTIVE  — {chunks} chunks")
            return "ACTIVE"
        if status == "FAILED":
            err = doc.get("error_message", "no detail")
            print(f"    FAILED  — {err}")
            return "FAILED"
        print(f"    {status} … (checking again in {POLL_INTERVAL}s)")
        time.sleep(POLL_INTERVAL)
    print(f"    TIMEOUT — document did not finish processing within {POLL_TIMEOUT}s")
    return "TIMEOUT"


def main() -> None:
    if not os.path.isdir(ARTICLES_DIR):
        sys.exit(f"Articles directory not found: {ARTICLES_DIR}")

    txt_files = sorted(f for f in os.listdir(ARTICLES_DIR) if f.endswith(".txt"))
    if not txt_files:
        sys.exit("No .txt files found.")

    token    = login()
    existing = get_existing_documents(token)
    if existing:
        print(f"Server already has {len(existing)} document(s) — skipping duplicates\n")

    to_upload = [f for f in txt_files if f not in existing]
    skipped   = [f for f in txt_files if f in existing]

    if skipped:
        print(f"Skipping {len(skipped)} already-uploaded file(s):")
        for f in skipped:
            print(f"  SKIP  {f}")
        print()

    if not to_upload:
        print("Nothing to upload — server is already up to date.")
        return

    print(f"Uploading {len(to_upload)} new article(s):\n")

    results = {"ACTIVE": [], "FAILED": [], "TIMEOUT": []}

    for filename in to_upload:
        txt_path = os.path.join(ARTICLES_DIR, filename)
        meta     = load_yaml_meta(txt_path)
        title    = meta["title"] or filename.replace("_", " ").replace(".txt", "")
        print(f"  Uploading: {filename}")
        print(f"    Title : {title}")

        doc_id = upload_document(token, txt_path, meta)
        if doc_id is None:
            results["FAILED"].append(filename)
            continue

        print(f"    Doc ID: {doc_id}")
        status = poll_until_done(token, doc_id, title)
        results[status].append(filename)
        print()

    print("=" * 60)
    print(f"ACTIVE  : {len(results['ACTIVE'])}")
    if results["ACTIVE"]:
        for f in results["ACTIVE"]:
            print(f"  + {f}")
    print(f"FAILED  : {len(results['FAILED'])}")
    if results["FAILED"]:
        for f in results["FAILED"]:
            print(f"  x {f}")
    print(f"TIMEOUT : {len(results['TIMEOUT'])}")
    print("=" * 60)


if __name__ == "__main__":
    main()
