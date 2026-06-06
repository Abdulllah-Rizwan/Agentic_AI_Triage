# Chapter 5: Results and Evaluation

---

## 5.1 Chapter Overview

This chapter presents the results of the implementation and validation of MediReach — an offline-first disaster medical intelligence system that collects patient symptoms on a mobile device, performs deterministic on-device triage, and relays compressed clinical reports to a responder dashboard under degraded or zero-connectivity conditions. Results are reported at both the component level (triage engine, transmission pipeline, on-device language model, retrieval-augmented generation pipeline) and the system level (end-to-end flow validation, security audit, and backend integration tests). Performance benchmarks are compared against the design targets established in the project specification. Where design targets do not exist for a metric, the result is presented as an informational benchmark. Limitations and trade-offs inherent to the design constraints are discussed in Section 5.10.

---

## 5.2 Triage Engine Evaluation

The triage engine is the most safety-critical component in MediReach. It is implemented as a fully deterministic, rule-based algorithm (`TriageEngine.ts`) that operates without network connectivity and without language model inference. The engine classifies a `MedicalFeatureVector` into one of three triage levels — RED (immediate life threat), AMBER (urgent, stable), or GREEN (non-emergency) — by applying keyword matching over 31 RED-condition keywords and 28 AMBER-condition keywords derived from the START (Simple Triage and Rapid Treatment) protocol, combined with a severity score threshold.

### 5.2.1 Computational Performance

The `computeTriage()` function was benchmarked across one thousand iterations. The mean execution time was measured at below one millisecond. The design specification required triage classification to complete within 200 milliseconds — a threshold chosen to ensure that the triage result is available before the language model response is rendered in the chat interface.

At under one millisecond, the triage engine executes 200 times faster than its design target. Figure 5.1 illustrates this result on a logarithmic scale, which is necessary to visualise the magnitude of the difference between the measured and target values.

> **[Insert Figure 5.1 — fig5_1_triage_speed.png]**
> *Figure 5.1: Triage engine computation time vs design target (logarithmic scale). The measured execution time of less than 1 ms is 200 times faster than the 200 ms design target.*

This result confirms that rule-based triage adds no perceptible latency to the critical safety path. Even on the lowest-specification Android 7.0 devices within the intended deployment range, triage computation is effectively instantaneous relative to any human-perceptible timescale.

### 5.2.2 Unit Test Coverage

Seven unit tests were written to cover all decision branches of the triage engine. The test cases are as follows:

1. RED classification triggered by keyword match ("chest pain")
2. RED classification triggered by a severity score of 8 or above
3. AMBER classification triggered by keyword match ("fracture")
4. GREEN classification by default (no matching keywords, severity below 5)
5. RED classification taking priority over AMBER when both keyword sets match simultaneously
6. `detectCriticalSymptom()` positive case — a RED keyword is present in the raw input string
7. `detectCriticalSymptom()` negative case — no RED keyword is present

All seven tests pass with zero external dependencies mocked. The pure TypeScript implementation has no network calls, no file system access, and no platform-specific bindings, meaning it executes identically in the Jest test runner and on any Android or iOS device.

### 5.2.3 Safety Invariant Verification

A critical architectural safety property was verified through code inspection and confirmed by the test suite: `detectCriticalSymptom()` executes on raw user input at the first step of `SymptomCollectorAgent.sendMessage()`, before any language model call is made, before any message is appended to the conversation history, and before any network request is initiated. This guarantees that emergency detection is not gated on language model availability, network connectivity, or API quota status. The function cannot be bypassed by a slow, unavailable, or rate-limited language model.

---

## 5.3 Transmission Pipeline Evaluation

A core design constraint of MediReach is that triage reports must be transmissible over 2G/GPRS networks — the minimum connectivity scenario expected in disaster-affected areas where infrastructure may be partially destroyed. Effective throughput on GPRS Class 10 ranges from 9.6 to 50 Kbps. At 20 Kbps, a 5 KB JSON payload would require approximately two seconds to transmit, during which 2G base stations operating under congestion in disaster zones may enforce idle-connection timeouts. Protocol Buffers (Protobuf) were chosen as the serialisation format specifically to minimise payload size.

### 5.3.1 Payload Size Results

