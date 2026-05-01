"""
Build the baseline FAISS index from docs/knowledge-base/articles/.

Every *.txt file in the articles directory is processed.  A companion *.yaml
file with the same base name is expected alongside each .txt file for metadata.
If the .yaml is absent a chunk is still created with null attribution fields.

Output goes to apps/mobile/src/assets/knowledge/ — the directory must exist
before this script is run (see Task 5).  Run it once before first app build,
and re-run it whenever the seed articles change.

Usage:
    cd docs/knowledge-base
    python build_baseline_index.py
"""

import os
import pickle
import sys

import numpy as np
import yaml

ARTICLES_DIR = os.path.join(os.path.dirname(__file__), "articles")
OUTPUT_DIR   = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "mobile", "src", "assets", "knowledge")
CHUNK_SIZE   = 512
CHUNK_OVERLAP = 64


def _load_yaml_meta(txt_path: str) -> dict:
    """Return attribution dict from the companion .yaml, or all-None if absent."""
    base = os.path.splitext(txt_path)[0]
    yaml_path = base + ".yaml"
    if os.path.exists(yaml_path):
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return {
            "article_title":  data.get("title"),
            "article_url":    data.get("url"),
            "article_author": data.get("author"),
            "article_source": data.get("source"),
        }
    return {
        "article_title":  None,
        "article_url":    None,
        "article_author": None,
        "article_source": None,
    }


def _split_text(text: str) -> list[str]:
    """Split plain text into overlapping chunks using the same settings as the server."""
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    docs = splitter.create_documents([text])
    return [d.page_content for d in docs]


def main() -> None:
    # ── dependency check ──────────────────────────────────────────────────────
    try:
        import faiss                              # noqa: F401
        from sentence_transformers import SentenceTransformer  # noqa: F401
    except ImportError as exc:
        sys.exit(
            f"Missing dependency: {exc}\n"
            "Run: pip install faiss-cpu sentence-transformers langchain langchain-community pyyaml"
        )

    if not os.path.isdir(ARTICLES_DIR):
        sys.exit(f"Articles directory not found: {ARTICLES_DIR}")

    if not os.path.isdir(OUTPUT_DIR):
        sys.exit(
            f"Output directory does not exist: {OUTPUT_DIR}\n"
            "Create it first (Task 5) then re-run this script."
        )

    # ── collect all .txt files ────────────────────────────────────────────────
    txt_files = sorted(
        f for f in os.listdir(ARTICLES_DIR) if f.endswith(".txt")
    )
    if not txt_files:
        sys.exit(f"No .txt files found in {ARTICLES_DIR}")

    print(f"Found {len(txt_files)} article(s) in {ARTICLES_DIR}\n")

    all_texts: list[str] = []
    all_metadata: list[dict] = []

    for filename in txt_files:
        txt_path = os.path.join(ARTICLES_DIR, filename)
        meta     = _load_yaml_meta(txt_path)

        with open(txt_path, "r", encoding="utf-8") as f:
            raw_text = f.read()

        chunks = _split_text(raw_text)

        for chunk in chunks:
            all_texts.append(chunk)
            all_metadata.append({**meta, "source_file": filename})

        yaml_found = "[yaml]" if meta["article_title"] else "(no yaml)"
        print(f"  {filename:<50} {len(chunks):>4} chunks  {yaml_found}")

    print(f"\nTotal chunks: {len(all_texts)}")
    print("Generating embeddings with all-MiniLM-L6-v2 …")

    # ── embed ─────────────────────────────────────────────────────────────────
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    vectors = model.encode(
        all_texts,
        show_progress_bar=True,
        batch_size=32,
    ).astype("float32")

    # ── build FAISS index ─────────────────────────────────────────────────────
    import faiss
    faiss.normalize_L2(vectors)
    index = faiss.IndexFlatIP(384)   # 384 = all-MiniLM-L6-v2 output dim
    index.add(vectors)

    # ── write output ──────────────────────────────────────────────────────────
    index_path = os.path.join(OUTPUT_DIR, "knowledge_index.faiss")
    meta_path  = os.path.join(OUTPUT_DIR, "knowledge_meta.pkl")

    faiss.write_index(index, index_path)
    with open(meta_path, "wb") as f:
        pickle.dump({"texts": all_texts, "metadata": all_metadata}, f)

    index_kb = os.path.getsize(index_path) / 1024
    meta_kb  = os.path.getsize(meta_path)  / 1024

    print(f"\nBaseline index written to {OUTPUT_DIR}")
    print(f"  knowledge_index.faiss  {index_kb:.1f} KB")
    print(f"  knowledge_meta.pkl     {meta_kb:.1f} KB")
    print(f"\nArticles processed : {len(txt_files)}")
    print(f"Total chunks       : {len(all_texts)}")
    print(f"Embedding dimension: 384")


if __name__ == "__main__":
    main()
