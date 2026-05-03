export type TriageLevel = 'GREEN' | 'AMBER' | 'RED';

export interface TriageResult {
  level: TriageLevel;
  reason: string;
}

export interface MedicalFeatureVector {
  chiefComplaint: string;
  onsetTime: string;
  severity: number;
  associatedSymptoms: string[];
  allergies: string[];
  vitalSigns?: {
    heartRate?: number;
    respiratoryRate?: number;
  };
  conversationSummary: string;
  rawTranscript: Array<{ role: string; content: string }>;
}

// DO NOT MODIFY — clinically derived keyword lists
const RED_KEYWORDS = [
  'chest pain', 'heart attack', 'cannot breathe', 'difficulty breathing',
  'can\'t breathe', 'shortness of breath severe', 'uncontrolled bleeding',
  'haemorrhage', 'hemorrhage', 'unconscious', 'unresponsive',
  'crush injury', 'amputation', 'seizure', 'snake bite', 'anaphylaxis',
  'stroke', 'paralysis', 'severe burn', 'not breathing', 'cardiac arrest',
];

const AMBER_KEYWORDS = [
  'fracture', 'broken bone', 'deep wound', 'laceration', 'fever above 39',
  'vomiting blood', 'abdominal pain severe', 'head injury', 'blunt trauma',
  'electric shock', 'drowning', 'infection severe', 'dehydration severe',
  'high fever', 'concussion', 'sprain severe',
];

function detectReason(text: string, keywords: string[]): string {
  const matched = keywords.filter((k) => text.includes(k));
  return matched.length > 0
    ? `Keyword match: ${matched.slice(0, 3).join(', ')}`
    : 'Severity threshold exceeded';
}

export function computeTriage(vector: MedicalFeatureVector): TriageResult {
  const text = [
    vector.chiefComplaint,
    ...vector.associatedSymptoms,
    vector.conversationSummary,
  ]
    .join(' ')
    .toLowerCase();

  if (vector.severity >= 8 || RED_KEYWORDS.some((k) => text.includes(k))) {
    return { level: 'RED', reason: detectReason(text, RED_KEYWORDS) };
  }

  if (vector.severity >= 5 || AMBER_KEYWORDS.some((k) => text.includes(k))) {
    return { level: 'AMBER', reason: detectReason(text, AMBER_KEYWORDS) };
  }

  return { level: 'GREEN', reason: 'No immediately life-threatening indicators detected.' };
}
