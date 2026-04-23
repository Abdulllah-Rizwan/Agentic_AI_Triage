# Protobuf Schema — Agentic AI Triage Payload

This file documents the Protocol Buffer schema used to transmit triage data from the patient's phone to the server.

**Source file:** `proto/triage.proto`
**Purpose:** Compress the triage payload to ~800 bytes so it can be transmitted over 2G/GPRS in disaster zones where bandwidth is scarce.

---

## Why Protobuf?

A JSON version of the same triage payload is ~4KB. The protobuf binary version is ~800 bytes. On a 2G connection with 20KB/s throughput and high packet loss, the difference is real: a 4KB JSON payload may timeout and retry multiple times, while an 800-byte protobuf payload succeeds on the first attempt.

---

## Schema Definition

```protobuf
// proto/triage.proto
syntax = "proto3";

message PatientProfile {
  string cnic      = 1;   // Pakistan ID number — 13 digits formatted as XXXXX-XXXXXXX-X
  string name      = 2;   // Full name
  string phone     = 3;   // Phone number with country code: +92-XXX-XXXXXXX
  double lat       = 4;   // GPS latitude
  double lng       = 5;   // GPS longitude
}

message LeanPayload {
  string        case_id              = 1;   // UUID generated on device — idempotency key
  PatientProfile patient             = 2;
  string        chief_complaint      = 3;   // Single sentence describing main issue
  repeated string symptoms           = 4;   // List of symptom strings
  int32         severity             = 5;   // 1–10 scale, patient self-reported
  string        triage_level         = 6;   // "RED" | "AMBER" | "GREEN"
  string        triage_reason        = 7;   // Human-readable explanation of triage decision
  string        conversation_summary = 8;   // LLM-generated summary of full chat transcript
  int64         timestamp_unix       = 9;   // Unix epoch seconds when assessment was completed
  string        device_id            = 10;  // Unique device identifier
  string        network_mode         = 11;  // "FULL" | "DEGRADED" | "OFFLINE" at time of submission
}
```

---

## Field Size Guidelines

Keep payloads under 2KB total. The fields most likely to bloat are:
- `conversation_summary` — keep under 500 characters. The agent summarises the full conversation into a single paragraph.
- `symptoms` — list of short strings, max 10 items, each under 50 chars.
- `triage_reason` — one sentence, under 200 chars.

---

## Regenerating Language Bindings

Any time you change `proto/triage.proto`, you must regenerate the bindings for both Python (backend) and JavaScript (mobile). Run from the project root:

```bash
# Python bindings (for the FastAPI backend)
protoc --python_out=apps/api/app/proto/ proto/triage.proto

# JavaScript/TypeScript bindings (for the React Native mobile app)
npx protoc --ts_out=apps/mobile/src/proto/ --proto_path=proto proto/triage.proto
```

**Do not edit the generated files manually.** They are always overwritten by the command above.

---

## Encoding Example (TypeScript — Mobile App)

```typescript
import { LeanPayload } from '../proto/triage';

const payload: LeanPayload = {
  caseId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  patient: {
    cnic: '42201-1234567-8',
    name: 'Ahmed Khan',
    phone: '+92-300-1234567',
    lat: 24.8607,
    lng: 67.0011,
  },
  chiefComplaint: 'Severe chest pain with difficulty breathing',
  symptoms: ['chest pain', 'shortness of breath', 'left arm numbness'],
  severity: 9,
  triageLevel: 'RED',
  triageReason: 'Keyword match: chest pain + difficulty breathing; severity 9',
  conversationSummary: '55yr male, crushing chest pain onset 30min ago, radiating to left arm. No allergies.',
  timestampUnix: Math.floor(Date.now() / 1000),
  deviceId: 'device-abc-123',
  networkMode: 'DEGRADED',
};

const encoded: Uint8Array = LeanPayload.encode(payload).finish();
console.log(`Payload size: ${encoded.byteLength} bytes`); // Should be ~700-900 bytes
```

## Decoding Example (Python — Backend)

```python
from app.proto import triage_pb2

def decode_payload(raw_bytes: bytes) -> triage_pb2.LeanPayload:
    payload = triage_pb2.LeanPayload()
    payload.ParseFromString(raw_bytes)
    return payload

# Usage in FastAPI route:
# raw_body = await request.body()
# payload = decode_payload(raw_body)
# print(payload.patient.name)   # "Ahmed Khan"
# print(payload.triage_level)   # "RED"
```
