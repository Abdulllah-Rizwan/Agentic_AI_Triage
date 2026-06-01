import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { networkStore, NetworkMode } from '../../store/networkStore';
import { CloudLLMAdapter } from '../llm/CloudLLMAdapter';
import { slmAdapter } from '../llm/SLMAdapter';
import { LLMAdapter } from '../llm/LLMAdapter.interface';
import { logger } from '../../utils/logger';

const TAG = 'NetworkOrchestrator';

// Dev-only: set EXPO_PUBLIC_FORCE_SLM=true in .env to always use the SLM adapter
// regardless of actual network state. Lets you test the SLM via Ollama while on WiFi.
// Has no effect in production builds (EXPO_PUBLIC_ENVIRONMENT !== 'development').
const FORCE_SLM =
  process.env.EXPO_PUBLIC_ENVIRONMENT === 'development' &&
  process.env.EXPO_PUBLIC_FORCE_SLM === 'true';

type ModeChangeCallback = (mode: NetworkMode) => void;

const CONNECTIVITY_RESTORED_CALLBACKS: Array<() => void> = [];

function classifyState(state: NetInfoState): NetworkMode {
  // Only treat as OFFLINE when there is no network connection at all.
  // We deliberately ignore isInternetReachable because:
  //   (a) In dev, the server is a local LAN IP — Android's internet check
  //       (which pings 8.8.8.8) returns false even though the server IS reachable.
  //   (b) In production the server is deployed publicly, so isConnected is sufficient.
  if (!state.isConnected) {
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

      logger.info(TAG, `network state`, {
        mode,
        type: state.type,
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      });

      if (prev !== null && prev !== mode) {
        logger.info(TAG, `mode changed: ${prev} → ${mode}`);
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
    if (FORCE_SLM) {
      logger.info(TAG, 'getLLMAdapter() → SLM (FORCE_SLM override active)');
      return slmAdapter;
    }
    const adapter = mode === 'FULL' ? 'CloudLLM' : 'SLM (Ollama/on-device)';
    logger.info(TAG, `getLLMAdapter() → ${adapter}`, { mode });
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
