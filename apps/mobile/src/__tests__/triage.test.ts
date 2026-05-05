// Pure TypeScript — no native deps, no mocks required.

import {
  computeTriage,
  detectCriticalSymptom,
  type MedicalFeatureVector,
} from '../services/triage/TriageEngine';

function makeVector(overrides: Partial<MedicalFeatureVector> = {}): MedicalFeatureVector {
  return {
    chiefComplaint: 'mild headache',
    onsetTime: '2 hours ago',
    severity: 2,
    associatedSymptoms: [],
    allergies: [],
    conversationSummary: '',
    rawTranscript: [],
    ...overrides,
  };
}

describe('computeTriage', () => {
  test('RED: keyword in chief complaint', () => {
    const result = computeTriage(makeVector({ chiefComplaint: 'chest pain' }));
    expect(result.level).toBe('RED');
  });

  test('RED: severity >= 8 with no keywords', () => {
    const result = computeTriage(makeVector({ severity: 9 }));
    expect(result.level).toBe('RED');
  });

  test('AMBER: keyword detection', () => {
    const result = computeTriage(
      makeVector({ chiefComplaint: 'possible fracture in my arm', severity: 3 }),
    );
    expect(result.level).toBe('AMBER');
  });

  test('GREEN: default when no keywords and low severity', () => {
    const result = computeTriage(makeVector({ chiefComplaint: 'mild headache', severity: 2 }));
    expect(result.level).toBe('GREEN');
  });

  test('RED takes priority over AMBER', () => {
    const result = computeTriage(
      makeVector({
        chiefComplaint: 'fracture',
        associatedSymptoms: ['cannot breathe'],
        severity: 4,
      }),
    );
    expect(result.level).toBe('RED');
  });
});

describe('detectCriticalSymptom', () => {
  test('detects "chest pain" in message', () => {
    expect(detectCriticalSymptom('I have chest pain since this morning')).toBe('chest pain');
  });

  test('returns null for non-critical message', () => {
    expect(detectCriticalSymptom('I have a mild headache')).toBeNull();
  });
});
