import { create } from 'zustand';

interface TransmissionState {
  lastTransmittedCaseId: string | null;
  lastTransmittedAt: number | null;
  setLastTransmitted: (caseId: string) => void;
}

export const useTransmissionStore = create<TransmissionState>((set) => ({
  lastTransmittedCaseId: null,
  lastTransmittedAt: null,
  setLastTransmitted: (caseId) =>
    set({ lastTransmittedCaseId: caseId, lastTransmittedAt: Date.now() }),
}));
