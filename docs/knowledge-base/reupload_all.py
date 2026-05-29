"""
Delete all existing knowledge base documents and re-upload all articles.
Run this whenever articles are substantially rewritten.

    cd docs/knowledge-base
    python reupload_all.py
"""

import os
import sys
import time
import yaml
import requests

API_BASE       = "http://localhost:3001"
ADMIN_EMAIL    = "admin@medireach.app"
ADMIN_PASSWORD = "admin123"
ARTICLES_DIR   = os.path.join(os.path.dirname(__file__), "articles")
POLL_INTERVAL  = 5
POLL_TIMEOUT   = 300


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
        sys.exit(f"No access_token: {resp.text}")
    print(f"Logged in as {ADMIN_EMAIL}\n")
    return token


def delete_all_documents(token: str) -> None:
    resp = requests.get(
        f"{API_BASE}/api/v1/admin/knowledge/documents",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code != 200:
        print(f"  WARNING: could not list documents ({resp.status_code})")
        return
    body = resp.json()
    docs = body if isinstance(body, list) else body.get("documents", [])
    if not docs:
        print("No existing documents to delete.\n")
        return

    print(f"Deleting {len(docs)} existing document(s) ...")
    for doc in docs:
        doc_id = doc["id"]
        filename = doc.get("filename", doc_id)
        r = requests.delete(
            f"{API_BASE}/api/v1/admin/knowledge/documents/{doc_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        status = "OK" if r.status_code in (200, 204) else f"FAIL({r.status_code})"
        print(f"  {status}  {filename}")
    print()


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
    filename = os.path.basename(txt_path)
    with open(txt_path, "rb") as f:
        files = {"file": (filename, f, "text/plain")}
        data  = {k: v for k, v in meta.items() if v}
        resp  = requests.post(
            f"{API_BASE}/api/v1/admin/knowledge/documents",
            headers={"Authorization": f"Bearer {token}"},
            files=files,
            data=data,
            timeout=30,
        )
    if resp.status_code in (200, 201, 202):
        return resp.json().get("id")
    print(f"    Upload failed ({resp.status_code}): {resp.text}")
    return None


def poll_until_done(token: str, doc_id: str) -> str:
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
            print(f"    FAILED  — {doc.get('error_message', 'no detail')}")
            return "FAILED"
        print(f"    {status} … (retrying in {POLL_INTERVAL}s)")
        time.sleep(POLL_INTERVAL)
    print(f"    TIMEOUT")
    return "TIMEOUT"


def main() -> None:
    if not os.path.isdir(ARTICLES_DIR):
        sys.exit(f"Articles directory not found: {ARTICLES_DIR}")

    txt_files = sorted(f for f in os.listdir(ARTICLES_DIR) if f.endswith(".txt"))
    if not txt_files:
        sys.exit("No .txt files found.")

    token = login()

    # Step 1: Delete all existing documents
    delete_all_documents(token)

    # Step 2: Upload all articles
    print(f"Uploading {len(txt_files)} article(s):\n")
    results = {"ACTIVE": [], "FAILED": [], "TIMEOUT": []}

    for filename in txt_files:
        txt_path = os.path.join(ARTICLES_DIR, filename)
        meta     = load_yaml_meta(txt_path)
        title    = meta["title"] or filename.replace("_", " ").replace(".txt", "")
        print(f"  {filename}")
        print(f"    Title : {title}")

        doc_id = upload_document(token, txt_path, meta)
        if doc_id is None:
            results["FAILED"].append(filename)
            continue

        status = poll_until_done(token, doc_id)
        results[status].append(filename)
        print()

    print("=" * 60)
    print(f"ACTIVE  : {len(results['ACTIVE'])}")
    print(f"FAILED  : {len(results['FAILED'])}")
    if results["FAILED"]:
        for f in results["FAILED"]:
            print(f"  x {f}")
    print(f"TIMEOUT : {len(results['TIMEOUT'])}")
    print("=" * 60)


if __name__ == "__main__":
    main()