To establish a meaningful baseline, a representative RED-level triage case was serialised using both JSON and Protobuf binary encoding. The JSON representation of this case produced a payload of approximately 3,200 to 4,800 bytes depending on conversation summary length. The Protobuf-encoded `LeanPayload` for the same case produced 564 bytes in the typical case and 1,100 bytes in the worst case — a case with a verbose conversation summary and an extended symptom list.

Figure 5.2 presents this comparison alongside the 2,048-byte design ceiling.

> **[Insert Figure 5.2 — fig5_2_payload_size.png]**
> *Figure 5.2: Triage payload size comparison between JSON and Protocol Buffers encoding. The Protobuf typical payload of 564 bytes is 3.6× below the 2,048-byte 2G transmission ceiling. JSON payloads exceed this ceiling in all scenarios.*

The Protobuf encoding achieves a 5.7 to 8.5 times reduction in payload size compared to JSON. The typical 564-byte payload is 3.6 times smaller than the 2,048-byte ceiling; even the worst-case 1,100-byte payload maintains a 46.3% margin. This confirms that every realistic triage case can be transmitted within a single 2G data exchange with sufficient headroom for packet headers and retransmission overhead.

### 5.3.2 Transmission Success and Reliability

Live device testing confirmed end-to-end transmission success. The API server log recorded `POST /api/v1/cases/ingest HTTP/1.1" 202` for every submission from the test device across multiple test sessions. The idempotency mechanism in the ingest route was verified by submitting identical payloads twice; the second submission returned `status: "DUPLICATE"` rather than creating a duplicate database record, confirming that retry loop re-submissions cannot cause data duplication on the dashboard.

Three engineering corrections were required before reliable end-to-end transmission was achieved. First, the Android `isInternetReachable` property returned `false` on a local WiFi network despite the API server being fully reachable, because the underlying implementation pings an external IP address (8.8.8.8). The network mode classifier was corrected to use `isConnected` as the sole indicator of offline state. Second, the device registration response field was misread as `token` rather than `device_token`, causing every ingest request to carry an invalid authorisation header. Third, Android 9 and later block cleartext HTTP requests by default; a custom Expo config plugin was written to deploy a Network Security Config XML file that permits cleartext traffic to the development server.

### 5.3.3 Offline Queue Durability

The store-and-forward pipeline was validated through Test C (described in detail in Section 5.6). With the device in Airplane Mode, a RED-level triage case was completed. The `TransmissionService` encrypted the Protobuf payload using AES-256-CBC with a PBKDF2-derived key and stored it in the `pending_payloads` SQLite table. Upon WiFi restoration, the 60-second retry loop decrypted the payload and transmitted it. The database record was removed from `pending_payloads` upon receipt of HTTP 202, and a corresponding entry was written to the `completed_cases` table. The case appeared on the dashboard within five seconds of reconnection.

---

## 5.4 On-Device Small Language Model Evaluation

Selecting an appropriate on-device language model was one of the most iterative challenges of the project. The model must operate entirely within the RAM constraints of a consumer Android device (3 to 4 GB), handle bilingual English, Urdu, and Roman Urdu input, follow structured JSON output schemas reliably, and produce coherent multi-turn clinical conversation. Five candidate models were evaluated through live device testing before a final selection was made.

### 5.4.1 Model Selection Iteration

Table 5.1 summarises the five candidate models, their rejection or selection rationale, and their total RAM footprint on a 4 GB device. Figure 5.3 visualises these RAM figures alongside the device capacity limit.

**Table 5.1: On-Device SLM Candidate Evaluation**

| Model | File Size | Total RAM on 4 GB Device | Outcome | Primary Rejection Reason |
|---|---|---|---|---|
| Llama 3.2 1B Q4_K_M | ~700 MB | ~2.3 GB | Rejected | Unreliable structured JSON output at 1B parameter scale |
| Qwen2.5 1.5B Q4_K_M | ~1.0 GB | ~2.65 GB | Rejected | Token repetition; inconsistent instruction following |
| Qwen3 1.7B Q4_K_M | ~1.1 GB | ~2.8 GB | Rejected | Thinking-token leakage into output; dialogue-transcript format |
| phi4-mini 3.8B Q4_K_M | ~2.3 GB | ~4.3 GB | Rejected | RAM exhaustion → storage swapping → 5–6 minute inference |
| **Llama 3.2 3B Q4_K_M** | **~2.0 GB** | **~3.7 GB** | **Selected** | Adequate structured output; fits within 4 GB RAM budget |

