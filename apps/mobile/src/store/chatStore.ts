import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

export type CollectionStatus = 'IDLE' | 'COLLECTING' | 'SUFFICIENT' | 'CRITICAL';

interface ChatState {
  messages: ChatMessage[];
  isAgentTyping: boolean;
  emergencyDetected: boolean;
  emergencyTrigger: string | null;
  collectionStatus: CollectionStatus;
  addMessage: (message: ChatMessage) => void;
  setAgentTyping: (typing: boolean) => void;
  setEmergencyDetected: (trigger: string) => void;
  setCollectionStatus: (status: CollectionStatus) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isAgentTyping: false,
  emergencyDetected: false,
  emergencyTrigger: null,
  collectionStatus: 'IDLE',
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setAgentTyping: (isAgentTyping) => set({ isAgentTyping }),
  setEmergencyDetected: (trigger) =>
    set({ emergencyDetected: true, emergencyTrigger: trigger }),
  setCollectionStatus: (collectionStatus) => set({ collectionStatus }),
  clearChat: () =>
    set({
      messages: [],
      isAgentTyping: false,
      emergencyDetected: false,
      emergencyTrigger: null,
      collectionStatus: 'IDLE',
    }),
}));
