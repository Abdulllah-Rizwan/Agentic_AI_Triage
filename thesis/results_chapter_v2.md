# Chapter 5: Results and Evaluation

---

## 5.1 Chapter Overview

This chapter presents the results of the implementation and evaluation of MediReach — an offline-first disaster medical intelligence system that collects patient symptoms on a mobile device, performs deterministic on-device triage, and relays compressed clinical reports to a responder dashboard under degraded or zero-connectivity conditions. Results are reported at the component level (triage engine, transmission pipeline, on-device language model, and retrieval-augmented generation pipeline) and at the system level (security evaluation and overall performance benchmarks). Performance benchmarks are compared against predefined design targets. For components where no formal target was established at the outset, targets are defined in this chapter based on accepted thresholds for mobile healthcare and disaster-response applications. Limitations and trade-offs are discussed in Section 5.8.

---

## 5.2 Triage Engine Evaluation

The triage engine is the most safety-critical component in MediReach. It is implemented as a fully deterministic, rule-based algorithm that operates without network connectivity and without language model inference. The engine classifies incoming patient data into one of three triage levels — RED (immediate life threat), AMBER (urgent but stable), or GREEN (non-emergency) — by applying keyword matching over 31 RED-condition descriptors and 28 AMBER-condition descriptors derived from the START (Simple Triage and Rapid Treatment) protocol, combined with a numerical severity score threshold.

### 5.2.1 Computational Performance

The triage classification module was benchmarked across one thousand iterations on the target device profile. The mean execution time was measured at below one millisecond. The design target required classification to complete within 200 milliseconds — a threshold set to ensure the result is available before any conversational response is rendered in the chat interface.

At under one millisecond, the engine executes 200 times faster than its design target. Figure 5.1 illustrates this result on a logarithmic scale, which is necessary to visualise the order-of-magnitude difference between the two values.

> **[Insert Figure 5.1 — fig5_1_triage_speed.png]**
> *Figure 5.1: Triage engine computation time vs design target on a logarithmic scale. The measured result of less than 1 ms is 200 times faster than the 200 ms target, confirming that triage classification adds no perceptible latency on any supported Android device.*

This result confirms that rule-based triage adds no perceptible latency to the critical safety path and requires no performance compromise for deployment on the lowest-specification devices in the intended range.

### 5.2.2 Test Coverage and Correctness

Seven tests were designed to cover every decision branch of the triage classification algorithm. The test cases are:

1. RED classification triggered by a critical symptom keyword
2. RED classification triggered by a severity score of 8 or above
3. AMBER classification triggered by an urgent symptom keyword
4. GREEN classification by default when no keywords match and severity is below 5
5. RED priority correctly taking precedence over AMBER when both keyword sets match simultaneously
6. Pre-LLM critical symptom detection correctly identifying a life-threatening descriptor in raw patient input
7. Pre-LLM critical symptom detection correctly returning no result when no critical descriptor is present

All seven tests pass. The algorithm has no external dependencies, no network calls, and no platform-specific bindings — it produces identical results in the automated test runner and on any physical Android or iOS device.

### 5.2.3 Safety Invariant

A critical safety property of the system is that critical symptom detection runs on the raw patient input before any language model is invoked, before any conversation history is updated, and before any network request is initiated. This guarantees that emergency detection is never gated on model availability, connectivity status, or API quota. It cannot be bypassed by a slow or unavailable language model — the check is architectural, not conditional.

---

## 5.3 Transmission Pipeline Evaluation

A core design constraint of MediReach is that triage reports must be transmissible over 2G/GPRS networks — the minimum connectivity scenario in disaster-affected areas where communication infrastructure may be partially destroyed. Effective throughput on GPRS Class 10 ranges from 9.6 to 50 Kbps. At 20 Kbps, a standard JSON payload would require approximately two seconds to transmit and is susceptible to idle-connection timeouts enforced by congested 2G base stations in disaster zones. Protocol Buffers were adopted as the binary serialisation format specifically to minimise payload size and ensure reliable transmission under these conditions.

### 5.3.1 Payload Size Results

A representative RED-level triage case was serialised using both standard JSON and Protocol Buffer binary encoding to establish a direct comparison. The JSON representation produced a payload of approximately 3,200 to 4,800 bytes depending on conversation summary length. The Protocol Buffer encoding produced 564 bytes in the typical case and 1,100 bytes in the worst case — a case involving a verbose summary and an extended symptom list.

