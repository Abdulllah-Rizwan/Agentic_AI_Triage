import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { useNetworkStore, NetworkMode } from '../store/networkStore';
import { useUserStore } from '../store/userStore';
import { getCompletedCases, markCaseAcknowledged, CompletedCase } from '../db/queries';
import { slmAdapter } from '../services/llm/SLMAdapter';
import { useTransmissionStore } from '../store/transmissionStore';
import type { RootStackParamList } from '../../App';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

const TRIAGE_COLORS: Record<string, string> = {
  RED: '#ef4444',
  AMBER: '#f59e0b',
  GREEN: '#22c55e',
};

const NETWORK_CONFIG: Record<NetworkMode, { label: string; bg: string; text: string }> = {
  FULL: { label: 'CLOUD AI', bg: '#166534', text: '#4ade80' },
  DEGRADED: { label: 'DEVICE AI', bg: '#78350f', text: '#fbbf24' },
  OFFLINE: { label: 'OFFLINE MODE', bg: '#7f1d1d', text: '#f87171' },
};

type DownloadState = 'unknown' | 'not_downloaded' | 'downloading' | 'ready';

export default function HomeScreen({ navigation }: Props) {
  const networkMode = useNetworkStore((s) => s.mode);
  const profile = useUserStore((s) => s.profile);
  const [completedCases, setCompletedCases] = useState<CompletedCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<CompletedCase | null>(null);
  const [modelState, setModelState] = useState<DownloadState>('unknown');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showTransmittedToast, setShowTransmittedToast] = useState(false);
  const downloadingRef = useRef(false);
  const seenTransmittedAtRef = useRef<number | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastTransmittedAt     = useTransmissionStore((s) => s.lastTransmittedAt);

  // Refresh cases and model state every time this screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      loadCases();
      checkModelState();
    }, []),
  );

  // Show a brief toast when a cached case is transmitted in the background.
  useEffect(() => {
    if (!lastTransmittedAt || lastTransmittedAt === seenTransmittedAtRef.current) return;
    seenTransmittedAtRef.current = lastTransmittedAt;
    loadCases();
    setShowTransmittedToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowTransmittedToast(false), 3500);
  }, [lastTransmittedAt]);

  async function checkModelState() {
    try {
      const downloaded = await slmAdapter.isModelDownloaded();
      setModelState(downloaded ? 'ready' : 'not_downloaded');
    } catch {
      // If we can't check, assume not downloaded so the card is shown
      setModelState('not_downloaded');
    }
  }

  async function handleDownloadModel() {
    if (downloadingRef.current) return;
    if (networkMode === 'OFFLINE') {
      Alert.alert('No Connection', 'Connect to WiFi to download the offline AI model (~1 GB).');
      return;
    }
    downloadingRef.current = true;
    setModelState('downloading');
    setDownloadProgress(0);
    try {
      await slmAdapter.downloadModel((written, total) => {
        if (total > 0) setDownloadProgress(Math.round((written / total) * 100));
      });
      setModelState('ready');
    } catch (err) {
      setModelState('not_downloaded');
      Alert.alert('Download Failed', 'Could not download the model. Please try again on WiFi.');
    } finally {
      downloadingRef.current = false;
    }
  }

  async function loadCases() {
    const cases = await getCompletedCases();
    setCompletedCases(cases);
  }

  async function checkAndUpdateCaseStatus(c: CompletedCase) {
    if (c.acknowledged) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/cases/${c.case_id}/status`);
      if (!res.ok) return;
      const data = (await res.json()) as { status?: string };
      if (data.status === 'ACKNOWLEDGED' || data.status === 'RESOLVED') {
        await markCaseAcknowledged(c.case_id);
        await loadCases();
        setSelectedCase((prev) => (prev ? { ...prev, acknowledged: 1 } : prev));
      }
    } catch {
      // silent failure — no network or server unavailable
    }
  }

  const netCfg = NETWORK_CONFIG[networkMode];
  const greeting = `${getGreeting()}, ${getFirstName(profile?.full_name ?? 'User')}`;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.tagline}>Stay safe. Help is connected.</Text>
          </View>
          <View style={[styles.networkBadge, { backgroundColor: netCfg.bg }]}>
            <Text style={[styles.networkBadgeText, { color: netCfg.text }]}>{netCfg.label}</Text>
          </View>
        </View>

        {/* Status card */}
        <View style={styles.statusCard}>
          <View style={[styles.statusIcon, networkMode === 'OFFLINE' ? styles.statusIconAmber : styles.statusIconGreen]}>
            <Text style={styles.statusIconText}>{networkMode === 'OFFLINE' ? '⚠' : '✓'}</Text>
          </View>
          <View style={styles.statusContent}>
            <Text style={styles.statusTitle}>
              {networkMode === 'OFFLINE' ? 'Offline Mode' : 'System Ready'}
            </Text>
            <Text style={styles.statusDetail}>
              {networkMode === 'OFFLINE'
                ? 'Assessment available without internet'
                : 'Device AI loaded · Location active'}
            </Text>
            <Text style={styles.debugUrl} numberOfLines={1}>
              {API_BASE_URL || '⚠ API URL NOT SET'}
            </Text>
          </View>
        </View>

        {/* Offline AI model card — shown above CTA when model is not on device */}
        {modelState !== 'unknown' && modelState !== 'ready' && (
          <View style={styles.modelCard}>
            <View style={styles.modelCardHeader}>
              <Text style={styles.modelCardTitle}>Offline AI Model</Text>
              <Text style={styles.modelCardSize}>~1 GB</Text>
            </View>
            <Text style={styles.modelCardDesc}>
              Download to use AI-guided chat without internet.
            </Text>
            {modelState === 'downloading' ? (
              <View style={styles.progressWrapper}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${downloadProgress}%` }]} />
                </View>
                <Text style={styles.progressLabel}>{downloadProgress}%</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.downloadBtn}
                onPress={handleDownloadModel}
                activeOpacity={0.8}
              >
                <Text style={styles.downloadBtnText}>DOWNLOAD</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={() => navigation.navigate('Chat')}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>BEGIN ASSESSMENT</Text>
        </TouchableOpacity>
        <Text style={styles.ctaSubtext}>AI-guided symptom collection · Takes 2-3 minutes</Text>

        {/* Past assessments */}
        <Text style={styles.sectionTitle}>MY ASSESSMENTS</Text>

        {completedCases.length === 0 ? (
          <Text style={styles.emptyText}>No assessments yet</Text>
        ) : (
          <FlatList
            data={completedCases}
            keyExtractor={(item) => item.case_id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.caseRow}
                onPress={() => {
                  setSelectedCase(item);
                  checkAndUpdateCaseStatus(item);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.triageDot, { backgroundColor: TRIAGE_COLORS[item.triage_level] ?? '#9ca3af' }]} />
                <View style={styles.caseInfo}>
                  <Text style={styles.caseComplaint} numberOfLines={1}>{item.chief_complaint}</Text>
                  <Text style={styles.caseDate}>{format(item.completed_at, 'MMM d, yyyy')}</Text>
                </View>
                <Text style={[styles.triageLabel, { color: TRIAGE_COLORS[item.triage_level] ?? '#9ca3af' }]}>
                  {item.triage_level}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}
      </ScrollView>

      {/* Transmitted toast — shown briefly when a cached case is flushed */}
      {showTransmittedToast && (
        <View style={styles.transmittedToast} pointerEvents="none">
          <Text style={styles.transmittedToastText}>✓ Report transmitted to emergency network</Text>
        </View>
      )}

      {/* Case detail modal */}
      <Modal visible={!!selectedCase} transparent animationType="slide" onRequestClose={() => setSelectedCase(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Case Details</Text>
            {selectedCase && (
              <>
                <Text style={styles.modalField}>
                  <Text style={styles.modalLabel}>Chief Complaint: </Text>
                  {selectedCase.chief_complaint}
                </Text>
                <Text style={styles.modalField}>
                  <Text style={styles.modalLabel}>Triage Level: </Text>
                  <Text style={{ color: TRIAGE_COLORS[selectedCase.triage_level] ?? '#fff' }}>
                    {selectedCase.triage_level}
                  </Text>
                </Text>
                <Text style={styles.modalField}>
                  <Text style={styles.modalLabel}>Date: </Text>
                  {format(selectedCase.completed_at, 'MMM d, yyyy HH:mm')}
                </Text>
                <Text style={styles.modalField}>
                  <Text style={styles.modalLabel}>Status: </Text>
                  {selectedCase.acknowledged ? '✓ Responder acknowledged' : 'Awaiting response'}
                </Text>
              </>
            )}
            <TouchableOpacity
              style={styles.modalViewChat}
              onPress={() => {
                setSelectedCase(null);
                if (selectedCase) {
                  navigation.navigate('Chat', {
                    readonlySession: {
                      caseId: selectedCase.case_id,
                      triageLevel: selectedCase.triage_level,
                    },
                  });
                }
              }}
            >
              <Text style={styles.modalViewChatText}>View Conversation</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedCase(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 20, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8 },
  headerText: { flex: 1, marginRight: 12 },
  greeting: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  tagline: { color: '#6b7280', fontSize: 14, marginTop: 4 },
  networkBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  networkBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  statusCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 20,
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statusIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  statusIconGreen: { backgroundColor: '#14532d' },
  statusIconAmber: { backgroundColor: '#78350f' },
  statusIconText: { fontSize: 20 },
  statusContent: { flex: 1 },
  statusTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  statusDetail: { color: '#9ca3af', fontSize: 13, marginTop: 2 },
  debugUrl: { color: '#4b5563', fontSize: 10, marginTop: 4, fontFamily: 'monospace' },
  ctaBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 28,
  },
  ctaText: { color: '#ffffff', fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  ctaSubtext: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 10 },
  sectionTitle: { color: '#6b7280', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 36, marginBottom: 12 },
  emptyText: { color: '#4b5563', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  caseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 12,
  },
  triageDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  caseInfo: { flex: 1 },
  caseComplaint: { color: '#e5e7eb', fontSize: 14, fontWeight: '500' },
  caseDate: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  triageLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#111111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  modalTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalField: { color: '#d1d5db', fontSize: 14, lineHeight: 22 },
  modalLabel: { color: '#9ca3af', fontWeight: '600' },
  modalViewChat: { backgroundColor: '#dc2626', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  modalViewChatText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  modalClose: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  modalCloseText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  modelCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
    marginTop: 16,
  },
  modelCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modelCardTitle: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
  modelCardSize: { color: '#6b7280', fontSize: 12 },
  modelCardDesc: { color: '#9ca3af', fontSize: 13, marginBottom: 12 },
  progressWrapper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTrack: { flex: 1, height: 6, backgroundColor: '#1f2937', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: '#f59e0b', borderRadius: 3 },
  progressLabel: { color: '#f59e0b', fontSize: 13, fontWeight: '600', width: 40, textAlign: 'right' },
  downloadBtn: { backgroundColor: '#1d4ed8', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  downloadBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  transmittedToast: {
    position: 'absolute',
    bottom: 32,
    left: 20,
    right: 20,
    backgroundColor: '#14532d',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#22c55e',
    alignItems: 'center',
  },
  transmittedToastText: { color: '#4ade80', fontSize: 14, fontWeight: '600' },
});