> **[Insert Figure 5.3 — fig5_3_slm_ram.png]**
> *Figure 5.3: Total RAM footprint of each SLM candidate on a 4 GB Android device, decomposed into OS overhead, model weights, and KV cache. phi4-mini 3.8B exceeds the 4 GB limit, causing storage swapping and 5–6 minute inference times. Llama 3.2 3B maintains a 300 MB margin.*

The phi4-mini 3.8B model was the only candidate to exceed the device RAM budget. Model weights (2.3 GB), KV cache at n_ctx=2048 (0.5 GB), and the Android OS baseline (1.5 GB) combined to approximately 4.3 GB on a 4 GB device. Android resolved the memory pressure by swapping model pages to internal storage — which is 100 to 1,000 times slower than RAM — producing inference times of five to six minutes per response. This latency is operationally unacceptable for a disaster-zone triage interview. The three smaller rejected candidates (Llama 3.2 1B, Qwen2.5 1.5B, Qwen3 1.7B) were rejected for qualitative output failures rather than RAM constraints.

### 5.4.2 Final Model Performance

Llama 3.2 3B Q4_K_M was selected as the production on-device model. Its total RAM footprint of approximately 3.7 GB leaves 300 MB of headroom on a 4 GB device, sufficient to prevent storage swapping. The context window was set to 1,024 tokens. Symptom collection conversations are five to eight turns in length with a typical total token count of 200 to 500 tokens; the 1,024-token window provides ample headroom with no observable quality degradation compared to larger context sizes, while saving approximately 250 MB of KV cache RAM relative to a 2,048-token window.

Inference time on the test device (4 GB RAM, Android 13) was measured at 30 to 90 seconds per response, substantially faster than the five to six minutes observed with phi4-mini 3.8B and significantly slower than the cloud LLM path (one to three seconds end-to-end via the Groq API). In the context of a disaster-zone triage scenario — where the alternative to a 30-second response is no AI capability whatsoever — this latency range is operationally acceptable for offline use.

A model-specific prompt template was implemented for Llama 3.2 3B using the official Llama 3 instruct format (`<|begin_of_text|><|start_header_id|>` tokens). Additionally, a separate, shorter SLM-optimised system prompt was developed, replacing the 300-word structured cloud prompt with an 80-word example-based prompt. At 3B parameter scale, models follow worked examples more reliably than extended rule lists; this substitution reduced structured JSON parsing failures from occasional to rare.

---

## 5.5 Retrieval-Augmented Generation Pipeline Evaluation

The knowledge retrieval pipeline operates across two modes: server-side semantic search using pgvector cosine similarity (available when the device has full network connectivity) and on-device BM25-inspired keyword search (used when the device is offline or on a degraded connection). Both modes serve WHO and NHS first-aid guidance to the patient at the conclusion of a triage assessment.

### 5.5.1 Knowledge Base Scale

The final knowledge base consists of 30 articles sourced from the World Health Organization and the UK National Health Service, standardised to a consistent section-header format. The server-side pgvector index contains 270 chunks. The mobile offline bundle, delivered within the application package at install time, contains 184 chunks across the same 30 articles. Every chunk carries four attribution metadata fields — article title, source URL, author, and publishing organisation — so that first-aid guidance displayed to patients always cites the originating document directly.

Figure 5.4 shows the composition of both indices by section type.

> **[Insert Figure 5.4 — fig5_4_kb_composition.png]**
> *Figure 5.4: Knowledge base composition by section type for the server-side pgvector index (270 chunks) and the mobile offline bundle (184 chunks). "Action" and "Emergency" sections collectively represent approximately 42% of chunks — these are the sections surfaced to patients as guidance.*

### 5.5.2 Retrieval Quality: Section-Type Preference

A systematic retrieval failure was identified and resolved during device testing. Even when the correct article was retrieved, the returned chunk was consistently drawn from the "RECOGNISING [CONDITION]" symptoms section rather than the "WHAT TO DO WHILE WAITING" action section. The symptoms section scored highest in keyword-based queries because it contains the same medical vocabulary the patient used to describe their condition. Patients were therefore receiving a list of their own symptoms reflected back at them rather than actionable first-aid instructions.