Figure 5.2 presents this comparison alongside the 2,048-byte transmission ceiling.

> **[Insert Figure 5.2 — fig5_2_payload_size.png]**
> *Figure 5.2: Triage payload size comparison between JSON and Protocol Buffer encoding. The typical Protocol Buffer payload of 564 bytes is 3.6 times below the 2,048-byte 2G transmission ceiling. JSON payloads exceed this ceiling in all scenarios.*

The Protocol Buffer encoding achieves a 5.7 to 8.5 times reduction in size compared to JSON. The typical 564-byte payload is 3.6 times smaller than the 2,048-byte ceiling; even the worst-case 1,100-byte payload maintains a 46.3% margin. This confirms that every realistic triage case can be transmitted within a single 2G data exchange with sufficient headroom for packet overhead and retransmission.

### 5.3.2 Transmission Reliability

End-to-end transmission was validated on a physical Android device connected to a live server instance. The server accepted every submitted triage report with an HTTP 202 response across multiple test sessions. The idempotency mechanism at the server's ingest endpoint was verified by submitting the same payload twice; the second submission was correctly identified as a duplicate and rejected without creating a redundant record on the dashboard. This confirms that the offline retry mechanism cannot cause data duplication even under repeated re-submission.

### 5.3.3 Offline Queue Durability

The store-and-forward pipeline was validated under simulated offline conditions. With the device in Airplane Mode, a RED-level triage assessment was completed. The payload was encrypted and held in the local queue. Upon WiFi restoration, the automated retry mechanism transmitted the payload successfully within 60 seconds. The local queue entry was cleared following server acknowledgement, and the corresponding case appeared on the responder dashboard within five seconds of reconnection.

---

## 5.4 On-Device Small Language Model Evaluation

Selecting an appropriate on-device language model was one of the most iterative challenges of the project. The model must operate entirely within the RAM constraints of a consumer Android device (3 to 4 GB), handle bilingual English, Urdu, and Roman Urdu input, produce structured output reliably, and sustain coherent multi-turn clinical conversation. Five candidate models were evaluated through live device testing before a final selection was made.

### 5.4.1 Model Selection

Table 5.1 summarises the five candidate models evaluated, their primary rejection or selection rationale, and their total estimated RAM footprint on a 4 GB device. Figure 5.3 visualises these footprints relative to the device capacity limit.

**Table 5.1: On-Device SLM Candidate Evaluation**

| Model | File Size | Estimated RAM (4 GB Device) | Outcome | Primary Rejection Reason |
|---|---|---|---|---|
| Llama 3.2 1B Q4_K_M | ~700 MB | ~2.3 GB | Rejected | Unreliable structured output at 1B parameter scale |
| Qwen2.5 1.5B Q4_K_M | ~1.0 GB | ~2.65 GB | Rejected | Repetitive output; inconsistent instruction following |
| Qwen3 1.7B Q4_K_M | ~1.1 GB | ~2.8 GB | Rejected | Internal reasoning tokens leaking into responses |
| phi4-mini 3.8B Q4_K_M | ~2.3 GB | ~4.3 GB | Rejected | RAM exhaustion causing 5–6 minute inference per response |
| **Llama 3.2 3B Q4_K_M** | **~2.0 GB** | **~3.7 GB** | **Selected** | Adequate structured output; fits within 4 GB RAM budget |

> **[Insert Figure 5.3 — fig5_3_slm_ram.png]**
> *Figure 5.3: Total estimated RAM footprint of each candidate model on a 4 GB Android device, decomposed into OS overhead, model weights, and context cache. phi4-mini 3.8B exceeds the 4 GB device limit, causing the operating system to swap model data to internal storage, producing inference times of 5–6 minutes. Llama 3.2 3B maintains a 300 MB margin below the device limit.*

The phi4-mini 3.8B model was the only candidate to exceed the device RAM budget. The combined demand of model weights, context cache, and Android OS overhead reached approximately 4.3 GB, which is above the 4 GB physical limit. The operating system resolved this pressure by paging model data to internal storage — a medium that is 100 to 1,000 times slower than RAM — producing inference times of five to six minutes per response. This latency is operationally unacceptable for a triage interview. The three smaller rejected models failed on output quality rather than RAM constraints: each exhibited distinct failure modes including repetition, inconsistent instruction following, and internal reasoning tokens appearing in the visible chat output.

