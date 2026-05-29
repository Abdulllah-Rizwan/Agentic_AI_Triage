"""
Build the baseline FAISS index from docs/knowledge-base/articles/.

Every *.txt file in the articles directory is processed using the same
section-aware chunker as the server ingestion worker. A companion *.yaml
file is read for attribution metadata.  If the .yaml is absent a chunk is
still created with null attribution fields.

Output goes to apps/mobile/src/assets/knowledge/.  Run once before first
app build, and re-run whenever the seed articles change.

Files written:
  knowledge_index.faiss        — FAISS IndexFlatIP (Python / server use)
  knowledge_meta.pkl           — pickle of texts + metadata (Python use)
  knowledge_meta.json          — ChunkMetadata[] for the mobile JS RAG engine
                                  Includes section_type for action-chunk preference
  knowledge_embeddings.json    — base64 Float32Array (legacy, kept for compatibility)
  knowledge_embeddings.bin     — raw little-endian float32 binary

Usage:
    cd docs/knowledge-base
    python build_baseline_index.py
"""

import base64
import json
import os
import pickle
import re
import sys
from typing import Optional

import numpy as np
import yaml

ARTICLES_DIR = os.path.join(os.path.dirname(__file__), "articles")
OUTPUT_DIR   = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "mobile", "src", "assets", "knowledge")
MAX_SECTION_CHARS = 1400

# ── Section-aware chunker (mirrors ingestion_worker.py) ───────────────────────

_HEADER_RE = re.compile(r"^([A-Z][A-Z\s\-–—()/,\.!]+):?\s*$")


def _classify_section(header: str) -> str:
    h = header.upper()
    if "TOPIC" in h:
        return "topic"
    if any(k in h for k in (
        "WHAT TO DO",
        "IMMEDIATE TREATMENT",
        "IMMEDIATE ACTIONS FOR",
        "HOW TO MAKE ORS",
        "GIVING ORS",
        "EMERGENCY ACTIONS",
        "ACTIONS FOR HEAT",
        "ACTIONS AFTER",
        "IMMEDIATE ASSESSMENT",
    )):
        return "action"
    if any(k in h for k in (
        "WHEN TO SEEK",
        "EMERGENCY CARE",
        "GO TO HOSPITAL",
        "HOSPITAL IMMEDIATELY",
        "HOSPITAL REQUIREMENT",
        "CALL FOR EMERGENCY",
        "WHEN TO CALL",
        "SEEK EMERGENCY",
        "EMERGENCY WARNING",
        "SEVERITY ASSESSMENT",
    )):
        return "emergency"
    if any(k in h for k in (
        "RECOGNIZING",
        "RECOGNISE",
        "SYMPTOMS",
        "SIGNS OF",
        "STAGES",
        "WHAT A SEIZURE",
        "WHAT TRIAGE",
        "FORMS OF",
        "HEAT-RELATED ILLNESS",
        "CRUSH SYNDROME",
        "DANGERS SPECIFIC",
        "HIGH-RISK SITUATIONS",
        "HIGH-RISK GROUPS",
        "ANAPHYLAXIS TRIGGERS",
        "RECOGNIZING ANAPHYLAXIS IN",
    )):
        return "symptoms"
    if any(k in h for k in ("PREVENTION", "PREVENTING", "PROTECT")):
        return "prevention"
    if any(k in h for k in ("DO NOT", "DON'T")):
        return "action"
    return "general"


def split_by_sections(text: str) -> tuple[list[dict], Optional[str]]:
    """
    Split article text into section chunks tagged with section_type.
    Returns (chunks, topic_keywords).
    """
    topic_keywords: Optional[str] = None
    clean_lines: list[str] = []
    for line in text.split("\n"):
        if line.strip().upper().startswith("TOPIC:"):
            topic_keywords = line.strip()[6:].strip()
        else:
            clean_lines.append(line)

    sections: list[dict] = []
    current_type = "general"
    current_lines: list[str] = []

    for line in clean_lines:
        m = _HEADER_RE.match(line.rstrip())
        if m:
            content = "\n".join(current_lines).strip()
            if content:
                sections.append({"content": content, "section_type": current_type})
            current_type = _classify_section(m.group(1).strip())
            current_lines = [line]
        else:
            current_lines.append(line)

    content = "\n".join(current_lines).strip()
    if content:
        sections.append({"content": content, "section_type": current_type})

    result: list[dict] = []
    for section in sections:
        if len(section["content"]) <= MAX_SECTION_CHARS:
            result.append(section)
        else:
            paragraphs = [p for p in section["content"].split("\n\n") if p.strip()]
            chunk_lines: list[str] = []
            chunk_len = 0
            for para in paragraphs:
                if chunk_len + len(para) > MAX_SECTION_CHARS and chunk_lines:
                    result.append({
                        "content": "\n\n".join(chunk_lines).strip(),
                        "section_type": section["section_type"],
                    })
                    chunk_lines = [para]
                    chunk_len = len(para)
                else:
                    chunk_lines.append(para)
                    chunk_len += len(para) + 2
            if chunk_lines:
                result.append({
                    "content": "\n\n".join(chunk_lines).strip(),
                    "section_type": section["section_type"],
                })

    # Filter out topic-type sections (metadata only)
    return [c for c in result if c["section_type"] != "topic"], topic_keywords