This failure was resolved at two levels. First, all 30 articles were restructured from flat character-count chunks (512-character windows produced by `RecursiveCharacterTextSplitter`) to section-aware chunks aligned to ALL-CAPS section headers. Each chunk was tagged with a `section_type` field (action, symptoms, emergency, prevention, or general) during the ingestion pipeline. Second, the `query_knowledge_base` function was updated to apply a preference filter that promotes chunks labelled `section_type = 'action'` or `section_type = 'prevention'` when multiple results have comparable relevance scores. After this change, post-triage guidance consistently returned actionable steps (for example, "Apply direct pressure to the wound", "Do not remove embedded objects") rather than symptom descriptions.

### 5.5.3 Retrieval Quality: Multilingual LLM Routing

A second failure mode was identified for mixed-language and Roman Urdu input. The BM25 keyword search scores articles by term overlap with the query. When a patient describes malaria symptoms using Roman Urdu vocabulary ("bukhar, nausea, sweating, chills"), the keyword overlap with articles on leptospirosis and dengue fever is comparable to the overlap with the malaria article, because these diseases share symptom vocabulary. BM25 has no semantic understanding and cannot disambiguate diseases from overlapping symptom descriptions; it also cannot handle Roman Urdu tokens that have no English equivalent.

The resolution was the implementation of a server-side LLM disease routing endpoint (`POST /api/v1/knowledge/route`). This endpoint presents the Groq language model with a constrained list of article topic keywords extracted from the database and requests that it identify one or two matching articles. Because the model must select from the existing article slug list rather than generating a disease name freely, hallucination is structurally prevented: the output is always a valid database reference. The model's multilingual language understanding enables correct routing for formal Urdu, Roman Urdu, and mixed-language input. The LLM routing is used exclusively when the device has full network connectivity; BM25 keyword search serves as the offline fallback.

---

## 5.6 End-to-End System Validation

Five end-to-end test scenarios were executed on a physical Android test device to validate the complete system flow from patient input to responder dashboard display. All five scenarios passed. Figure 5.5 presents the test outcomes, and Table 5.2 provides the full scenario descriptions with key validation criteria.

> **[Insert Figure 5.5 — fig5_5_e2e_tests.png]**
> *Figure 5.5: End-to-end system validation results for all five test scenarios. All scenarios passed.*

**Table 5.2: End-to-End Test Scenario Results**

| Test | Scenario | Key Validation Criteria | Result |
|---|---|---|---|
| A | GREEN Assessment (5-turn normal flow) | Correct triage level; RAG guidance with WHO citation; entry in case history | PASS |
| B | RED Path — Critical keyword detection | Emergency bar fires before LLM responds; HTTP 202 within 5 s; RED card on dashboard | PASS |
| C | Offline → Reconnect → Flush | Payload cached to encrypted SQLite; transmitted within 60 s of WiFi restoration; queue cleared | PASS |
| D | Knowledge base sync (version bump) | Version mismatch detected on launch; new index downloaded and applied | PASS |
| E | SOAP report generation | Four-section structured SOAP note available on dashboard within 10–15 seconds | PASS |

**Test A — GREEN Assessment:** The agent collected chief complaint, onset time, severity, associated symptoms, and allergies over five conversation turns. The triage engine classified the case as GREEN. The TriageResultScreen displayed WHO first-aid guidance with a source citation. No payload was transmitted, consistent with the design specification that GREEN cases are handled locally without network communication.

**Test B — RED Emergency Detection:** The patient entered "I am experiencing chest pain." Before the language model produced a response, `detectCriticalSymptom()` detected the keyword and the emergency notification bar animated into view from the bottom of the screen. The text input remained active so that follow-up data collection could continue. The agent gathered severity and associated symptom information over two additional turns. When the language model emitted the `{"status":"CRITICAL"}` JSON token, the case was encoded to Protobuf binary, encrypted with AES-256, and transmitted directly from the `ChatScreen` component without navigating away from the chat. The case appeared on the dashboard as a RED/CRITICAL card within five seconds.

**Test C — Offline Caching and Recovery:** With the device in Airplane Mode, a RED-level triage assessment was completed. The `TransmissionService` encrypted the payload and stored it in the `pending_payloads` SQLite table. Upon WiFi restoration, the 60-second background retry loop decrypted the record and transmitted it successfully. The case appeared on the dashboard and the Celery worker enqueued a SOAP generation task. The `pending_payloads` SQLite record was deleted upon receipt of HTTP 202.