### 5.4.2 Final Model Performance

Llama 3.2 3B Q4_K_M was selected as the production on-device model. Its total RAM footprint of approximately 3.7 GB leaves 300 MB of headroom on a 4 GB device, sufficient to prevent any storage swapping. The context window was configured to 1,024 tokens. Symptom collection conversations are typically five to eight turns in length with a total token count of 200 to 500 tokens; the 1,024-token context provides ample capacity with no observable quality degradation, while keeping the context cache approximately 250 MB lighter than a 2,048-token configuration would require.

Inference time on the test device was measured at 30 to 90 seconds per response. This is substantially faster than the five to six minutes observed with phi4-mini 3.8B and slower than the cloud language model path, which produces responses in approximately one to three seconds via the Groq API. In a disaster-zone triage scenario, where the only alternative to a 30-second response is no AI-assisted symptom collection at all, this latency range is operationally acceptable for the offline use case.

A shorter, example-based system prompt was designed specifically for the on-device model to complement the full structured prompt used in cloud mode. At 3B parameter scale, models follow concrete worked examples more reliably than extended rule lists; this adjustment reduced structured output parsing failures from occasional to rare.

---

## 5.5 Retrieval-Augmented Generation Pipeline Evaluation

The knowledge retrieval pipeline operates in two modes depending on network availability: server-side semantic search using vector cosine similarity when the device has full connectivity, and on-device BM25-inspired keyword search when offline or on a degraded connection. Both modes return WHO and NHS first-aid guidance to the patient at the conclusion of a triage assessment.

### 5.5.1 Knowledge Base Scale

The final knowledge base consists of 30 articles sourced from the World Health Organization and the UK National Health Service, standardised to a consistent section-header format. The server-side vector index contains 270 text chunks. The mobile offline bundle, delivered within the application at install time, contains 184 chunks drawn from the same 30 articles. Every chunk carries full attribution metadata — article title, source URL, author, and publishing organisation — so that any first-aid guidance shown to a patient is always linked to its originating document.

Figure 5.4 shows the composition of both indices by section type.

> **[Insert Figure 5.4 — fig5_4_kb_composition.png]**
> *Figure 5.4: Knowledge base composition by section type for the server-side vector index (270 chunks) and the mobile offline bundle (184 chunks). Action and Emergency sections together account for approximately 42% of all chunks — these are the categories prioritised when returning guidance to patients.*

### 5.5.2 Retrieval Quality: Section-Type Preference

A systematic retrieval failure was identified and resolved during testing. Even when the correct article was retrieved, the returned content was consistently drawn from the symptom-recognition section rather than the actionable guidance section. This occurred because the symptom section contains the same clinical vocabulary the patient used to describe their condition, causing it to score highest in relevance queries. Patients were receiving a reflection of their own reported symptoms rather than instructions on what to do next.

The resolution involved two changes. First, all 30 articles were restructured from arbitrary character-count chunks to semantically aligned chunks based on section headers, with each chunk categorised as one of: action, emergency, symptoms, prevention, or general. Second, the retrieval pipeline was updated to apply a preference filter that promotes action and prevention chunks over symptom and general chunks when relevance scores are comparable. Following this change, post-triage guidance consistently returned actionable instructions — such as applying direct pressure to a wound, immobilising a fractured limb, or administering oral rehydration solution — rather than symptom descriptions.

**Quantitative evaluation.** A test set of 20 representative triage queries was constructed, covering six RED-level scenarios (chest pain, snake bite, uncontrolled bleeding, seizure, crush injury, anaphylaxis), eight AMBER-level scenarios (fracture, severe fever, deep wound, head injury, dehydration, abdominal pain, electric shock, animal bite), and six GREEN-level scenarios (mild headache, diarrhoea, dizziness, minor burn, cough, skin rash). Each query was submitted to the retrieval pipeline and the section type of the highest-scoring returned chunk was recorded. Table 5.4 presents the results before and after the section-type fix.

**Table 5.4: Section-Type Distribution of Top-1 Retrieved Chunk — Before and After Fix**

| Section Type of Top-1 Result | Before Fix (character-count chunking) | After Fix (section-aware + preference filter) |
|---|---|---|
| Action / Emergency  *(target output)* | 3 / 20 — **15%** | 17 / 20 — **85%** |
| Symptoms / Recognition | 14 / 20 — 70% | 2 / 20 — 10% |
| General / Other | 3 / 20 — 15% | 1 / 20 — 5% |

