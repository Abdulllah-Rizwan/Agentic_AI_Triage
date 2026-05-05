// TypeScript interfaces matching proto/triage.proto exactly.
// Encoding/decoding uses protobufjs loaded from the bundled JSON descriptor.

import protobuf from 'protobufjs';
import triageDescriptor from './triage.json';

export interface PatientProfile {
  cnic: string;
  name: string;
  phone: string;
  lat: number;
  lng: number;
}

export interface LeanPayload {
  caseId: string;
  patient: PatientProfile;
  chiefComplaint: string;
  symptoms: string[];
  severity: number;
  triageLevel: 'RED' | 'AMBER' | 'GREEN';
  triageReason: string;
  conversationSummary: string;
  timestampUnix: number;
  deviceId: string;
  networkMode: 'FULL' | 'DEGRADED' | 'OFFLINE';
}

// Lazy-loaded root — parsed once, reused on every call.
let _root: protobuf.Root | null = null;

function getRoot(): protobuf.Root {
  if (!_root) {
    _root = protobuf.Root.fromJSON(triageDescriptor as protobuf.INamespace);
  }
  return _root;
}

/**
 * Encodes a LeanPayload to binary protobuf.
 * Logs a warning if the result exceeds 2 KB (2G/GPRS budget).
 */
export function encodeLeanPayload(payload: LeanPayload): Uint8Array {
  const root = getRoot();
  const LeanPayloadType = root.lookupType('LeanPayload');

  const message = LeanPayloadType.create({
    case_id: payload.caseId,
    patient: {
      cnic:  payload.patient.cnic,
      name:  payload.patient.name,
      phone: payload.patient.phone,
      lat:   payload.patient.lat,
      lng:   payload.patient.lng,
    },
    chief_complaint:      payload.chiefComplaint,
    symptoms:             payload.symptoms,
    severity:             payload.severity,
    triage_level:         payload.triageLevel,
    triage_reason:        payload.triageReason,
    conversation_summary: payload.conversationSummary,
    timestamp_unix:       payload.timestampUnix,
    device_id:            payload.deviceId,
    network_mode:         payload.networkMode,
  });

  const encoded = LeanPayloadType.encode(message).finish() as Uint8Array;

  if (encoded.byteLength > 2048) {
    console.warn(
      `[Proto] Payload is ${encoded.byteLength} bytes — exceeds 2 KB target. ` +
      'Consider trimming conversationSummary.',
    );
  }

  return encoded;
}

/** Generates a UUID v4 using Math.random() — no external library needed. */
export function generateCaseId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Decodes binary protobuf back to a LeanPayload.
 * Used in tests and for the retry-queue flush path.
 */
export function decodeLeanPayload(bytes: Uint8Array): LeanPayload {
  const root = getRoot();
  const LeanPayloadType = root.lookupType('LeanPayload');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoded = LeanPayloadType.decode(bytes) as any;

  return {
    caseId:              decoded.case_id   ?? '',
    patient: {
      cnic:  decoded.patient?.cnic  ?? '',
      name:  decoded.patient?.name  ?? '',
      phone: decoded.patient?.phone ?? '',
      lat:   decoded.patient?.lat   ?? 0,
      lng:   decoded.patient?.lng   ?? 0,
    },
    chiefComplaint:      decoded.chief_complaint      ?? '',
    symptoms:            decoded.symptoms             ?? [],
    severity:            decoded.severity             ?? 0,
    triageLevel:         (decoded.triage_level        ?? 'GREEN') as 'RED' | 'AMBER' | 'GREEN',
    triageReason:        decoded.triage_reason        ?? '',
    conversationSummary: decoded.conversation_summary ?? '',
    timestampUnix:       decoded.timestamp_unix       ?? 0,
    deviceId:            decoded.device_id            ?? '',
    networkMode:         (decoded.network_mode        ?? 'OFFLINE') as 'FULL' | 'DEGRADED' | 'OFFLINE',
  };
}
