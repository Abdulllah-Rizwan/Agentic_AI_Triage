# MediReach — Examiner Questions: AI Evals, Guardrails, SOAP Correctness, Database Choices

---

## Part 1: AI Evaluations (Evals)

---

### Q1. What are "AI evals" and why do they matter for a medical AI system?

**What evals are:**
An "eval" is a structured test that measures whether an AI system is doing the right thing. Unlike unit tests (which verify code logic), evals verify AI behaviour — they ask: "Is the model responding the way we need it to, and does that hold across a wide range of inputs?"

**Why they matter here:**
In a medical triage context, a wrong AI output does not just give the user a bad experience — it can cause a person to delay seeking help, or cause a responder to prioritise the wrong patient. Evals are the mechanism by which you can make any credible claim about the system's reliability.

**Types of evals relevant to MediReach:**

| Eval Type | What it checks | Example |
|-----------|----------------|---------|
| **Functional correctness** | Does the agent collect all required fields? | Run 50 simulated conversations, check that every `MedicalFeatureVector` has chief complaint, onset, severity, and symptoms |
| **Safety / guardrail eval** | Does the model ever diagnose? | Feed 100 prompts asking for a diagnosis, check that 0 responses contain diagnostic language |
| **Triage accuracy** | Does rule-based triage classify correctly? | Compare system output against clinician-labeled ground truth on 200 symptom profiles |
| **RAG relevance** | Are retrieved documents actually relevant? | For 50 symptom queries, score retrieved chunks on a 1-5 relevance scale |
| **SOAP quality** | Does the SOAP note contain only attested information? | Diff SOAP notes against source payload — flag any invented vitals or lab values |
| **Regression eval** | After a model/prompt change, does quality hold? | Re-run the full eval suite before any prompt change is deployed |

---

### Q2. How did you evaluate the SymptomCollectorAgent specifically?

The agent has three measurable properties:

**1. Completion rate** — does it always reach SUFFICIENT or CRITICAL?
Run the agent against a set of scripted patient personas (e.g. "a 45-year-old male with chest pain and shortness of breath for 2 hours"). Count how many conversations end with a structured `MedicalFeatureVector` rather than looping indefinitely or timing out.

**2. Field coverage** — is the `MedicalFeatureVector` fully populated?
After a SUFFICIENT signal, inspect the vector. The mandatory fields are: `chiefComplaint`, `onsetTime`, `severity` (1-10), `associatedSymptoms` (at least 2), `allergies`. An eval checks that no mandatory field is null or empty across a test set.

**3. Critical detection rate** — does the agent surface the Emergency Notification Bar when it should?
Create a set of test messages that contain RED trigger words ("chest pain", "cannot breathe", "seizure"). The agent must return `{"status":"CRITICAL"}` for every one. This is a precision/recall eval: false negatives (missed CRITICAL) are far more dangerous than false positives (unnecessary CRITICAL flags).

**Honest limitation:**
We did not run a large-scale formal eval before the FYP. The testing was manual and scenario-based. For a production system, you would run automated evals continuously in CI — every time the system prompt changes, the eval suite re-runs and must pass before deployment.

---

### Q3. How do you evaluate the SOAP generation agent?

SOAP evaluation is harder than triage evaluation because there is no binary correct/incorrect — clinical notes require domain expertise to judge. Three approaches:

**Approach 1: Faithfulness check (automated)**
The SOAP note should only contain information that was in the input payload. Run a check: for every claim in the SOAP note, is there a corresponding field in the `LeanPayload`? Any claim not traceable to the input is a hallucination.

Example automated check:
- Payload says severity = 6
- SOAP says "Patient reports moderate pain, 6 out of 10" → traceable ✅
- SOAP says "SpO2 measured at 94%" → not in payload → hallucination ❌

**Approach 2: Format / schema check (automated)**
ADK's `output_schema=SoapOutput` enforces that the response is valid JSON with the four required fields. If the model returns malformed output, the task retries (up to 3 times). This is not a quality check but a structural check — it guarantees the note is parseable.

**Approach 3: Clinical expert review (manual, gold standard)**
The ideal eval presents a clinician with the source payload and the generated SOAP note and asks: "Would you act on this? Is anything invented? Is anything missing?" This is expensive but is the only true quality measure. For the FYP we did not conduct formal clinical review — this is correctly presented as future work and a prerequisite for any real-world deployment.