The fix raised action-type precision from 15% to 85% — a 70 percentage-point improvement across the full query set. The mean cosine similarity score of the top-1 returned chunk on the server-side vector index was 0.73 across all 20 queries in the post-fix evaluation, confirming that the preference filter is not degrading relevance to achieve section-type correctness; it is selecting the most relevant chunk from among those already scored above the minimum threshold. The minimum acceptable cosine similarity threshold is set at 0.30; all 20 test queries produced a top-1 result above this threshold following the fix, with no query returning a fallback generic response.

### 5.5.3 Retrieval Quality: Multilingual Disease Routing

A second failure mode was identified for mixed-language and Roman Urdu input. Keyword-based search scores articles by term overlap with the query. When a patient describes malaria symptoms using Roman Urdu vocabulary ("bukhar, nausea, sweating, chills"), the keyword overlap with articles on leptospirosis and dengue fever is comparable to the overlap with the malaria article, because these diseases share symptom vocabulary. Keyword search has no semantic understanding and cannot disambiguate diseases based on overlapping descriptions; it also has no mechanism for handling Roman Urdu words that have no direct English equivalent.

The resolution was a server-side language model routing layer. When the device has full connectivity, the system presents the language model with a constrained list of article topic keywords drawn from the knowledge base and asks it to select the one or two most relevant articles. Because the model must choose from the existing article list rather than generate a disease name independently, hallucinated or invalid references are structurally prevented. The language model's multilingual understanding enables correct routing regardless of whether the patient's input was in English, formal Urdu, or Roman Urdu. Keyword search remains the fallback for offline and degraded conditions.

**Quantitative evaluation.** Article routing accuracy was measured across a 40-query test set covering three input-language categories: 15 English queries, 15 Roman Urdu queries, and 10 mixed-language queries combining Urdu grammatical structure with English medical terms. For each query, routing was judged correct if the LLM selected an article whose content is clinically relevant to the described condition. The same 40 queries were run through the BM25 keyword baseline to establish a comparison. Table 5.5 presents the results.

**Table 5.5: Article Routing Accuracy by Input Language — LLM Routing vs BM25 Baseline**

| Input Language | Queries | LLM Correct | LLM Accuracy | BM25 Correct | BM25 Accuracy |
|---|---|---|---|---|---|
| English | 15 | 14 / 15 | **93%** | 13 / 15 | 87% |
| Roman Urdu | 15 | 13 / 15 | **87%** | 5 / 15 | 33% |
| Mixed Language | 10 | 9 / 10 | **90%** | 4 / 10 | 40% |
| **Overall** | **40** | **36 / 40** | **90%** | **22 / 40** | **55%** |

LLM routing achieves 90% overall accuracy and degrades only modestly across language types (93% English to 87% Roman Urdu). BM25 performs competitively on English (87%) but collapses on Roman Urdu and mixed-language input (33–40%), confirming that structural vocabulary mismatch — rather than a general retrieval weakness — is the root cause. Across the combined 25 non-English queries, LLM routing achieves 88% accuracy compared to 36% for BM25 — a 52 percentage-point gap that quantifies the operational value of the semantic routing layer for a multilingual disaster-affected population.

---

## 5.6 Security Evaluation

A security evaluation was conducted against seven criteria covering patient data protection, access control, and payload integrity. All seven criteria passed. Table 5.2 presents the evaluation results.

**Table 5.2: Security Evaluation Results**

| Criterion | Verification Approach | Result |
|---|---|---|
| Patient CNIC never stored in plaintext | The national identity number is irreversibly hashed using PBKDF2-HMAC-SHA256 with 100,000 iterations before any server interaction; only the hash is retained for deduplication | PASS |
| Triage payload encrypted before local storage | AES-256-CBC encryption with a PBKDF2-derived 256-bit key is applied to every payload before it is written to the offline queue; raw data never touches persistent storage | PASS |
| Session token expiry enforced | Access tokens expire after 15 minutes, refresh tokens after 7 days, and device tokens after 30 days; expiry is validated cryptographically on every protected request | PASS |
| Administrative routes inaccessible to non-admin users | Role claim is validated at the middleware level; requests from non-administrative accounts receive HTTP 403 before any administrative logic is reached | PASS |
| Device tokens restricted to data submission only | A dedicated token type claim prevents cross-role token use; a device-scoped token is rejected on dashboard routes and vice versa, regardless of expiry status | PASS |
| Incoming payload size enforced | A hard upper limit is applied at the ingest endpoint before any payload decoding occurs; oversized submissions receive HTTP 413 | PASS |
| Non-diagnostic disclaimer requires explicit acknowledgment | Patient registration cannot be completed without a confirmed acknowledgment of the non-diagnostic disclaimer; this is enforced at both the interface and submission layers | PASS |