# ── YAML loader ────────────────────────────────────────────────────────────────

def _load_yaml_meta(txt_path: str) -> dict:
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


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    try:
        import faiss                                           # noqa: F401
        from sentence_transformers import SentenceTransformer  # noqa: F401
    except ImportError as exc:
        sys.exit(
            f"Missing dependency: {exc}\n"
            "Run: pip install faiss-cpu sentence-transformers pyyaml numpy"
        )

    if not os.path.isdir(ARTICLES_DIR):
        sys.exit(f"Articles directory not found: {ARTICLES_DIR}")

    if not os.path.isdir(OUTPUT_DIR):
        sys.exit(
            f"Output directory does not exist: {OUTPUT_DIR}\n"
            "Create it first then re-run this script."
        )

    txt_files = sorted(f for f in os.listdir(ARTICLES_DIR) if f.endswith(".txt"))
    if not txt_files:
        sys.exit(f"No .txt files found in {ARTICLES_DIR}")

    print(f"Found {len(txt_files)} article(s) in {ARTICLES_DIR}\n")

    all_texts: list[str] = []
    all_metadata: list[dict] = []

    for filename in txt_files:
        txt_path = os.path.join(ARTICLES_DIR, filename)
        meta = _load_yaml_meta(txt_path)

        with open(txt_path, "r", encoding="utf-8") as f:
            raw_text = f.read()

        chunks, topic_keywords = split_by_sections(raw_text)

        for chunk in chunks:
            all_texts.append(chunk["content"])
            all_metadata.append({
                **meta,
                "source_file":    filename,
                "section_type":   chunk["section_type"],
                "topic_keywords": topic_keywords,
            })

        action_count = sum(1 for c in chunks if c["section_type"] == "action")
        yaml_found = "[yaml]" if meta["article_title"] else "(no yaml)"
        print(f"  {filename:<52} {len(chunks):>3} chunks  {action_count:>2} action  {yaml_found}")

    print(f"\nTotal chunks: {len(all_texts)}")
    print("Generating embeddings with all-MiniLM-L6-v2 ...")

    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    vectors = model.encode(all_texts, show_progress_bar=True, batch_size=32).astype("float32")

    import faiss
    faiss.normalize_L2(vectors)
    index = faiss.IndexFlatIP(384)
    index.add(vectors)

    index_path = os.path.join(OUTPUT_DIR, "knowledge_index.faiss")
    meta_pkl   = os.path.join(OUTPUT_DIR, "knowledge_meta.pkl")
    meta_json  = os.path.join(OUTPUT_DIR, "knowledge_meta.json")
    emb_json   = os.path.join(OUTPUT_DIR, "knowledge_embeddings.json")
    emb_bin    = os.path.join(OUTPUT_DIR, "knowledge_embeddings.bin")

    faiss.write_index(index, index_path)

    with open(meta_pkl, "wb") as f:
        pickle.dump({"texts": all_texts, "metadata": all_metadata}, f)

    # JSON metadata for mobile JS RAG engine — matches ChunkMetadata interface in LocalRAG.ts
    # Includes section_type so LocalRAG can prefer action chunks
    js_meta = [
        {
            "content":       text,
            "articleTitle":  m.get("article_title"),
            "articleUrl":    m.get("article_url"),
            "articleAuthor": m.get("article_author"),
            "articleSource": m.get("article_source"),
            "section_type":  m.get("section_type"),
        }
        for text, m in zip(all_texts, all_metadata)
    ]
    with open(meta_json, "w", encoding="utf-8") as f:
        json.dump(js_meta, f, ensure_ascii=False, separators=(",", ":"))

    vectors.astype("<f4").tofile(emb_bin)

    raw_bytes = vectors.astype("<f4").tobytes()
    b64_data = base64.b64encode(raw_bytes).decode("ascii")
    with open(emb_json, "w", encoding="utf-8") as f:
        json.dump({"data": b64_data, "dims": 384, "count": len(all_texts)},
                  f, separators=(",", ":"))

    def kb(path: str) -> str:
        return f"{os.path.getsize(path) / 1024:.1f} KB"

    print(f"\nBaseline index written to {OUTPUT_DIR}")
    print(f"  knowledge_index.faiss       {kb(index_path)}")
    print(f"  knowledge_meta.pkl          {kb(meta_pkl)}")
    print(f"  knowledge_meta.json         {kb(meta_json)}")
    print(f"  knowledge_embeddings.json   {kb(emb_json)}")
    print(f"  knowledge_embeddings.bin    {kb(emb_bin)}")
    print(f"\nArticles processed : {len(txt_files)}")
    print(f"Total chunks       : {len(all_texts)}")
    action_total = sum(1 for m in all_metadata if m.get("section_type") == "action")
    print(f"Action chunks      : {action_total}")
    print(f"Embedding dimension: 384")


if __name__ == "__main__":
    main()
