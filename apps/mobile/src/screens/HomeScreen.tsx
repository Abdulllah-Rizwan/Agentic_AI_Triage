import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useNetworkStore, NetworkMode } from '../store/networkStore';
import { useUserStore } from '../store/userStore';
import { getCompletedCases, CompletedCase } from '../db/queries';
import type { RootStackParamList } from '../../App';

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

export default function HomeScreen({ navigation }: Props) {
  const networkMode = useNetworkStore((s) => s.mode);
  const profile = useUserStore((s) => s.profile);
  const [completedCases, setCompletedCases] = useState<CompletedCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<CompletedCase | null>(null);

  useEffect(() => {
    loadCases();
  }, []);

  async function loadCases() {
    const cases = await getCompletedCases();
    setCompletedCases(cases);
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
          </View>
        </View>

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
                onPress={() => setSelectedCase(item)}
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
  modalClose: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  modalCloseText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