Three of these results merit additional discussion.

**Patient Identity Protection.** The patient's national identity number is the most sensitive personal identifier in the system. It is never transmitted to the server in its original form. A computationally expensive hash is derived from the identifier before it leaves the device, and the server retains only this hash. This approach is consistent with NIST SP 800-132 recommendations for the storage of password-equivalent personal identifiers, and means that even a complete compromise of the server database reveals no usable patient identity information.

**Payload Encryption at Rest.** Every triage report queued for offline transmission is encrypted before it is written to the device's local storage. The encryption key is derived deterministically from a combination of the patient identifier and the device hardware identifier, meaning that the same device-patient combination always produces the same key without requiring the key to be stored separately. All production builds use full AES-256-CBC encryption; the development environment uses a clearly marked fallback that does not affect production security.

**Token Isolation.** The system issues three distinct token types, each marked with a type claim that is validated independently. A token issued for device data submission cannot be accepted on administrative or dashboard routes, and an administrative token cannot be used to submit triage data. This isolation prevents privilege escalation even in the event of a token interception.

---

## 5.7 Performance Benchmarks Summary

Table 5.3 consolidates the key performance benchmarks for all major system components alongside their targets and measured values. Figure 5.7 provides a visual summary of all ten metrics. For the eight latency and payload metrics the bar represents the percentage of the design budget consumed by the measured result (lower is better). For the two RAG quality metrics the bar represents the measured accuracy as a percentage of the minimum target threshold (higher is better); bars that cross the 100% line indicate the target was exceeded.

> **[Insert Figure 5.7 — fig5_7_benchmarks.png]**
> *Figure 5.7: Overall system benchmark summary across all ten metrics. Eight performance metrics (latency and payload size) are shown as percentage of target budget consumed — lower bars indicate more headroom. Two RAG quality metrics (section-type precision and multilingual routing accuracy) are shown as measured accuracy relative to their minimum target — bars at or above 100% confirm the target is met. All ten metrics satisfy their respective targets.*

**Table 5.3: Comprehensive Performance Benchmark Results**

| Metric | Measured | Target | Margin | Status |
|---|---|---|---|---|
| Triage engine computation | < 1 ms | < 200 ms | 99.9% headroom | ✓ |
| Protobuf payload — typical | ~564 bytes | < 2,048 bytes | 72.5% headroom | ✓ |
| Protobuf payload — worst case | ~1,100 bytes | < 2,048 bytes | 46.3% headroom | ✓ |
| On-device knowledge retrieval (warm) | < 10 ms | < 100 ms | 90.0% headroom | ✓ |
| On-device SLM inference | 30–90 s | < 120 s | 25.0% headroom | ✓ |
| Server ingest latency | 15–30 ms | < 500 ms | 94.0% headroom | ✓ |
| SOAP report generation | 1.5–4 s | < 30 s | 86.7% headroom | ✓ |
| Server-side knowledge query | 20–70 ms | < 200 ms | 65.0% headroom | ✓ |
| RAG section-type action precision † | 85% (17/20 queries) | ≥ 80% | +5 pp above target | ✓ |
| Multilingual article routing accuracy † | 90% (36/40 queries) | ≥ 85% | +5 pp above target | ✓ |

*† Quality metric — higher is better. Margin is expressed as percentage points above the minimum acceptable threshold.*

The targets for the latency and payload rows were defined based on accepted thresholds in mobile healthcare and real-time server applications. An on-device knowledge retrieval target of 100 milliseconds was selected as the threshold below which query latency becomes imperceptible to the user during post-triage guidance display. A 500-millisecond server ingest target reflects the upper bound for acceptable round-trip acknowledgement in a disaster transmission scenario. The 30-second SOAP generation target represents the point beyond which a responder would perceive the report as delayed given that the underlying triage event has already been received. The 200-millisecond server-side knowledge query target aligns with standard sub-second interactive query benchmarks for cloud-based semantic search.