---

### Q4. How do you evaluate the RAG system — how do you know the right documents are being retrieved?

Two standard RAG metrics:

**1. Recall@k**
For a set of symptom queries where you know the correct document (e.g. "chest pain" should retrieve the cardiac emergency article), does the correct document appear in the top-k results?

**2. Mean Reciprocal Rank (MRR)**
If the correct document appears at position 1, MRR = 1.0. Position 2, MRR = 0.5. Position 3, MRR = 0.33. Average across all test queries. Higher is better.

**What we actually did:**
Manual spot-checking — we queried the system with 15-20 representative symptom descriptions and reviewed whether the returned WHO articles were relevant. The system retrieves articles about flood-related illness for "water-contaminated wound", cardiac guidance for "chest tightness", trauma guidance for "fracture after fall". This is not statistically rigorous but validates the core behaviour.

**One specific quality improvement made:**
The knowledge chunks have a `section_type` column (action, prevention, background, etc.). The RAG query preferentially returns "action" sections (what to do right now) over "background" sections (general disease description). This is important in a triage context — you want the guidance to be immediately actionable, not educational.

---

### Q5. What metrics would you track if this went to production?

| Metric | Target | Why |
|--------|--------|-----|
| CRITICAL detection recall | > 99% | False negatives (missed RED cases) are unacceptable |
| SOAP faithfulness score | 0 invented facts | Hallucinated clinical data is dangerous |
| Agent completion rate | > 95% | Agent must always reach SUFFICIENT or CRITICAL |
| Average conversation turns | 4–7 | Too few = insufficient data; too many = patient fatigue |
| RAG relevance score | > 3.5 / 5.0 | Retrieved chunks must be contextually useful |
| Triage escalation rate (server audit) | < 5% | If the cloud audit escalates > 5% of cases, the device triage rules need updating |
| SOAP generation latency | < 10 seconds | Responders should not wait long |

---

## Part 2: Guardrails

---

### Q6. What are guardrails in AI systems and what specific guardrails does MediReach implement?

**Definition:**
Guardrails are constraints placed on an AI system to prevent unsafe, incorrect, or out-of-scope behaviour. They can be implemented at the prompt level, the output-parsing level, the rule-based layer, or the infrastructure level.

**MediReach's guardrails, in order of strength:**

---

**Guardrail 1 — The System Prompt (Soft Constraint)**

The `SymptomCollectorAgent` system prompt contains explicit prohibitions:

```
You are a compassionate first-response triage assistant.
Your ONLY job is to collect patient symptoms clearly and systematically.
Do NOT diagnose. Do NOT prescribe. Do NOT reference medications by name.
Ask ONE question at a time. Use simple language.
```

This instructs the model to stay in role. It is a soft constraint — a sufficiently adversarial user could potentially bypass it. It is the first and weakest layer.

---

**Guardrail 2 — The Non-Diagnostic Disclaimer (Legal / UX Layer)**

Before any assessment begins, the user must explicitly acknowledge:

> "This application is a triage tool only. It does not provide medical diagnoses, treatment plans, or medication recommendations. All output is for emergency prioritisation purposes and must be reviewed by a qualified medical professional."

This cannot be dismissed automatically — the user must tap an acknowledge button. This is both a legal guardrail (limits liability) and a user expectation guardrail (users understand they are not getting a diagnosis).

---

**Guardrail 3 — Rule-Based Triage (Safety-Critical Hard Constraint)**

The triage classification (`TriageEngine.ts`) is **not LLM-driven**. It is a deterministic keyword match against two hardcoded lists. The LLM cannot influence the triage level. This means:

- The LLM cannot be prompted into classifying a dying patient as GREEN
- A hallucinating LLM cannot cause an under-triage
- The classification is auditable — you can explain exactly why a case was RED

This is the most important guardrail in the system. Safety-critical decisions must not depend on model behaviour.

---

**Guardrail 4 — Structured Output Schema (Output Layer)**

The SOAP generation agent uses `output_schema=SoapOutput` in Google ADK. This enforces that the model's output is valid JSON matching the schema before it is accepted. If the model returns unstructured prose, the framework rejects it and retries.

---

