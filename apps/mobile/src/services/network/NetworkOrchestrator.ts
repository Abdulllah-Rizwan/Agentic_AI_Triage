import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { networkStore, NetworkMode } from '../../store/networkStore';
import { CloudLLMAdapter } from '../llm/CloudLLMAdapter';
import { slmAdapter } from '../llm/SLMAdapter';
import { LLMAdapter } from '../llm/LLMAdapter.interface';

type ModeChangeCallback = (mode: NetworkMode) => void;

const CONNECTIVITY_RESTORED_CALLBACKS: Array<() => void> = [];

function classifyState(state: NetInfoState): NetworkMode {
  if (!state.isConnected || state.isInternetReachable === false) {
    return 'OFFLINE';
  }

  if (state.type === 'cellular') {
    const effective = (state.details as { cellularGeneration?: string } | null)
      ?.cellularGeneration;
    if (effective === '2g' || effective === '3g') {
      return 'DEGRADED';
    }
  }

  return 'FULL';
}

class NetworkOrchestratorClass {
  private unsubscribe: (() => void) | null = null;
  private modeChangeCallbacks: ModeChangeCallback[] = [];
  private cloudAdapter: CloudLLMAdapter = new CloudLLMAdapter();
  private previousMode: NetworkMode | null = null;

  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = NetInfo.addEventListener((state) => {
      const mode = classifyState(state);
      const prev = this.previousMode;

      networkStore.getState().setMode(mode);
      networkStore.getState().setConnected(state.isConnected ?? false);

      if (prev !== null && prev !== mode) {
        this.modeChangeCallbacks.forEach((cb) => cb(mode));

        if (prev === 'OFFLINE' && mode !== 'OFFLINE') {
          CONNECTIVITY_RESTORED_CALLBACKS.forEach((cb) => cb());
        }
      }

      this.previousMode = mode;
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getLLMAdapter(): LLMAdapter {
    const mode = networkStore.getState().mode;
    return mode === 'FULL' ? this.cloudAdapter : slmAdapter;
  }

  onModeChange(callback: ModeChangeCallback): () => void {
    this.modeChangeCallbacks.push(callback);
    return () => {
      this.modeChangeCallbacks = this.modeChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  onConnectivityRestored(callback: () => void): void {
    CONNECTIVITY_RESTORED_CALLBACKS.push(callback);
  }

  get currentMode(): NetworkMode {
    return networkStore.getState().mode;
  }
}

export const networkOrchestrator = new NetworkOrchestratorClass();