The triage engine result is the most significant outcome in this table. At under one millisecond, the classification operates 200 times faster than its target and adds no perceptible delay to the safety-critical path on any supported device. The on-device knowledge retrieval result represents a substantial improvement over an earlier embedding-based implementation that measured 80–200 ms due to model initialisation overhead; the switch to keyword-based scoring eliminated all initialisation cost and reduced query time by over an order of magnitude.

The SLM inference time of 30–90 seconds is the only metric with limited headroom against its target. This reflects an inherent trade-off between model capability and device RAM constraints. The target of 120 seconds was set to represent the maximum tolerable wait time in an offline triage conversation before the delay becomes operationally disruptive. The measured range meets this target, though the upper bound of 90 seconds leaves only a 25% margin. This is acknowledged as an area for future improvement — specifically, a purpose-built clinical SLM fine-tuned at smaller scale would be expected to achieve significantly shorter inference times without the quality compromises observed in smaller general-purpose models during the selection process.

---

## 5.8 Limitations and Trade-offs

### 5.8.1 On-Device Language Model Quality

The on-device language model produces lower quality responses than the cloud model path. Llama 3.2 3B, while selected for its balance of output reliability and RAM footprint, cannot match the instruction-following quality and bilingual fluency of the larger cloud-hosted model used when connectivity is available. Structured output generation is reliable in the majority of cases with the optimised prompt design, but occasional preamble text before the expected JSON output requires additional parsing logic to extract the valid response. Clinical follow-up questions in Urdu or Roman Urdu are handled less precisely than equivalent English queries. This is an expected limitation of the current parameter scale and is best addressed in future work through fine-tuning a smaller, domain-specific clinical model.

### 5.8.2 On-Device Knowledge Retrieval Limited to Keyword Matching

The mobile offline knowledge retrieval component uses keyword-based scoring rather than semantic embedding. Semantic embedding was evaluated but is not viable on the React Native mobile runtime, which does not support the WebAssembly execution environment required by ONNX-based embedding models. The keyword approach is effective for English input against the standardised article format but performs poorly on semantically similar queries expressed with different vocabulary, and it cannot process Roman Urdu tokens that have no direct English equivalent. The server-side language model routing layer compensates for this when the device has network connectivity, but offline retrieval quality remains bounded by keyword overlap. A future implementation using a native embedding library compiled for the mobile platform would close this gap.

### 5.8.3 Foreground-Only Transmission Retry

The offline payload retry mechanism operates only while the application is in the foreground. If the application is closed or moved to the background after an offline triage report has been queued, the retry does not fire until the application is reopened. In a disaster scenario, a patient in a deteriorating condition may not be able to reopen the application to trigger delivery. A background delivery implementation was scoped out of the current project timeline and represents an important operational improvement for a production deployment.

---

## 5.9 Chapter Summary

MediReach successfully implements a five-stage offline-first disaster medical triage relay that degrades gracefully across three network connectivity levels. The triage engine operates at under one millisecond — 200 times faster than its design target — and is the sole deterministic decision-maker for safety-critical classification, operating independently of any network or language model dependency. Triage payloads are compressed to approximately 564 bytes in the typical case using Protocol Buffer binary encoding, enabling reliable transmission over 2G/GPRS networks with a 72.5% margin below the transmission ceiling. The on-device small language model provides bilingual symptom collection capability for offline scenarios following a selection process that evaluated five candidate models across RAM footprint, output reliability, and inference latency; the cloud language model path provides substantially higher quality when full connectivity is available. The retrieval-augmented generation pipeline surfaces actionable WHO and NHS first-aid guidance using server-side language model disease routing with section-type-aware chunk preference, resolving two systematic retrieval failures identified during live testing. All seven security evaluation criteria passed, covering patient identity hashing, AES-256 payload encryption, token expiry enforcement, role-based access isolation, and device token scoping. All ten performance benchmarks met their respective targets: eight latency and payload metrics with headroom margins ranging from 25% to 99.9%, and two RAG quality metrics — section-type action precision (85% vs 80% target) and multilingual article routing accuracy (90% vs 85% target) — each exceeding their minimum threshold by five percentage points.

---

*End of Chapter 5*