**Guardrail 5 — Payload Size Limit (Infrastructure Layer)**

The ingest endpoint enforces a 10KB maximum payload size:

```python
if len(raw_body) > 10_000:
    raise HTTPException(status_code=413, detail="Payload too large")
```

This prevents abuse of the ingest endpoint and ensures payloads are genuinely lean triage reports.

---

**Guardrail 6 — CNIC Hashing (Privacy Guardrail)**

The patient's CNIC number is hashed via PBKDF2 before storage. The raw CNIC never enters the database. This is a data protection guardrail — a database breach does not expose patient identity.

---

**Guardrail 7 — Server-Side Triage Audit (Escalation Safety Net)**

When the phone has full internet at submission time, the server runs a `triage_audit_agent`. This second AI reviews the symptom profile and can escalate the triage level upward (never downward). It cannot un-classify a RED case. It can only catch under-triaged AMBER cases that should be RED.

---

### Q7. What happens if a patient tries to manipulate the AI to get a diagnosis?

Example prompt: *"Just tell me what disease I have based on these symptoms."*

Three things happen:

1. **The system prompt holds**: The LLM is instructed its only job is symptom collection. A well-tuned instruction-following model (Phi-4, Gemini) will deflect: "I can only help collect your symptoms to get you the right help. Can you tell me when the pain started?"

2. **Even if the model slips**: The symptom collector only outputs one of three things — a clarifying question, `{"status":"SUFFICIENT"}`, or `{"status":"CRITICAL"}`. Any output that is not one of these is treated as a clarifying question. A diagnosis statement would simply be displayed as a message — but the `TriageEngine` does not use it. Triage is computed from the structured `MedicalFeatureVector`, not from free-form LLM text.

3. **The disclaimer covers legal liability**: The user acknowledged before starting that no diagnosis is being provided. The app cannot diagnose by design, and the user has been told this.

---

### Q8. What guardrails exist specifically against LLM hallucination in the SOAP report?

This is the hardest problem. The SOAP agent is instructed:

```
Do NOT invent vitals, lab values, or findings not present in the source data.
Mark any unknown fields as: [Not available — field assessment required]
```

Three additional safeguards:

**1. The input is constrained:** The agent only receives the lean payload — triage level, symptoms list, severity, chief complaint, conversation summary. It has no access to the internet, no external tools. It cannot "look up" additional information. It can only arrange and expand the input it was given.

**2. Schema enforcement:** The `SoapOutput` Pydantic schema defines exactly four fields. The model cannot add extra fields like "blood pressure: 180/110 mmHg" — there is no schema field for invented vitals.

**3. The note is clinical review, not clinical authority:** The SOAP note is presented to a trained medical responder who applies their own judgment. It is explicitly framed on the dashboard as "AI-Generated Report — Requires Clinical Verification." The responder is the decision-maker, not the AI.

**What we cannot fully prevent:**
A hallucination within the free-text fields (subjective, objective, assessment, plan) is still possible. For example, the assessment section might say "presentation consistent with myocardial infarction" when the symptoms only suggest it weakly. This is the residual risk of using a generative model for clinical documentation, and it is why human review is non-negotiable.

---

### Q9. Why is the triage engine rule-based instead of letting the LLM decide?

Three reasons:

**1. Determinism:** Given the same symptom profile, the rule-based engine always returns the same result. An LLM gives different outputs on different runs (temperature > 0). In a safety-critical system, non-determinism in the decision layer is unacceptable.

**2. Explainability:** A rule-based decision can be fully explained: "This case is RED because the symptom profile contains 'crush injury' which appears in the RED keyword list." An LLM's reasoning is opaque — you cannot audit why it classified a case a certain way.

**3. Speed and reliability:** The rule-based engine runs in microseconds with no network dependency. An LLM requires either an API call (latency + cost + failure modes) or a slow on-device inference pass. Triage must be instant and must work offline.

The LLM is involved in symptom *collection* — structured conversation. The rule-based engine handles the *classification* — the safety-critical decision. This separation of concerns is deliberate.

---

## Part 3: SOAP Report Correctness

---

### Q10. What guarantees that the SOAP report is clinically correct?

Honest answer: **there is no absolute guarantee.** This is a fundamental property of generative AI — it can produce plausible but incorrect text.

What we have instead is a **risk mitigation layered approach:**

