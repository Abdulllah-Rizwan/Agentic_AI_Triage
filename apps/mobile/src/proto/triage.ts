// Protobuf type definitions matching proto/triage.proto
// Used with protobufjs for encoding payloads

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
  triageLevel: string;
  triageReason: string;
  conversationSummary: string;
  timestampUnix: number;
  deviceId: string;
}

import protobuf from 'protobufjs';

const PROTO_DEFINITION = `
syntax = "proto3";

message PatientProfile {
  string cnic = 1;
  string name = 2;
  string phone = 3;
  double lat = 4;
  double lng = 5;
}

message LeanPayload {
  string case_id = 1;
  PatientProfile patient = 2;
  string chief_complaint = 3;
  repeated string symptoms = 4;
  int32 severity = 5;
  string triage_level = 6;
  string triage_reason = 7;
  string conversation_summary = 8;
  int64 timestamp_unix = 9;
  string device_id = 10;
}
`;

let _root: protobuf.Root | null = null;

function getRoot(): protobuf.Root {
  if (!_root) {
    _root = protobuf.parse(PROTO_DEFINITION).root;
  }
  return _root;
}

export function encodeLeanPayload(payload: LeanPayload): Uint8Array {
  const root = getRoot();
  const LeanPayloadType = root.lookupType('LeanPayload');

  const message = LeanPayloadType.create({
    case_id: payload.caseId,
    patient: {
      cnic: payload.patient.cnic,
      name: payload.patient.name,
      phone: payload.patient.phone,
      lat: payload.patient.lat,
      lng: payload.patient.lng,
    },
    chief_complaint: payload.chiefComplaint,
    symptoms: payload.symptoms,
    severity: payload.severity,
    triage_level: payload.triageLevel,
    triage_reason: payload.triageReason,
    conversation_summary: payload.conversationSummary,
    timestamp_unix: payload.timestampUnix,
    device_id: payload.deviceId,
  });

  return LeanPayloadType.encode(message).finish() as Uint8Array;
}
