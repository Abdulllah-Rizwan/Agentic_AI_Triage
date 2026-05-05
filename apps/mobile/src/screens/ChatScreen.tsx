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
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { SymptomCollectorAgent } from '../agents/SymptomCollectorAgent';
import {
  computeTriage,
  type MedicalFeatureVector,
  type TriageResult,
} from '../services/triage/TriageEngine';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Chat'>;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ChatScreen({ navigation }: Props) {
  const [input, setInput]                       = useState('');
  const [isInputDisabled, setIsInputDisabled]   = useState(false);
  const [turnCount, setTurnCount]               = useState(0);
  const [emergencyRag, setEmergencyRag]         = useState<string | undefined>();

  const agentRef    = useRef<SymptomCollectorAgent | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const unmounted   = useRef(false);

  // Emergency bar — starts 220 px below visible area, springs to 0
  const barOffset = useRef(new Animated.Value(220)).current;

  // Typing-indicator dots
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  // Zustand
  const messages            = useChatStore((s) => s.messages);
  const isAgentTyping       = useChatStore((s) => s.isAgentTyping);
  const emergencyDetected   = useChatStore((s) => s.emergencyDetected);
  const addMessage          = useChatStore((s) => s.addMessage);
  const setAgentTyping      = useChatStore((s) => s.setAgentTyping);
  const setEmergencyDetected = useChatStore((s) => s.setEmergencyDetected);
  const clearChat           = useChatStore((s) => s.clearChat);
  const setCollectionStatus = useChatStore((s) => s.setCollectionStatus);

  // ── Startup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    unmounted.current = false;
    navigation.setOptions({ headerShown: false });
    clearChat();

    const agent = new SymptomCollectorAgent();
    agentRef.current = agent;

    agent.start().then((response) => {
      if (unmounted.current) return;
      addMessage({
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: response.message,
        timestamp: Date.now(),
      });
    });

    return () => {
      unmounted.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (!unmounted.current) setAgentTyping(false);
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
      setIsInputDisabled(true);

      // Build a minimal RED feature vector so TriageResultScreen can transmit the case.
      // Note: when detectCriticalSymptom fires on the first message, conversationHistory
      // is empty (the safety gate returns before appending). We use `text` directly.
      const trigger = response.criticalTrigger ?? 'critical symptom';
      const criticalVector: MedicalFeatureVector = {
        chiefComplaint:      text,
        onsetTime:           'Unknown',
        severity:            9,
        associatedSymptoms:  [trigger],
        allergies:           [],
        conversationSummary: `Patient reported: "${text}". Critical symptom: ${trigger}.`,
        rawTranscript:       [{ role: 'user', content: text }],
      };
      const criticalTriageResult: TriageResult = {
        level:            'RED',
        reason:           `Critical symptom detected: ${trigger}. Immediate medical attention required.`,
        triggeredKeyword: trigger,
      };

      // Allow the spring animation (~600 ms) to complete before replacing the screen.
      setTimeout(() => {
        if (!unmounted.current) {
          navigation.replace('TriageResult', {
            triageResult:  criticalTriageResult,
            featureVector: criticalVector,
          });
        }
      }, 2500);

    } else if (response.status === 'SUFFICIENT') {
      addMessage({
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: 'Processing your assessment...',
        timestamp: Date.now(),
      });
      setIsInputDisabled(true);
      setCollectionStatus('SUFFICIENT');

      const featureVector = response.featureVector!;
      const triageResult  = computeTriage(featureVector);

      // Replace ChatScreen so the back gesture cannot re-trigger submission
      navigation.replace('TriageResult', { triageResult, featureVector });
    }
  }, [
    input, isInputDisabled, isAgentTyping,
    addMessage, setAgentTyping, setEmergencyDetected,
    setCollectionStatus, navigation,
  ]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
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
    <SafeAreaView style={styles.container}>
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

        <Text style={styles.stepText}>Step {step} of ~5</Text>
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

      {/* ── Input area ── */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.textInput, isInputDisabled && styles.textInputDisabled]}
            value={input}
            onChangeText={setInput}
            placeholder="Describe your symptoms..."
            placeholderTextColor="#6b7280"
            multiline
            maxLength={500}
            editable={!isInputDisabled && !isAgentTyping}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (isAgentTyping || isInputDisabled) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={isAgentTyping || isInputDisabled}
          >
            {isAgentTyping ? (
              <ActivityIndicator size="small" color="#9ca3af" />
            ) : (
              <Text style={styles.sendBtnText}>→</Text>
            )}
          </TouchableOpacity>
        </View>
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
  textInputDisabled: {
    opacity: 0.4,
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
});