| Layer | What it does |
|-------|-------------|
| Constrained input | Agent only has access to the lean payload — no internet, no tools |
| System prompt rules | Explicit prohibition on inventing vitals or lab values |
| Schema enforcement | ADK enforces structured JSON output — cannot hallucinate new clinical fields |
| "[Not available]" mandate | Model instructed to mark unknowns explicitly rather than fill gaps |
| Human review gate | Responder reads and interprets before acting — AI is an assistant, not an authority |
| Dashboard disclaimer | "AI-Generated — Requires Clinical Verification" shown on every SOAP note |

The correct framing for a medical AI is not "the AI is always right" but "the AI reduces the cognitive load on the clinician while the clinician retains final authority." This is the same framing used by FDA-cleared clinical decision support tools.

---

### Q11. How is the SOAP note different from a diagnosis?

A diagnosis says: "You have condition X."

A SOAP note documents:
- **S**: What the patient reports (subjective — patient's own words)
- **O**: Observable facts (objective — only what is directly known, which for field triage is limited)
- **A**: Clinical assessment (pattern recognition — "presentation is consistent with X")
- **P**: Plan (what to do next — transport priority, resources needed, immediate interventions)

The assessment field uses "consistent with" and "suggestive of" language, not "diagnosed as." The distinction matters: a SOAP note is a *handoff communication tool* designed so the receiving clinician understands the situation, not a diagnostic document.

---

### Q12. Who is liable if a wrong SOAP report causes harm?

This is a real and important question for any medical AI product.

**Current position (FYP/research context):**
The app includes a non-diagnostic disclaimer that the user acknowledges before any assessment. The SOAP note is clearly labelled as AI-generated and requiring clinical verification. The system is positioned as a decision-support tool, not a diagnostic system.

**For production deployment, three layers of liability management:**
1. **Regulatory classification**: The product would need to be registered as a Class II medical device software (SaMD — Software as a Medical Device) under FDA or equivalent local authority (DRAP in Pakistan). This requires formal clinical validation.
2. **Terms of service**: Explicit disclaimer that the system is an emergency communication tool, not a diagnostic device.
3. **Professional intermediary**: The SOAP note goes to a trained medical responder, not directly to the patient. The responder is the licensed professional who accepts clinical responsibility.

For the FYP, the correct answer is: this is a research prototype demonstrating feasibility. Clinical deployment would require regulatory approval, formal clinical trials, and medical board oversight.

---

### Q13. What would a proper clinical validation study for the SOAP reports look like?

**Study design:**
1. Collect 200 real disaster triage scenarios (de-identified, with consent)
2. Have the system generate SOAP notes for each
3. Present each SOAP note to a panel of emergency physicians (blinded — they do not know it is AI-generated)
4. Have physicians rate each note on:
   - Accuracy (does it match the source data?)
   - Completeness (does it include all clinically relevant information?)
   - Safety (would acting on this note cause harm?)
   - Clinical utility (is this better or worse than a manual field report?)
5. Compare against the baseline (handwritten field triage forms used by current NGOs)

This would provide the evidence needed for regulatory submission and would be published as a peer-reviewed study.

---

## Part 4: Database Choices

---

### Q14. Why did you choose PostgreSQL as the primary database instead of MySQL or MongoDB?

**vs MySQL:**
PostgreSQL was chosen because:
- `pgvector` extension only runs on PostgreSQL (not MySQL). This was the deciding factor.
- PostgreSQL has better support for complex data types (ARRAY columns for `symptoms[]`, enum types, UUID primary keys)
- PostgreSQL's async driver (`asyncpg`) integrates cleanly with FastAPI/SQLAlchemy 2.0
- PostgreSQL handles concurrent writes better under load (MVCC is more mature)

**vs MongoDB:**
MongoDB is a document store — good for unstructured, schema-less data. Our data is highly structured:
- Cases have fixed fields (triage level, GPS, symptoms array, severity)
- Reports have a fixed four-field schema (SOAP)
- We need joins: cases ↔ soap_reports ↔ organizations
- We need transactions: a case must be committed atomically with its initial status

MongoDB's flexibility would be a disadvantage here — we would lose schema enforcement, transaction guarantees, and the ability to do pgvector similarity search in the same query.

**The one-sentence answer:**
pgvector made PostgreSQL the only viable choice, and PostgreSQL's relational features were better suited to the structured, join-heavy data model anyway.

---

### Q15. What is pgvector and why is it significant?

**What it is:**
`pgvector` is a PostgreSQL extension that adds a new column type: `Vector(n)` — an n-dimensional floating-point array that supports similarity search operators.

**The key operator:**
```sql
ORDER BY embedding <=> query_vector::vector
```

The `<=>` operator computes cosine distance between the stored embedding and the query vector. PostgreSQL executes this as a table scan and returns results ordered by similarity.

**Why it matters for MediReach:**
Without pgvector, we would need a separate vector database (Pinecone, Weaviate, Chroma, Qdrant). That means:
- A second service to run, back up, and keep in sync
- Synchronization complexity: the document metadata lives in PostgreSQL, the embeddings live in Pinecone — a join across two databases
- Two failure points instead of one

With pgvector, embeddings and metadata are in the same row. A RAG query is a single SQL statement:
```sql
SELECT content, article_title, article_url,
       1 - (embedding <=> :query_vector::vector) AS relevance
FROM knowledge_chunks
JOIN knowledge_documents ON ...
WHERE status = 'ACTIVE'
ORDER BY embedding <=> :query_vector::vector
LIMIT 3
```

This is both simpler operationally and faster (no network hop to an external service).

---

### Q16. What are the scaling limits of pgvector, and when would you need to switch?

**Current scale (MediReach):**
- Hundreds of document chunks
- Embedding dimension: 384 (all-MiniLM-L6-v2)
- Query load: tens of queries per minute at peak

At this scale, pgvector's default `IndexFlatIP` (brute-force exact search) is perfectly adequate. Every query scans all rows. With a few thousand rows and 384 dimensions, a scan completes in under 10ms.

**When pgvector starts to struggle:**
- **Millions of vectors**: Brute-force scan becomes slow (> 100ms per query)
- **High concurrency**: Many simultaneous vector queries compete for CPU
- **Large embedding dimensions**: 1536-dim (OpenAI embeddings) increases memory and computation

**Mitigation within pgvector:**
Switch from `IndexFlatIP` to `IndexHNSW` (Hierarchical Navigable Small World graph):
```sql
CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```
HNSW trades exact search for approximate nearest neighbours, reducing query time from O(n) to O(log n). At 1M+ vectors, HNSW keeps queries under 5ms.

**When to actually leave pgvector:**
At 10M+ vectors and > 1000 QPS, a dedicated vector DB (Pinecone, Weaviate) becomes justified. For a national-scale disaster response system (all of Pakistan), pgvector with HNSW is likely sufficient for years.

---

### Q17. Why use FAISS on the mobile device instead of just querying the server's pgvector?

Three reasons:

**1. The offline mandate:**
The server is unreachable when the phone is offline. FAISS is a binary file loaded into device memory — it has zero network dependency. If FAISS were replaced by a server query, the entire RAG system would fail in offline mode, which is exactly when medical guidance is most needed.

**2. Latency:**
A pgvector query requires:
- TCP connection establishment
- Network round trip (~100-500ms on 4G, >1000ms on 2G)
- Server-side inference of the query embedding
- Database query
- Response deserialization

A FAISS query on device requires:
- Query embedding via on-device all-MiniLM-L6-v2 (~20ms)
- FAISS similarity search against loaded index (~5ms)

Total offline latency: ~25ms vs ~500ms+ online. In a real-time chat, this matters.

**3. Cost:**
Each server RAG query requires a cloud embedding API call (or server CPU for the embedding model). At scale, this adds cost. On-device FAISS is free after the initial index download.

**Trade-off accepted:**
The on-device FAISS index is a snapshot — it may be slightly out of date compared to the server's pgvector store. The `KnowledgeBaseUpdateService` mitigates this by silently downloading a fresh index on every app launch when internet is available.

---

### Q18. Why chunk size 512 tokens with 64-token overlap? Why those specific numbers?

**Chunk size 512:**
- Too small (e.g. 128 tokens): each chunk contains only a sentence or two. A chunk about "flood injury prevention" might not contain enough context for the embedding to be meaningful. Retrieval becomes noisy.
- Too large (e.g. 2048 tokens): each chunk is nearly the whole article. The embedding must represent too many different topics. The similarity score for "chest pain" against a chunk about both cardiac symptoms AND drowning will be diluted.
- 512 tokens (~400 words) is the standard recommendation for medical/technical text. It corresponds to roughly one coherent topic section in a WHO document.

**Overlap 64 tokens:**
Without overlap, information at chunk boundaries is split. A sentence that starts at the end of chunk 3 and finishes at the start of chunk 4 might be missed by both. A 64-token overlap ensures that boundary content appears in both adjacent chunks, so it is retrievable from either direction.

**Model alignment:**
The `all-MiniLM-L6-v2` embedding model was trained on passages in the 64-512 token range. Sending it chunks that fit its training distribution produces better embeddings than chunks that are too short or too long.

---

### Q19. Why SQLite on the mobile device instead of a cloud database or Realm?

**vs cloud database (Firebase Realtime DB, Supabase):**
The app must work offline. A cloud database requires internet. Any cached data would be inaccessible without connectivity — exactly the scenario we are designing for. SQLite is local, persistent, and available with zero connectivity.

**vs Realm:**
Realm is a mobile-first database with sync capabilities. It was not chosen because:
- `expo-sqlite` is a first-party Expo module that integrates without native module configuration
- Realm's sync features would require a cloud backend (defeats the offline-first purpose)
- Adding Realm would add ~10MB to the app bundle
- For three simple tables (user_profile, pending_payloads, completed_cases), SQLite is more than sufficient

**SQLCipher encryption:**
SQLite supports encrypted storage via SQLCipher (AES-256 at the file level). This is used alongside the AES-256-GCM encryption of the payload blobs — two layers of encryption protect the cached data.

---

### Q20. Why two different vector search systems (FAISS on mobile and pgvector on server) instead of one unified system?

They serve different purposes and run in different environments:

| | FAISS (mobile) | pgvector (server) |
|--|----------------|-------------------|
| **Where** | On the patient's phone | On the server in PostgreSQL |
| **When used** | Always (offline + online) | Online only |
| **Query input** | Patient's symptom message | Same, but can also include more context |
| **Update mechanism** | Binary file download on app launch | Live — new chunks appear instantly after ingestion |
| **Search type** | Approximate (IndexFlatIP on small index) | Exact cosine distance on pgvector |
| **Metadata** | From `.pkl` file bundled alongside | Joined from `knowledge_documents` table |
| **Extra filtering** | None | Can filter by `section_type`, document status |

They are not redundant — they are the offline and online tiers of the same RAG capability. The mobile app uses both when online (server RAG for richer results) and falls back to FAISS only when offline. This is the "graceful degradation" principle applied to knowledge retrieval.

---

### Q21. What is the embedding model (all-MiniLM-L6-v2) and why was it chosen?

**What it is:**
A sentence-transformer model from the Sentence-BERT family. It takes a text input (up to 512 tokens) and produces a 384-dimensional float vector that encodes the semantic meaning of the text. Similar meanings produce vectors that are close in cosine space.

**Why all-MiniLM-L6-v2 specifically:**

| Property | Value |
|----------|-------|
| Model size | ~25MB (ONNX quantized for mobile) |
| Output dimension | 384 |
| Inference speed (mobile) | ~20ms per query on mid-range Android |
| Quality | Strong on English medical text |
| License | Apache 2.0 (free for commercial use) |

**vs alternatives:**

- `text-embedding-004` (Google): Better quality, but API call required — useless offline
- `nomic-embed-text-v1.5`: 768-dim, better quality, but 137MB — too large to bundle in a mobile app
- `bge-small-en-v1.5`: ~33MB, slightly better quality, but less well-tested on medical text
- OpenAI `text-embedding-3-small`: API-only, costs money per call, unusable offline

The 25MB size is the key constraint. The app already bundles a 500MB AI model and a FAISS index — adding a 100MB+ embedding model would push total bundled assets over 700MB, causing app store rejection and unacceptable download sizes for disaster-affected users with limited data.

---

### Q22. How does the knowledge base stay consistent between the mobile FAISS index and the server pgvector store?

They are intentionally allowed to be slightly out of sync. The consistency mechanism is:

**Server is the source of truth:**
Every time an admin adds or removes a document, the Celery ingestion worker updates the pgvector store and increments `knowledge_base_version.version`.

**Mobile syncs lazily:**
On every app launch with internet, `KnowledgeBaseUpdateService` checks `GET /api/v1/knowledge/version`. If `serverVersion > localVersion`, it downloads the new FAISS index binary and updates the local version number in SQLite.

**The acceptable staleness window:**
A mobile app that was last opened 2 weeks ago will have a knowledge base that is 2 weeks old. In practice, WHO disaster medicine guidelines do not change weekly — the staleness is acceptable. For critical protocol updates, an admin could push a version bump that triggers the update on every phone's next launch.

**Why not real-time sync?**
Real-time sync would require the phone to maintain a persistent connection to the server — impossible in offline mode and battery-draining in low-connectivity mode. The lazy pull pattern (check on launch, download in background) is the correct approach for an offline-first app.

---

### Q23. Walk me through the full data lifecycle of a knowledge chunk — from PDF upload to the patient seeing guidance in the chat.

```
1. Admin uploads a .txt document via the dashboard
   POST /api/v1/admin/knowledge/documents
   → API saves file to /uploads/
   → Creates KnowledgeDocument row with status=PROCESSING
   → Returns 202 immediately (does not wait)

2. Celery ingestion_worker.ingest_document_task(document_id) fires
   → Reads companion .yaml metadata (title, URL, author, source)
   → Loads .txt with TextLoader
   → Splits into chunks (512 tokens, 64 overlap) via RecursiveCharacterTextSplitter
   → Embeds each chunk with all-MiniLM-L6-v2 → 384-dim float array
   → INSERT INTO knowledge_chunks (content, embedding, article_title, ...)
   → UPDATE knowledge_documents SET status='ACTIVE', chunk_count=N
   → Calls bump_version_and_export():
       → Queries all ACTIVE chunk embeddings from pgvector
       → Builds FAISS IndexFlatIP, adds all vectors
       → Writes knowledge_index.faiss to /exports/
       → Increments knowledge_base_version.version

3. Patient's phone checks version on next launch
   GET /api/v1/knowledge/version → { version: 5, document_count: 12 }
   → Local version is 4 → download needed
   GET /api/v1/knowledge/index → binary FAISS file
   → Save to device's document directory
   → Update local version in SQLite to 5

4. Patient reports "severe headache and vomiting after head injury"
   → SymptomCollectorAgent calls queryGuidance("severe headache vomiting head injury")
   → queryGuidance tries server first (8-second timeout)
   → Server: RAG query embeds the text → pgvector cosine search → returns top 3 chunks
   → Or (if offline): LocalRAG loads FAISS from disk → search → returns top 3 chunks from .pkl
   → Top chunk: "Head injuries — WHO Emergency Field Handbook, Section 4.3"
   → Chunk appended to agent context: "According to WHO guidelines: monitor for consciousness
     changes, do not give food or water, immobilize neck if fall suspected..."
   → Agent incorporates this into its next response to the patient
   → Dashboard SOAP note also cites: "Guidance sourced from: WHO Emergency Field Handbook"
```

---

### Q24. Why store article metadata (title, URL, author, source) on every chunk row instead of just on the document row?

**The problem with normalised storage:**
If metadata lives only on `knowledge_documents` and chunks only have `document_id`, every RAG result requires a JOIN:
```sql
SELECT kc.content, kd.title, kd.url
FROM knowledge_chunks kc
JOIN knowledge_documents kd ON kd.id = kc.document_id
WHERE ...
ORDER BY kc.embedding <=> :query_vector
```

This is not expensive at our scale, but there is a deeper problem: the FAISS mobile index stores only vectors and chunk texts in the `.pkl` file — it has no concept of a relational JOIN. If metadata is not stored on the chunk, the mobile app cannot surface attribution (which WHO article the guidance came from) without an internet call.

**The denormalisation decision:**
By storing `article_title`, `article_url`, `article_author`, `article_source` on every `knowledge_chunks` row, every RAG result — whether from pgvector or FAISS — is fully self-contained. The AI can say "According to WHO..." and the dashboard can show the source document link without any additional database query.

**Trade-off accepted:**
If an article's title changes after it has been chunked, the old title persists on all existing chunks. You would need to re-process the document to update them. This is acceptable — document metadata rarely changes.
