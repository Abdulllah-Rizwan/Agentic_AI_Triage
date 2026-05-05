// Safety-critical module — deterministic, synchronous, zero external dependencies.
//
// DO NOT modify the keyword lists without medical review (DECISIONS.md DEC-005).
// DO NOT replace this with an LLM — triage must produce a result offline in <200 ms.

export type TriageLevel = 'RED' | 'AMBER' | 'GREEN';

export interface MedicalFeatureVector {
  chiefComplaint: string;
  onsetTime: string;
  severity: number;             // 1–10 self-reported
  associatedSymptoms: string[];
  allergies: string[];
  conversationSummary: string;
  rawTranscript: Array<{ role: string; content: string }>;
}

export interface TriageResult {
  level: TriageLevel;
  reason: string;
  triggeredKeyword: string | null;
}

// ── Clinically derived keyword lists — DO NOT MODIFY ─────────────────────────

const RED_KEYWORDS: readonly string[] = [
  'chest pain',
  'heart attack',
  'cannot breathe',
  'difficulty breathing',
  "can't breathe",
  'uncontrolled bleeding',
  'haemorrhage',
  'hemorrhage',
  'unconscious',
  'unresponsive',
  'not breathing',
  'crush injury',
  'crushed',
  'amputation',
  'amputated',
  'seizure',
  'convulsion',
  'snake bite',
  'snakebite',
  'anaphylaxis',
  'allergic reaction severe',
  'stroke',
  'paralysis',
  'facial droop',
  'severe burn',
  'drowning',
  'choking',
  'head injury severe',
  'skull fracture',
  'electric shock',
  'electrocution',
  'gunshot',
  'stab wound',
  'impalement',
] as const;

const AMBER_KEYWORDS: readonly string[] = [
  'fracture',
  'broken bone',
  'deep wound',
  'deep cut',
  'laceration',
  'fever above 39',
  'high fever',
  'vomiting blood',
  'blood in vomit',
  'abdominal pain severe',
  'abdomen pain',
  'head injury',
  'concussion',
  'blunt trauma',
  'infection',
  'wound infected',
  'pus',
  'dehydration',
  'cannot keep water down',
  'diabetic',
  'low blood sugar',
  'fainting',
  'dislocation',
  'sprain severe',
  'eye injury',
  'cannot see',
  'pregnancy complication',
  'labour pain',
] as const;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a MedicalFeatureVector into RED / AMBER / GREEN using the START
 * triage protocol. Runs synchronously in <1 ms — no network, no LLM.
 */
export function computeTriage(vector: MedicalFeatureVector): TriageResult {
  const text = [
    vector.chiefComplaint,
    ...vector.associatedSymptoms,
    vector.conversationSummary,
  ]
    .join(' ')
    .toLowerCase();

  // RED — immediate life threat
  if (vector.severity >= 8) {
    const keyword = _firstMatch(text, RED_KEYWORDS);
    return {
      level: 'RED',
      reason: keyword
        ? `Critical symptom detected: ${keyword}. Immediate medical attention required.`
        : 'Severity score 8 or above — immediate medical attention required.',
      triggeredKeyword: keyword,
    };
  }

  const redKeyword = _firstMatch(text, RED_KEYWORDS);
  if (redKeyword) {
    return {
      level: 'RED',
      reason: `Critical symptom detected: ${redKeyword}. Immediate medical attention required.`,
      triggeredKeyword: redKeyword,
    };
  }

  // AMBER — urgent but stable
  if (vector.severity >= 5) {
    const keyword = _firstMatch(text, AMBER_KEYWORDS);
    return {
      level: 'AMBER',
      reason: keyword
        ? `Urgent symptom detected: ${keyword}. Medical attention needed soon.`
        : 'Severity score 5 or above — medical attention needed soon.',
      triggeredKeyword: keyword,
    };
  }

  const amberKeyword = _firstMatch(text, AMBER_KEYWORDS);
  if (amberKeyword) {
    return {
      level: 'AMBER',
      reason: `Urgent symptom detected: ${amberKeyword}. Medical attention needed soon.`,
      triggeredKeyword: amberKeyword,
    };
  }

  // GREEN — no immediate threat
  return {
    level: 'GREEN',
    reason: 'No immediately life-threatening indicators detected.',
    triggeredKeyword: null,
  };
}

/**
 * Check raw user input for critical (RED) symptoms before sending to the LLM.
 * Called by SymptomCollectorAgent as a safety gate — must run synchronously.
 *
 * Returns the matched keyword string, or null if none found.
 */
export function detectCriticalSymptom(text: string): string | null {
  return _firstMatch(text.toLowerCase(), RED_KEYWORDS);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _firstMatch(
  text: string,
  keywords: readonly string[],
): string | null {
  for (const keyword of keywords) {
    if (text.includes(keyword)) return keyword;
  }
  return null;
}