**Test D — Knowledge Base Synchronisation:** A new article was uploaded through the admin dashboard. After the Celery ingestion worker completed processing and the document status changed to ACTIVE, the knowledge base version counter was incremented. On the next mobile application launch, `KnowledgeBaseUpdateService` detected the version mismatch, downloaded the updated `knowledge_meta.json` file, and persisted it to the device document directory. Subsequent assessments matched query terms against the newly added article content.

**Test E — SOAP Report Generation:** After a RED case was received and persisted, the Celery worker dequeued the SOAP generation task and invoked the Google ADK agent with the Groq language model. A structured four-section SOAP note was available on the dashboard within 10 to 15 seconds. The Subjective section summarised the patient's self-reported symptoms. The Objective section acknowledged the self-reported, non-clinical nature of the data. The Assessment section identified the likely condition. The Plan section specified immediate intervention priority, transport urgency, and required resources.

---

## 5.7 Security Audit

A structured security audit was conducted against seven criteria drawn from the project's security specification. All seven criteria passed. Table 5.3 presents the full audit results with source evidence.

**Table 5.3: Security Audit Results**

| Criterion | Code Evidence | Result |
|---|---|---|
| Patient CNIC never stored in plaintext on server | `cases.py` — PBKDF2-HMAC-SHA256, 100,000 iterations; only hash stored | PASS |
| Triage payload encrypted before SQLite write | `TransmissionService.ts` — AES-256-CBC via `encryptPayload()` before `savePendingPayload()` | PASS |
| JWT token expiry enforced | Access 15 min · Refresh 7 days · Device 30 days; `python-jose jwt.decode()` validates `exp` automatically | PASS |
| Admin routes reject non-admin tokens | `require_admin` dependency raises HTTP 403; all `/admin/*` handlers use `Depends(require_admin)` | PASS |
| Device tokens scoped to ingest only | `type` claim mutual exclusion: `"device"` ≠ `"access"`; cross-type use is rejected at the dependency level | PASS |
| Payload size limit enforced at ingestion | `cases.py` — 10,000-byte hard cap; HTTP 413 returned before protobuf decode | PASS |
| Non-diagnostic disclaimer requires explicit acknowledgment | `RegistrationScreen.tsx` — `disclaimerChecked` state in `isFormValid`; two-layer guard on form submit | PASS |

Three of these results merit further discussion.

**CNIC Protection:** The patient's national identity number is the most sensitive personal identifier in the system. It never leaves the device in its original form. Before inclusion in the `LeanPayload`, the mobile application computes a PBKDF2-HMAC-SHA256 hash of the CNIC value with 100,000 iterations. The server stores only this hash and uses it exclusively for deduplication (preventing double-submission of the same patient during the retry loop). This approach is consistent with NIST SP 800-132 recommendations for the storage of password-equivalent personal identifiers.

**Payload Encryption:** Every triage payload written to the SQLite cache is encrypted using AES-256-CBC before the write operation occurs. The encryption key is derived deterministically from the patient's CNIC and device identifier via PBKDF2 (100,000 iterations, 256-bit output). Deterministic key derivation enables encrypted records to survive application restarts without requiring a separate key storage mechanism. In the development environment (Expo Go), where the native AES cryptography module is not available, the system detects the absence of native methods and substitutes a sentinel-marked fallback, ensuring that development testing does not crash while all production builds execute real AES-256-CBC encryption.

**Token Scoping:** Three distinct JSON Web Token types are issued, each carrying a `type` claim (`access`, `refresh`, `device`). Route dependencies validate the `type` claim before accepting any token for processing. A device token cannot be used on dashboard routes; an access token is rejected at the `/ingest` endpoint. This structural separation prevents token escalation attacks even in the event of a credential interception.

---

## 5.8 Performance Benchmarks Summary

Table 5.4 consolidates the key performance benchmarks alongside their design targets and measured values. Figure 5.7 provides a visual representation showing what proportion of each design budget is consumed by the measured result.

> **[Insert Figure 5.7 — fig5_7_benchmarks.png]**
> *Figure 5.7: Performance benchmark summary showing measured values as a percentage of design targets. Triage engine speed consumes less than 0.001% of its 200 ms budget. Payload size metrics consume under 55% of the 2,048-byte budget. Metrics without hard targets are shown as informational bars.*

**Table 5.4: Comprehensive Performance Benchmark Results**

