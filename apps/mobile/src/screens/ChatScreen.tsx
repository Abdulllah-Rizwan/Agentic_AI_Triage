import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { SymptomCollectorAgent, type AgentSerializableState } from '../agents/SymptomCollectorAgent';
import {
  saveActiveSession, loadActiveSession, clearActiveSession,
  saveChatHistory, loadChatHistory, saveCompletedCase,
} from '../db/queries';
import {
  computeTriage,
  type MedicalFeatureVector,
} from '../services/triage/TriageEngine';
import { encodeLeanPayload, generateCaseId, type LeanPayload } from '../proto/triage';
import { encryptLeanPayload } from '../services/encryption/AESEncryption';
import { transmissionService } from '../services/transmission/TransmissionService';
import { queryGuidance } from '../services/rag/queryGuidance';
import { userStore } from '../store/userStore';
import { networkStore } from '../store/networkStore';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // sessions older than 24 h start fresh

interface SavedChatSession {
  messages: ChatMessage[];
  agentState: AgentSerializableState;
  screenState: {
    turnCount: number;
    emergencyRag: string | undefined;
    criticalTxStatus: 'IDLE' | 'SENDING' | 'SENT' | 'CACHED' | 'ERROR';
    criticalCaseId: string | null;
    criticalTxFired: boolean;
    emergencyTrigger: string | null;
    hasCompletedTriage?: boolean;
  };
  savedAt: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ChatScreen({ navigation, route }: Props) {
  const [input, setInput]                       = useState('');
  const [isInputDisabled, setIsInputDisabled]   = useState(false);
  const [turnCount, setTurnCount]               = useState(0);
  const [emergencyRag, setEmergencyRag]         = useState<string | undefined>();
  const [criticalTxStatus, setCriticalTxStatus] = useState<'IDLE' | 'SENDING' | 'SENT' | 'CACHED' | 'ERROR'>('IDLE');
  const [criticalCaseId, setCriticalCaseId]     = useState<string | null>(null);

  const [hasCompletedTriage, setHasCompletedTriage] = useState(false);

  const agentRef           = useRef<SymptomCollectorAgent | null>(null);
  const flatListRef        = useRef<FlatList<ChatMessage>>(null);
  const unmounted          = useRef(false);
  const criticalTxFired    = useRef(false);
  // Tracks the case ID generated in the CRITICAL path so _handlePostTriage can
  // link the saved history to the same case that was transmitted.
  const criticalCaseIdRef  = useRef<string | null>(null);
  const postTriagePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Holds the post-triage function so handleSend can call it without it being
  // a dependency of the useCallback — avoids a stale-closure trap.
  const handlePostTriageRef = useRef<((fv: MedicalFeatureVector) => Promise<void>) | null>(null);

  // Emergency bar — starts 220 px below visible area, springs to 0
  const barOffset = useRef(new Animated.Value(220)).current;

  // Typing-indicator dots
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  // Bottom inset — keeps input above phone navigation bar
  const insets = useSafeAreaInsets();

  // Guards the save effect from firing before the SQLite session has been loaded.
  // Without this, stale Zustand messages overwrite a completed session before
  // loadActiveSession() can read it, causing hasCompletedTriage to be lost.
  const sessionLoadedRef = useRef(false);

  // Zustand
  const messages             = useChatStore((s) => s.messages);
  const isAgentTyping        = useChatStore((s) => s.isAgentTyping);
  const emergencyDetected    = useChatStore((s) => s.emergencyDetected);
  const emergencyTrigger     = useChatStore((s) => s.emergencyTrigger);
  const addMessage           = useChatStore((s) => s.addMessage);
  const setMessages          = useChatStore((s) => s.setMessages);
  const setAgentTyping       = useChatStore((s) => s.setAgentTyping);
  const setEmergencyDetected = useChatStore((s) => s.setEmergencyDetected);
  const clearChat            = useChatStore((s) => s.clearChat);
  const setCollectionStatus  = useChatStore((s) => s.setCollectionStatus);

  // ── Startup — restore saved session, open readonly, or start fresh ──────────

  useEffect(() => {
    unmounted.current = false;
    navigation.setOptions({ headerShown: false });

    const readonlySession = route.params?.readonlySession;

    if (readonlySession) {
      // Readonly replay of a completed past assessment — no agent needed.
      setHasCompletedTriage(true);
      setIsInputDisabled(true);
      setCollectionStatus('SUFFICIENT');
      loadChatHistory(readonlySession.caseId).then((msgs) => {
        if (msgs && !unmounted.current) {
          setMessages(msgs as ChatMessage[]);
        } else if (!unmounted.current) {
          addMessage({
            id: 'no-history',
            role: 'agent',
            type: 'system',
            content: 'No conversation transcript was saved for this assessment.',
            timestamp: Date.now(),
          });
        }
      });
      return () => { unmounted.current = true; };
    }

    const agent = new SymptomCollectorAgent();
    agentRef.current = agent;

    (async () => {
      const saved = await loadActiveSession<SavedChatSession>();

      if (unmounted.current) return;

      if (saved && (saved.messages?.length ?? 0) > 0 && Date.now() - saved.savedAt < SESSION_MAX_AGE_MS) {
        // Mark session loaded BEFORE state setters so the save effect cannot fire
        // with stale data and overwrite the SQLite record before we finish restoring.
        sessionLoadedRef.current = true;
        setMessages(saved.messages);
        if (saved.screenState.hasCompletedTriage) {
          // Completed session — restore in read-only completed state so the user
          // still sees the "Start New Assessment" button and cannot keep chatting.
          setHasCompletedTriage(true);
          setIsInputDisabled(true);
          setEmergencyRag(saved.screenState.emergencyRag);
          setCriticalTxStatus(saved.screenState.criticalTxStatus ?? 'IDLE');
          setCriticalCaseId(saved.screenState.criticalCaseId ?? null);
          criticalTxFired.current = saved.screenState.criticalTxFired ?? false;
          if (saved.screenState.emergencyTrigger) {
            setEmergencyDetected(saved.screenState.emergencyTrigger);
            barOffset.setValue(0);
          }
          // Agent stays un-started; input is locked so no messages can be sent.
        } else {
          // In-progress session — restore fully so the user can continue chatting.
          agent.restoreState(saved.agentState);
          setTurnCount(saved.screenState.turnCount ?? 0);
          setEmergencyRag(saved.screenState.emergencyRag);
          setCriticalTxStatus(saved.screenState.criticalTxStatus ?? 'IDLE');
          setCriticalCaseId(saved.screenState.criticalCaseId ?? null);
          criticalTxFired.current = saved.screenState.criticalTxFired ?? false;
          if (saved.screenState.emergencyTrigger) {
            setEmergencyDetected(saved.screenState.emergencyTrigger);
            barOffset.setValue(0);
          }
        }
      } else {
        // Fresh start — mark loaded so the save effect can persist the opening message.
        sessionLoadedRef.current = true;
        clearChat();
        const response = await agent.start();
        if (unmounted.current) return;
        addMessage({
          id: `agent-${Date.now()}`,
          role: 'agent',
          content: response.message,
          timestamp: Date.now(),
        });
      }
    })();

    return () => {
      unmounted.current = true;
      if (postTriagePollRef.current) clearInterval(postTriagePollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist session to SQLite on every message change ─────────────────────
  // hasCompletedTriageRef lets the save effect skip writing after assessment ends
  // without needing hasCompletedTriage in the dependency array (avoids stale closure).

  const hasCompletedTriageRef = useRef(false);
  useEffect(() => { hasCompletedTriageRef.current = hasCompletedTriage; }, [hasCompletedTriage]);

  useEffect(() => {
    if (!sessionLoadedRef.current || messages.length === 0 || hasCompletedTriageRef.current || !agentRef.current) return;
    const session: SavedChatSession = {
      messages,
      agentState: agentRef.current.getSerializableState(),
      screenState: {
        turnCount,
        emergencyRag,
        criticalTxStatus,
        criticalCaseId,
        criticalTxFired: criticalTxFired.current,
        emergencyTrigger: emergencyTrigger ?? null,
      },
      savedAt: Date.now(),
    };
    saveActiveSession(session).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, turnCount, emergencyRag, criticalTxStatus, criticalCaseId, emergencyTrigger]);

  // ── Post-triage pipeline (runs after SUFFICIENT) ───────────────────────────
  // Defined outside useCallback and stored in a ref so handleSend can invoke
  // the latest version without needing it as a dependency.

  const _handlePostTriage = async (featureVector: MedicalFeatureVector) => {
    const triageResult = computeTriage(featureVector);
    const { level }   = triageResult;

    // ── 1. Show triage verdict as a system card ──────────────────────────────
    const badge =
      level === 'RED'   ? '🔴 CRITICAL' :
      level === 'AMBER' ? '🟡 URGENT'   : '🟢 SAFE';
    addMessage({
      id: `triage-${Date.now()}`,
      role: 'agent',
      type: 'system',
      content: `${badge}\n${triageResult.reason}`,
      timestamp: Date.now(),
    });

    // ── 2. Transmit report (skip if CRITICAL path already fired) ─────────────
    let caseIdForPoll: string | null = null;

    if (level !== 'GREEN' && !criticalTxFired.current) {
      const id = generateCaseId();
      caseIdForPoll = id;

      addMessage({
        id: `tx-start-${Date.now()}`,
        role: 'agent',
        type: 'system',
        content: 'Sending your report to the relief network...',
        timestamp: Date.now(),
      });

      try {
        const { profile, deviceId } = userStore.getState();
        if (!profile) throw new Error('No user profile');

        const payload: LeanPayload = {
          caseId:              id,
          patient:             { cnic: profile.cnic, name: profile.full_name, phone: profile.phone, lat: profile.lat ?? 0, lng: profile.lng ?? 0 },
          chiefComplaint:      featureVector.chiefComplaint,
          symptoms:            featureVector.associatedSymptoms,
          severity:            featureVector.severity,
          triageLevel:         level,
          triageReason:        triageResult.reason,
          conversationSummary: featureVector.conversationSummary,
          timestampUnix:       Math.floor(Date.now() / 1000),
          deviceId,
          networkMode:         networkStore.getState().mode,
        };

        const bytes = encodeLeanPayload(payload);
        const blob  = await encryptLeanPayload(bytes, profile.cnic, deviceId);
        const result = await transmissionService.sendOrCache(id, payload, blob, level);

        if (!unmounted.current) {
          addMessage({
            id: `tx-done-${Date.now()}`,
            role: 'agent',
            type: 'system',
            content: result === 'SENT'
              ? `✓ Report transmitted — Case ID: ${id.slice(0, 8).toUpperCase()}\nHelp is being dispatched to your location.`
              : `💾 Report saved — Case ID: ${id.slice(0, 8).toUpperCase()}\nWill send automatically when signal is restored.`,
            timestamp: Date.now(),
          });
        }
      } catch {
        if (!unmounted.current) {
          addMessage({
            id: `tx-err-${Date.now()}`,
            role: 'agent',
            type: 'system',
            content: '⚠ Could not transmit report. It has been saved locally and will retry.',
            timestamp: Date.now(),
          });
        }
      }
    } else if (level !== 'GREEN' && criticalTxFired.current && criticalCaseId) {
      // Emergency report was already sent via the CRITICAL path
      caseIdForPoll = criticalCaseId;
      addMessage({
        id: `tx-ref-${Date.now()}`,
        role: 'agent',
        type: 'system',
        content: `✓ Emergency report already sent — Case ID: ${criticalCaseId.slice(0, 8).toUpperCase()}`,
        timestamp: Date.now(),
      });
    }

    // ── 3. RAG guidance with citation ─────────────────────────────────────────
    // Only runs after triage is complete so the agent has the full symptom picture.
    // Uses the triggered keyword as the primary query — it maps directly to article
    // topics (e.g. "snake bite" → snake_bites_guidelines). Falls back to chief
    // complaint. Skips guidance if score is below threshold or no citation is available.
    try {
      const MIN_SCORE = 0.3;

      // Primary query: the exact keyword that triggered the triage (or chief complaint for GREEN)
      const primaryQuery = triageResult.triggeredKeyword ?? featureVector.chiefComplaint;
      let results = await queryGuidance(primaryQuery, 1);

      // Secondary fallback: try chief complaint alone when keyword produced a weak match
      if (
        (results.length === 0 || results[0]!.score < MIN_SCORE) &&
        triageResult.triggeredKeyword
      ) {
        results = await queryGuidance(featureVector.chiefComplaint, 1);
      }

      if (!unmounted.current && results.length > 0 && results[0]!.score >= MIN_SCORE) {
        const r = results[0]!;
        // Skip uncited guidance — if we can't say where it came from, don't show it
        const hasSource = Boolean(r.articleTitle || r.articleSource);
        if (hasSource) {
          const citation =
            `\n\n📚 Source: ${r.articleTitle ? `"${r.articleTitle}" — ` : ''}${r.articleSource ?? 'WHO'}`;
          const intro =
            level === 'GREEN'
              ? 'Here are some care tips while you monitor your condition:\n\n'
              : 'While waiting for help:\n\n';
          addMessage({
            id: `guidance-${Date.now()}`,
            role: 'agent',
            type: 'guidance',
            content: `${intro}${r.content}${citation}`,
            timestamp: Date.now(),
          });
        }
      }
    } catch { /* RAG unavailable — skip silently */ }

    // ── 4. Poll for responder acknowledgement (RED / AMBER only) ─────────────
    if (caseIdForPoll) {
      postTriagePollRef.current = setInterval(async () => {
        if (unmounted.current) { clearInterval(postTriagePollRef.current!); return; }
        try {
          const res = await fetch(`${API_BASE_URL}/api/v1/cases/${caseIdForPoll}`);
          if (!res.ok) return;
          const data = (await res.json()) as { status?: string };
          if (data.status === 'ACKNOWLEDGED' || data.status === 'RESOLVED') {
            if (!unmounted.current) {
              addMessage({
                id: `ack-${Date.now()}`,
                role: 'agent',
                type: 'system',
                content: '✓ A medical team has been dispatched to your location.',
                timestamp: Date.now(),
              });
            }
            clearInterval(postTriagePollRef.current!);
          }
        } catch { /* silent retry */ }
      }, 10_000);
    }

    // ── 5. Persist conversation history & completed-case record ──────────────
    const historySnapshot = useChatStore.getState().messages;
    if (level === 'GREEN') {
      const localId = generateCaseId();
      saveCompletedCase({
        case_id: localId,
        triage_level: 'GREEN',
        chief_complaint: featureVector.chiefComplaint,
        completed_at: Date.now(),
      }).catch(() => {});
      saveChatHistory(localId, historySnapshot).catch(() => {});
    } else {
      // RED / AMBER — link history and history-list record to the same case ID
      // that was used for transmission (CRITICAL path fires first; SUFFICIENT
      // path uses caseIdForPoll that was created during transmission above).
      const txCaseId = criticalTxFired.current
        ? criticalCaseIdRef.current
        : caseIdForPoll;
      if (txCaseId) {
        saveChatHistory(txCaseId, historySnapshot).catch(() => {});
        // Write to completed_cases immediately so the case appears in the Home
        // screen history without waiting for the TransmissionService to confirm.
        saveCompletedCase({
          case_id: txCaseId,
          triage_level: level,
          chief_complaint: featureVector.chiefComplaint,
          completed_at: Date.now(),
        }).catch(() => {});
      }
    }

    // ── 6. Mark session completed in SQLite ───────────────────────────────────
    // Save the completed session (with hasCompletedTriage: true) instead of
    // clearing it. This way, if the user navigates away and comes back via
    // "BEGIN ASSESSMENT" the completed chat is restored with the "Start New
    // Assessment" button still visible — they cannot accidentally resume a
    // finished conversation. The session is cleared only when the user
    // explicitly presses "Start New Assessment".
    if (agentRef.current) {
      const completedSession: SavedChatSession = {
        messages: useChatStore.getState().messages,
        agentState: agentRef.current.getSerializableState(),
        screenState: {
          turnCount,
          emergencyRag,
          criticalTxStatus,
          criticalCaseId: criticalCaseIdRef.current,
          criticalTxFired: criticalTxFired.current,
          emergencyTrigger: emergencyTrigger ?? null,
          hasCompletedTriage: true,
        },
        savedAt: Date.now(),
      };
      saveActiveSession(completedSession).catch(() => {});
    }
    if (!unmounted.current) setHasCompletedTriage(true);
  };

  // Keep the ref in sync every render so handleSend always calls the latest closure.
  handlePostTriageRef.current = _handlePostTriage;

  // ── Typing indicator animation ─────────────────────────────────────────────

  useEffect(() => {
    const dots = [
      { d: dot1, delay: 0 },
      { d: dot2, delay: 200 },
      { d: dot3, delay: 400 },
    ];

    if (isAgentTyping) {
      dots.forEach(({ d, delay }) => {
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(d, { toValue: 0, duration: 300, useNativeDriver: true }),
          ]),
        ).start();
      });
    } else {
      [dot1, dot2, dot3].forEach((d) => { d.stopAnimation(); d.setValue(0); });
    }
  }, [isAgentTyping, dot1, dot2, dot3]);

  // ── Emergency bar animation ────────────────────────────────────────────────

  useEffect(() => {
    if (emergencyDetected) {
      Animated.spring(barOffset, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }).start();
    }
  }, [emergencyDetected, barOffset]);

  // ── Critical-path inline transmission ─────────────────────────────────────

  const startCriticalTransmission = useCallback(async (
    featureVector: MedicalFeatureVector,
    trigger: string,
  ) => {
    const id = generateCaseId();
    setCriticalCaseId(id);
    criticalCaseIdRef.current = id;
    setCriticalTxStatus('SENDING');

    try {
      const { profile, deviceId } = userStore.getState();
      if (!profile) { setCriticalTxStatus('ERROR'); return; }

      const payload: LeanPayload = {
        caseId: id,
        patient: {
          cnic:  profile.cnic,
          name:  profile.full_name,
          phone: profile.phone,
          lat:   profile.lat ?? 0,
          lng:   profile.lng ?? 0,
        },
        chiefComplaint:      featureVector.chiefComplaint,
        symptoms:            featureVector.associatedSymptoms,
        severity:            featureVector.severity,
        triageLevel:         'RED',
        triageReason:        `Critical symptom detected: ${trigger}. Immediate medical attention required.`,
        conversationSummary: featureVector.conversationSummary,
        timestampUnix:       Math.floor(Date.now() / 1000),
        deviceId,
        networkMode:         networkStore.getState().mode,
      };

      const payloadBytes   = encodeLeanPayload(payload);
      const encryptedBlob  = await encryptLeanPayload(payloadBytes, profile.cnic, deviceId);
      const result         = await transmissionService.sendOrCache(id, payload, encryptedBlob, 'RED');

      if (!unmounted.current) {
        setCriticalTxStatus(result === 'SENT' ? 'SENT' : 'CACHED');
      }
    } catch (err) {
      console.error('[ChatScreen] Critical transmission failed:', err);
      if (!unmounted.current) setCriticalTxStatus('ERROR');
    }
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isInputDisabled || isAgentTyping || !agentRef.current) return;

    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
    setInput('');
    setAgentTyping(true);

    let response;
    try {
      response = await agentRef.current.sendMessage(text);
    } catch {
      if (!unmounted.current) {
        setAgentTyping(false);
        const isOffline = networkStore.getState().mode === 'OFFLINE';
        addMessage({
          id: `err-${Date.now()}`,
          role: 'agent',
          type: 'system',
          content: isOffline
            ? '⚠ Offline AI model not downloaded. Go back to the Home screen and tap DOWNLOAD to get the offline model (807 MB). You need WiFi to download it.'
            : '⚠ Connection error. Please try again.',
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (unmounted.current) return;
    setAgentTyping(false);

    if (response.status === 'COLLECTING') {
      addMessage({
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: response.message,
        timestamp: Date.now(),
      });
      setTurnCount((n) => n + 1);

    } else if (response.status === 'CRITICAL') {
      addMessage({
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: response.message,
        timestamp: Date.now(),
      });
      setEmergencyRag(response.ragContext);
      setEmergencyDetected(response.criticalTrigger ?? 'emergency');
      setCollectionStatus('CRITICAL');
      // Input stays enabled — patient can keep chatting for guidance while waiting for help.
      // Transmit exactly once: guard with a ref so repeat CRITICAL signals don't re-fire.
      if (!criticalTxFired.current && response.featureVector) {
        criticalTxFired.current = true;
        startCriticalTransmission(
          response.featureVector,
          response.criticalTrigger ?? 'critical symptom',
        );
      }

    } else if (response.status === 'SUFFICIENT') {
      setIsInputDisabled(true);
      setCollectionStatus('SUFFICIENT');
      addMessage({
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: 'I have collected enough information. Let me assess your condition...',
        timestamp: Date.now(),
      });
      handlePostTriageRef.current?.(response.featureVector!);
    }
  }, [
    input, isInputDisabled, isAgentTyping,
    addMessage, setAgentTyping, setEmergencyDetected,
    setCollectionStatus, startCriticalTransmission,
  ]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.type === 'system') {
      return (
        <View style={styles.systemMsgContainer}>
          <Text style={styles.systemMsgText}>{item.content}</Text>
        </View>
      );
    }
    if (item.type === 'guidance') {
      return (
        <View style={styles.guidanceContainer}>
          <Text style={styles.guidanceText}>{item.content}</Text>
        </View>
      );
    }
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.rowRight : styles.rowLeft]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>M</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
          <Text style={styles.bubbleText}>{item.content}</Text>
        </View>
      </View>
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const step = Math.min(turnCount + 1, 5);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            disabled={isInputDisabled}
            style={[styles.backBtn, isInputDisabled && styles.backBtnDisabled]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={[styles.backBtnText, isInputDisabled && styles.backBtnTextDisabled]}>
              ←
            </Text>
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Medical Assessment</Text>

          {!hasCompletedTriage && (
            <Text style={styles.stepText}>Step {step} of ~5</Text>
          )}
        </View>

        {/* ── Chat messages ── */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={scrollToBottom}
          onLayout={scrollToBottom}
          showsVerticalScrollIndicator={false}
        />

        {/* ── Typing indicator ── */}
        {isAgentTyping && (
          <View style={styles.typingRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>M</Text>
            </View>
            <View style={styles.typingBubble}>
              {[dot1, dot2, dot3].map((d, i) => (
                <Animated.View key={i} style={[styles.dot, { opacity: d }]} />
              ))}
            </View>
          </View>
        )}

        {/* ── Emergency notification bar — NOT dismissable ── */}
        {emergencyDetected && (
          <Animated.View
            style={[styles.emergencyBar, { transform: [{ translateY: barOffset }] }]}
          >
            <Text style={styles.emergencyTitle}>🚨 Emergency Alert Sent</Text>
            <Text style={styles.emergencySubtitle}>
              Your location has been recorded. Help is being notified.
            </Text>
            {emergencyRag && (
              <View style={styles.ragBox}>
                <Text style={styles.ragLabel}>While you wait:</Text>
                <Text style={styles.ragText}>{emergencyRag}</Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* ── Critical transmission status bar ── */}
        {criticalTxStatus !== 'IDLE' && (
          <View style={[
            styles.txStatusBar,
            criticalTxStatus === 'SENT'   && styles.txStatusBarSent,
            criticalTxStatus === 'CACHED' && styles.txStatusBarCached,
            criticalTxStatus === 'ERROR'  && styles.txStatusBarError,
          ]}>
            <Text style={styles.txStatusText}>
              {criticalTxStatus === 'SENDING'
                ? 'Transmitting emergency report...'
                : criticalTxStatus === 'SENT'
                ? `✓ Emergency report transmitted — Case ID: ${criticalCaseId?.slice(0, 8).toUpperCase()}`
                : criticalTxStatus === 'CACHED'
                ? '💾 Saved offline — will transmit when connected'
                : '⚠ Could not transmit — report saved locally'}
            </Text>
          </View>
        )}

        {/* ── Post-triage action bar OR live input ── */}
        {hasCompletedTriage ? (
          <View style={[styles.postTriageBar, { paddingBottom: 14 + insets.bottom }]}>
            <TouchableOpacity
              style={styles.newAssessmentBtn}
              onPress={() => {
                clearActiveSession().catch(() => {});
                clearChat();
                if (route.params?.readonlySession) {
                  navigation.goBack();
                } else {
                  navigation.replace('Home');
                }
              }}
            >
              <Text style={styles.newAssessmentBtnText}>
                {route.params?.readonlySession ? '← Back to History' : 'Start New Assessment'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.inputRow, { paddingBottom: 12 + insets.bottom }]}>
            <TextInput
              style={styles.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="Describe your symptoms..."
              placeholderTextColor="#6b7280"
              multiline
              maxLength={500}
              editable={!isAgentTyping}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.sendBtn, isAgentTyping && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={isAgentTyping}
            >
              {isAgentTyping ? (
                <ActivityIndicator size="small" color="#9ca3af" />
              ) : (
                <Text style={styles.sendBtnText}>→</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  flex1: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    backgroundColor: '#0a0a0a',
  },
  backBtn: {
    marginRight: 12,
  },
  backBtnDisabled: {
    opacity: 0.3,
  },
  backBtnText: {
    color: '#ffffff',
    fontSize: 20,
  },
  backBtnTextDisabled: {
    color: '#6b7280',
  },
  headerTitle: {
    flex: 1,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  stepText: {
    color: '#6b7280',
    fontSize: 12,
  },

  // Messages
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 12,
    maxWidth: '85%',
  },
  rowLeft: {
    alignSelf: 'flex-start',
    alignItems: 'flex-end',
  },
  rowRight: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    flexShrink: 0,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexShrink: 1,
  },
  bubbleAgent: {
    backgroundColor: '#1a1a2e',
  },
  bubbleUser: {
    backgroundColor: '#dc2626',
  },
  bubbleText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },

  // Typing indicator
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  typingBubble: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#9ca3af',
  },

  // Emergency bar
  emergencyBar: {
    backgroundColor: '#7f1d1d',
    padding: 16,
    marginHorizontal: 0,
    borderTopWidth: 1,
    borderTopColor: '#991b1b',
  },
  emergencyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  emergencySubtitle: {
    color: '#d1d5db',
    fontSize: 14,
    marginBottom: 8,
  },
  ragBox: {
    marginTop: 4,
  },
  ragLabel: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  ragText: {
    color: '#fde68a',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },

  // Input
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    backgroundColor: '#0a0a0a',
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#374151',
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },

  // Critical transmission status bar
  txStatusBar: {
    backgroundColor: '#1c1917',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#292524',
  },
  txStatusBarSent: {
    backgroundColor: '#14532d',
    borderTopColor: '#166534',
  },
  txStatusBarCached: {
    backgroundColor: '#1c1917',
  },
  txStatusBarError: {
    backgroundColor: '#450a0a',
    borderTopColor: '#7f1d1d',
  },
  txStatusText: {
    color: '#d1d5db',
    fontSize: 12,
    textAlign: 'center',
  },

  // System messages (triage verdict, transmission status, acknowledgement)
  systemMsgContainer: {
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  systemMsgText: {
    color: '#d1d5db',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Guidance / citation notes from the knowledge base
  guidanceContainer: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    backgroundColor: '#0d2439',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e4068',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    marginLeft: 36,
  },
  guidanceText: {
    color: '#93c5fd',
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },

  // Post-triage sticky bar — replaces the input row once assessment is done
  postTriageBar: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  newAssessmentBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignItems: 'center',
    width: '100%',
  },
  newAssessmentBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
