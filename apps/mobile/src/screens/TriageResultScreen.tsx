import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

import type { RootStackParamList } from '../../App';
import { userStore } from '../store/userStore';
import { networkStore } from '../store/networkStore';
import { useChatStore } from '../store/chatStore';
import { localRAG, type RAGResult } from '../services/rag/LocalRAG';
import { encodeLeanPayload, generateCaseId, type LeanPayload } from '../proto/triage';
import { encryptLeanPayload } from '../services/encryption/AESEncryption';
import { transmissionService } from '../services/transmission/TransmissionService';
import { markCaseAcknowledged } from '../db/queries';

// ── Types ─────────────────────────────────────────────────────────────────────

type TransmissionStatus =
  | 'IDLE'
  | 'ENCODING'
  | 'ENCRYPTING'
  | 'SENDING'
  | 'SENT'
  | 'CACHED'
  | 'ERROR';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TriageResult'>;
  route: RouteProp<RootStackParamList, 'TriageResult'>;
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TriageResultScreen({ navigation, route }: Props) {
  const { triageResult, featureVector } = route.params;
  const level = triageResult.level;

  const [caseId, setCaseId]                     = useState('');
  const [txStatus, setTxStatus]                 = useState<TransmissionStatus>('IDLE');
  const [acknowledged, setAcknowledged]         = useState(false);
  const [ragResults, setRagResults]             = useState<RAGResult[]>([]);

  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);
  const clearChat = useChatStore((s) => s.clearChat);

  // ── On mount ───────────────────────────────────────────────────────────────

  useEffect(() => {
    unmounted.current = false;

    // RAG query for first-aid guidance
    const queryText =
      level === 'RED' && triageResult.triggeredKeyword
        ? triageResult.triggeredKeyword
        : featureVector.chiefComplaint;
    const topK = level === 'GREEN' ? 2 : 1;

    const RAG_MIN_SCORE = 0.3;
    localRAG.query(queryText, topK).then((results) => {
      if (!unmounted.current)
        setRagResults(results.filter((r) => r.score >= RAG_MIN_SCORE));
    });

    // GREEN cases require no transmission
    if (level === 'GREEN') return;

    const id = generateCaseId();
    setCaseId(id);
    initiateTransmission(id);
    startPolling(id);

    return () => {
      unmounted.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Transmission pipeline ──────────────────────────────────────────────────

  async function initiateTransmission(id: string) {
    try {
      setTxStatus('ENCODING');

      const { profile, deviceId } = userStore.getState();
      if (!profile) throw new Error('No user profile');

      // Build the LeanPayload
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
        triageLevel:         level,
        triageReason:        triageResult.reason,
        conversationSummary: featureVector.conversationSummary,
        timestampUnix:       Math.floor(Date.now() / 1000),
        deviceId,
        networkMode:         networkStore.getState().mode,
      };

      // Encode to protobuf binary
      const payloadBytes = encodeLeanPayload(payload);

      setTxStatus('ENCRYPTING');

      // Encrypt before writing to SQLite
      const encryptedBlob = await encryptLeanPayload(
        payloadBytes,
        profile.cnic,
        deviceId,
      );

      setTxStatus('SENDING');

      // Persist + attempt immediate send
      const result = await transmissionService.sendOrCache(
        id,
        payload,
        encryptedBlob,
        level,
      );

      if (!unmounted.current) {
        setTxStatus(result === 'SENT' ? 'SENT' : 'CACHED');
      }
    } catch (err) {
      console.error('[TriageResult] Transmission failed:', err);
      if (!unmounted.current) setTxStatus('ERROR');
    }
  }

  // ── Acknowledgement polling ────────────────────────────────────────────────

  function startPolling(id: string) {
    pollRef.current = setInterval(async () => {
      if (unmounted.current) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/cases/${id}/status`);
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status === 'ACKNOWLEDGED' || data.status === 'RESOLVED') {
          await markCaseAcknowledged(id);
          if (!unmounted.current) {
            setAcknowledged(true);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }
      } catch {
        /* network error — silently retry on next tick */
      }
    }, 10_000);
  }

  const handleNewAssessment = useCallback(() => {
    clearChat();
    navigation.navigate('Home');
  }, [clearChat, navigation]);

  // ── GREEN layout ───────────────────────────────────────────────────────────

  if (level === 'GREEN') {
    return (
      <ScrollView style={styles.greenBg} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.iconCircle, styles.iconGreen]}>
          <Text style={styles.iconEmoji}>✓</Text>
        </View>

        <Text style={styles.headingWhite}>You Are Safe</Text>
        <Text style={styles.subtitleLight}>
          No immediately life-threatening conditions detected.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardHeading}>What to do:</Text>
          {ragResults.length > 0 ? (
            ragResults.map((r, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <View style={styles.bulletContent}>
                  <Text style={styles.bulletText}>{r.content}</Text>
                  {(r.articleTitle || r.articleSource) && (
                    <Text style={styles.citationText}>
                      📚 {r.articleTitle ?? r.articleSource}
                    </Text>
                  )}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.cardBody}>Rest in a safe location. Drink water if available.</Text>
          )}
          <View style={[styles.bulletRow, styles.monitorRow]}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.bulletText}>
              Monitor your symptoms. Seek help if your condition worsens.
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.newAssessmentBtn} onPress={handleNewAssessment}>
          <Text style={styles.newAssessmentText}>Start New Assessment</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── AMBER / RED shared layout ──────────────────────────────────────────────

  const isRed      = level === 'RED';
  const bgStyle    = isRed ? styles.redBg    : styles.amberBg;
  const iconStyle  = isRed ? styles.iconRed  : styles.iconAmber;
  const reasonStyle = isRed ? styles.reasonRed : styles.reasonAmber;
  const heading    = isRed
    ? 'Critical — Emergency Response Activated'
    : 'Urgent Attention Needed';

  return (
    <ScrollView style={bgStyle} contentContainerStyle={styles.scrollContent}>
      <View style={[styles.iconCircle, iconStyle]}>
        <Text style={styles.iconEmoji}>{isRed ? '!' : '⚠'}</Text>
      </View>

      <Text style={[styles.headingWhite, isRed && styles.headingSmaller]}>{heading}</Text>
      <Text style={[styles.subtitleLight, reasonStyle]}>{triageResult.reason}</Text>

      {/* ── Transmission status card ── */}
      <View style={styles.card}>
        <Text style={styles.cardHeading}>Report Status</Text>

        <TxStatusRow status={txStatus} caseId={caseId} />

        {caseId !== '' && txStatus !== 'ERROR' && (
          <Text style={styles.caseId}>Case ID: {caseId.slice(0, 8).toUpperCase()}</Text>
        )}

        <Text style={[styles.dispatchText, isRed ? styles.dispatchRed : styles.dispatchAmber]}>
          Help is being dispatched to your location.
        </Text>
      </View>

      {/* ── Acknowledgement banner ── */}
      {acknowledged && (
        <View style={styles.ackBanner}>
          <Text style={styles.ackText}>✓  A medical team has been dispatched to you.</Text>
        </View>
      )}

      {/* ── RED: RAG emergency guidance (only shown when a citable source exists) ── */}
      {isRed && ragResults.length > 0 && (ragResults[0]!.articleTitle || ragResults[0]!.articleSource) && (
        <View style={styles.ragCard}>
          <Text style={styles.ragCardHeading}>While waiting for help:</Text>
          <Text style={styles.ragCardText}>{ragResults[0]!.content}</Text>
          <Text style={styles.ragCardSource}>
            📚 {ragResults[0]!.articleTitle ?? ragResults[0]!.articleSource}
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.newAssessmentBtn} onPress={handleNewAssessment}>
        <Text style={styles.newAssessmentText}>Start New Assessment</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Transmission status row component ─────────────────────────────────────────

function TxStatusRow({ status, caseId }: { status: TransmissionStatus; caseId: string }) {
  switch (status) {
    case 'IDLE':
      return (
        <View style={styles.txRow}>
          <Text style={styles.txText}>Preparing...</Text>
        </View>
      );
    case 'ENCODING':
      return (
        <View style={styles.txRow}>
          <ActivityIndicator size="small" color="#f59e0b" style={styles.txIcon} />
          <Text style={styles.txTextAmber}>Encoding report...</Text>
        </View>
      );
    case 'ENCRYPTING':
      return (
        <View style={styles.txRow}>
          <ActivityIndicator size="small" color="#f59e0b" style={styles.txIcon} />
          <Text style={styles.txTextAmber}>Securing data...</Text>
        </View>
      );
    case 'SENDING':
      return (
        <View style={styles.txRow}>
          <ActivityIndicator size="small" color="#9ca3af" style={styles.txIcon} />
          <Text style={styles.txText}>Sending to relief network...</Text>
        </View>
      );
    case 'SENT':
      return (
        <View style={styles.txRow}>
          <Text style={styles.txCheckmark}>✓</Text>
          <Text style={styles.txTextSent}>Report received ✓</Text>
        </View>
      );
    case 'CACHED':
      return (
        <View style={styles.txRow}>
          <Text style={styles.txCacheIcon}>💾</Text>
          <Text style={styles.txTextCached}>
            Saved securely. Will send when signal is available.
          </Text>
        </View>
      );
    case 'ERROR':
      return (
        <View style={styles.txRow}>
          <Text style={styles.txErrorText}>
            Failed to process report.{'\n'}
            {caseId !== '' ? `Your case ID is ${caseId.slice(0, 8).toUpperCase()} — note it down.` : 'Please try again.'}
          </Text>
        </View>
      );
  }
}

// ── Monospace font ─────────────────────────────────────────────────────────────

const Platform_monospace = Platform.OS === 'ios' ? 'Courier' : 'monospace';

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Backgrounds
  greenBg: { flex: 1, backgroundColor: '#052e16' },
  amberBg: { flex: 1, backgroundColor: '#451a03' },
  redBg:   { flex: 1, backgroundColor: '#450a0a' },

  scrollContent: {
    padding: 24,
    paddingTop: 60,
    alignItems: 'center',
    paddingBottom: 40,
  },

  // Icon circle
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconGreen: { backgroundColor: '#166534' },
  iconAmber: { backgroundColor: '#92400e' },
  iconRed:   { backgroundColor: '#991b1b' },
  iconEmoji: { color: '#ffffff', fontSize: 36, fontWeight: '700' },

  // Headings
  headingWhite: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  headingSmaller: { fontSize: 24 },
  subtitleLight: {
    color: '#d1d5db',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  reasonAmber: { color: '#fde68a' },
  reasonRed:   { color: '#fca5a5' },

  // Cards
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 16,
  },
  cardHeading: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  cardBody: { color: '#d1d5db', fontSize: 14, lineHeight: 20 },

  // Bullet list (GREEN first-aid)
  bulletRow: { flexDirection: 'row', marginBottom: 8 },
  bullet:    { color: '#4ade80', fontSize: 14, marginRight: 8, marginTop: 1 },
  bulletContent: { flex: 1 },
  bulletText: { color: '#d1d5db', fontSize: 14, lineHeight: 20 },
  citationText: { color: '#86efac', fontSize: 11, marginTop: 3, fontStyle: 'italic' },
  monitorRow: { marginTop: 4 },

  // Transmission status row
  txRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  txIcon: { marginRight: 8 },

  txText:       { color: '#9ca3af', fontSize: 14, flex: 1 },
  txTextAmber:  { color: '#f59e0b', fontSize: 14, flex: 1 },
  txCheckmark:  { color: '#4ade80', fontSize: 18, marginRight: 8 },
  txTextSent:   { color: '#4ade80', fontSize: 14, fontWeight: '600' },
  txCacheIcon:  { fontSize: 16, marginRight: 8 },
  txTextCached: { color: '#9ca3af', fontSize: 13, flex: 1, lineHeight: 18 },
  txErrorText:  { color: '#f87171', fontSize: 13, flex: 1, lineHeight: 18 },

  // Case ID
  caseId: {
    color: '#6b7280',
    fontSize: 12,
    fontFamily: Platform_monospace,
    marginBottom: 10,
    letterSpacing: 1,
  },

  // Dispatch line
  dispatchText:  { fontSize: 13, lineHeight: 18, marginTop: 4 },
  dispatchAmber: { color: '#fde68a' },
  dispatchRed:   { color: '#fca5a5' },

  // Acknowledgement banner
  ackBanner: {
    width: '100%',
    backgroundColor: '#14532d',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#166534',
  },
  ackText: {
    color: '#86efac',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },

  // RAG emergency guidance card (RED only)
  ragCard: {
    width: '100%',
    backgroundColor: '#450a0a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  ragCardHeading: { color: '#fca5a5', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  ragCardText:    { color: '#fecaca', fontSize: 13, lineHeight: 18 },
  ragCardSource:  { color: '#f87171', fontSize: 11, marginTop: 8, fontStyle: 'italic' },

  // New assessment button
  newAssessmentBtn: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  newAssessmentText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