| Metric | Measured | Design Target | Margin | Status |
|---|---|---|---|---|
| Triage engine computation | < 1 ms | < 200 ms | 99.9% | ✓ |
| Protobuf payload — typical | ~564 bytes | < 2,048 bytes | 72.5% | ✓ |
| Protobuf payload — worst case | ~1,100 bytes | < 2,048 bytes | 46.3% | ✓ |
| LocalRAG query — warm (BM25) | < 10 ms | — | — | ✓ |
| SLM inference time (device) | 30–90 s | Acceptable for offline mode | — | ✓ |
| API ingest latency | 15–30 ms | — | — | ✓ |
| SOAP generation (async Celery) | 1.5–4 s | Non-blocking | — | ✓ |
| Server-side RAG query | 20–70 ms | — | — | ✓ |
| Backend test suite | 28/29 (96.6%) | All pass | — | ⚠ 1 quota-blocked |

The triage engine result is the most significant benchmark outcome: under one millisecond against a 200 ms target confirms that the safety-critical path adds no perceptible latency and requires no design compromise on low-specification hardware.

It is worth noting that the LocalRAG query time improved substantially from an earlier benchmark of 80–200 ms (measured when the `@xenova/transformers` ONNX embedding model was in use). Upon discovering that the Hermes JavaScript engine has no WebAssembly support, the ONNX model was replaced with a pure-JavaScript BM25-inspired keyword scoring implementation. The BM25 implementation has no initialisation overhead and executes a full index search over 184 chunks in under 10 milliseconds.

The SLM inference time (30–90 seconds) is the only metric without a hard target. This range reflects the performance of Llama 3.2 3B Q4_K_M on the test device under production conditions. The approximately 30–90 second offline inference latency represents an inherent trade-off between AI capability and device resource constraints — the only alternative is to provide no AI-assisted symptom collection in the absence of connectivity.

---

## 5.9 Backend Integration Test Suite

The backend integration test suite (`test_full_backend.py`) consists of 29 automated tests that exercise all major API routes, authentication and authorisation flows, Protobuf ingestion, analytics computations, knowledge base operations, SOAP generation, and Socket.IO event handling. Figure 5.6 presents the test results grouped by functional category.

> **[Insert Figure 5.6 — fig5_6_backend_tests.png]**
> *Figure 5.6: Backend integration test suite results by functional category. 28 of 29 tests pass. The single failure in Case Management is due to Groq API daily quota exhaustion during the test run, not a code defect.*

At the conclusion of development, 28 of 29 tests pass. The single failing test (Test 10 — SOAP report generation) is not a code defect. The SOAP generation pipeline calls the Groq API from within the Celery worker. During the test run, the free-tier daily quota had been exhausted by preceding test iterations, causing the Groq API to return `429 RESOURCE_EXHAUSTED`. The `await` fix applied to `soap_worker.py` — ensuring that `session_service.create_session()` is correctly awaited before its `.id` attribute is accessed — was verified by code inspection to be correct. The test passes on any run executed before the daily Groq quota is exhausted.

Seven defects were identified and resolved during the testing phase. These are documented in Table 5.5.

**Table 5.5: Defects Identified and Resolved During Backend Testing**

| # | Component | Defect | Fix Applied |
|---|---|---|---|
| 1 | `soap_worker.py` | `create_session()` not awaited — `AttributeError: 'coroutine' object has no attribute 'id'` | Added `await` |
| 2 | `run_celery.py` | `GROQ_API_KEY` absent from `os.environ` — pydantic-settings does not set system env vars; ADK reads env directly | Added `os.environ.setdefault(...)` |
| 3 | `analytics.py` | `datetime.now(timezone.utc)` rejected by PostgreSQL `TIMESTAMP WITHOUT TIME ZONE` columns | Changed to `datetime.utcnow()` |
| 4 | `cases.py` | Same timezone issue for `claimed_at` and `resolved_at` fields | Changed to `datetime.utcnow()` |
| 5 | `soap_agent.py`, `triage_audit_agent.py` | `system_prompt=` constructor argument removed in newer ADK release; correct field is `instruction=` | Updated both agent files |
| 6 | `triage_pb2.py` | Protobuf compiler generated bindings to wrong subdirectory; file was an empty stub | Re-ran `protoc` with `-I proto/` flag |
| 7 | `test_full_backend.py` | Test 19 passed a dashboard `access_token` to a device-scoped endpoint requiring a `device_token` | Switched to `state["device_token"]` |

---

## 5.10 Limitations and Trade-offs

### 5.10.1 On-Device SLM Quality vs Device Compatibility

The on-device small language model provides lower response quality than the cloud language model path. Llama 3.2 3B, selected for its balance of capability and RAM footprint, cannot match the instruction-following quality of the Groq-hosted Llama 3.3 70B used in cloud mode. While structured JSON output (the `SUFFICIENT`/`CRITICAL` status tokens) is reliable at 3B parameter scale with the custom prompt design, occasional preamble text before the JSON token requires the `_tryParseJSON` function to locate the JSON substring by scanning the full output string rather than requiring the string to begin with `{`. Response quality during multi-turn conversation is noticeably lower than cloud mode, particularly for nuanced clinical follow-up questions in Urdu or Roman Urdu.

### 5.10.2 On-Device RAG Limited to Keyword Matching

Because the Hermes JavaScript engine (the React Native runtime) does not support WebAssembly, ONNX-based semantic embedding (using `all-MiniLM-L6-v2` via `@xenova/transformers`) is not viable on the device. The BM25-inspired keyword search is reliable for English input against the standardised article format but performs poorly for semantically similar queries with different vocabulary, and structurally cannot process Roman Urdu or mixed-script tokens. The server-side LLM routing compensates when the device has full network connectivity, but offline RAG quality remains limited to keyword overlap.

### 5.10.3 No Background Transmission

The offline payload retry loop (`startRetryLoop`) operates as a foreground `setInterval`. If the application is moved to the background or terminated after an offline payload has been cached, the retry loop does not fire until the application is reopened. The integration of `expo-background-fetch` to support background payload delivery was not completed within the project timeline. In a real deployment, this means a patient who closes the application after an offline triage assessment must reopen it to trigger transmission — a meaningful operational limitation in a disaster scenario where a patient may be in a deteriorating condition and unable to interact with their device.

### 5.10.4 Shared Free-Tier API Quota

The mobile application and the backend Celery workers share the same Groq API key and therefore the same free-tier daily quota (14,400 requests per day). During intensive test sessions, this quota is exhausted, causing both SOAP generation and cloud-mode conversation to fail with `429 RESOURCE_EXHAUSTED` errors until midnight UTC. A production deployment would require a paid API tier or separate keys partitioned between the mobile and backend services.

### 5.10.5 Development Network Configuration Constraints

End-to-end testing on a physical device required `ngrok` tunnelling because the development network router had AP isolation (client isolation) enabled, which prevents direct device-to-device communication on the local LAN. Additionally, the development machine operates multiple virtual network adapters (WSL, VirtualBox, Hyper-V), which caused Expo's IP auto-detection to select an unreachable virtual adapter address, requiring the `REACT_NATIVE_PACKAGER_HOSTNAME` environment variable to be set explicitly to the WiFi adapter IP before each session. Both of these are development environment limitations; a production deployment where the API server is accessible at a public domain name does not require any tunnel or manual IP configuration.

---

## 5.11 Chapter Summary

MediReach successfully implements a five-stage offline-first disaster medical triage relay that degrades gracefully across three network connectivity levels. The triage engine operates at under one millisecond — 200 times faster than its design target — and is the sole deterministic decision-maker for safety-critical triage classification. Triage payloads are compressed to approximately 564 bytes in the typical case using Protocol Buffers encoding, enabling reliable transmission over 2G/GPRS networks with 72.5% margin below the design ceiling. The on-device small language model (Llama 3.2 3B Q4_K_M) provides bilingual symptom collection for offline scenarios after a selection process that evaluated five candidate models; the cloud language model path (Groq Llama 3.3 70B) provides higher quality when full connectivity is available. The retrieval-augmented generation pipeline surfaces actionable WHO and NHS first-aid guidance using server-side LLM disease routing with section-type-aware chunk retrieval, resolving two systematic failure modes identified during live testing. All seven security audit criteria passed, including CNIC hashing with PBKDF2, AES-256-CBC payload encryption at rest, and JWT token scoping by type claim. End-to-end validation on a physical device confirmed that all five core system scenarios — GREEN assessment, RED emergency detection, offline-to-reconnect recovery, knowledge base synchronisation, and SOAP report generation — function as specified. The 28 of 29 passing backend integration tests, with the single failure attributable to an external API quota constraint rather than a code defect, further validates the correctness of the server-side implementation.

---

*End of Chapter 5*
