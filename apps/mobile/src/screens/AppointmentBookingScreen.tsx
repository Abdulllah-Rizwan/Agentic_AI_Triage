import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Slot {
  id: string;
  slot_date: string;
  slot_time: string;
}

interface Practitioner {
  id: string;
  name: string;
  specialty: string;
  city: string;
  clinic_name: string;
  phone: string | null;
  bio: string | null;
  available_slot_count: number;
}

type BookingState = 'BROWSING' | 'PICKING_SLOT' | 'CONFIRMING' | 'SUCCESS' | 'ERROR';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AppointmentBooking'>;
  route: RouteProp<RootStackParamList, 'AppointmentBooking'>;
}

const SPECIALTY_LABELS: Record<string, string> = {
  GENERAL_PHYSICIAN: 'General Physician',
  CARDIOLOGIST: 'Cardiologist',
  DERMATOLOGIST: 'Dermatologist',
  ORTHOPEDIC: 'Orthopedic',
  PEDIATRICIAN: 'Pediatrician',
  PULMONOLOGIST: 'Pulmonologist',
  NEUROLOGIST: 'Neurologist',
  OTHER: 'Other',
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

// ── Specialty inference from chief complaint ──────────────────────────────────

function inferSpecialty(complaint: string): string | null {
  const t = complaint.toLowerCase();

  // Cardiology first — specific phrases that overlap with generic "pain"
  if (/chest\s*pain|heart attack|cardiac|palpitation|heart/.test(t))
    return 'CARDIOLOGIST';

  // Orthopedic — body parts, trauma, musculoskeletal
  if (/bone|fracture|joint|ortho|cricket|sport|sprain|ligament|aching|injury|broken|leg|arm|knee|ankle|foot|feet|wrist|elbow|shoulder|hip|back pain|neck pain|fall|fell|fallen|slip|twisted|strain|swollen|swell|muscle pain|leg pain|arm pain/.test(t))
    return 'ORTHOPEDIC';

  if (/skin|rash|itch|acne|derma|hives|burn/.test(t))
    return 'DERMATOLOGIST';
  if (/child|baby|infant|toddler|pediatric/.test(t))
    return 'PEDIATRICIAN';
  if (/breath|lung|respiratory|cough|asthma|pneumonia|tuberculosis/.test(t))
    return 'PULMONOLOGIST';
  if (/brain|neuro|headache|migraine|seizure|dizzy|nerve|paralysis/.test(t))
    return 'NEUROLOGIST';
  if (/fever|cold|flu|stomach|diarrhea|vomiting|fatigue|weakness/.test(t))
    return 'GENERAL_PHYSICIAN';
  return null;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AppointmentBookingScreen({ navigation, route }: Props) {
  const { caseId, chiefComplaint, triageLevel, patientName, patientPhone } = route.params;

  const [practitioners, setPractitioners]   = useState<Practitioner[]>([]);
  const [loadingList, setLoadingList]       = useState(true);
  const [matchedSpecialty, setMatchedSpecialty] = useState<string | null>(null);
  const [isFiltered, setIsFiltered]         = useState(false);

  const [selectedPractitioner, setSelectedPractitioner] = useState<Practitioner | null>(null);
  const [slots, setSlots]                               = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots]                 = useState(false);
  const [selectedSlot, setSelectedSlot]                 = useState<Slot | null>(null);

  const [bookingState, setBookingState] = useState<BookingState>('BROWSING');
  const [bookedSlot, setBookedSlot]     = useState<Slot | null>(null);
  const [bookedDoctor, setBookedDoctor] = useState<Practitioner | null>(null);

  // ── Load practitioners — specialty-filtered with all-doctors fallback ────────

  useEffect(() => {
    const specialty = inferSpecialty(chiefComplaint);
    setMatchedSpecialty(specialty);

    async function load() {
      try {
        // Step 1: try fetching filtered by inferred specialty
        if (specialty) {
          const res = await fetch(
            `${API_BASE_URL}/api/v1/practitioners?specialty=${encodeURIComponent(specialty)}`
          );
          const data = await res.json();
          const filtered: Practitioner[] = data.practitioners ?? [];
          if (filtered.length > 0) {
            setPractitioners(filtered);
            setIsFiltered(true);
            return;
          }
        }
        // Step 2: no specialty match or empty result — show all
        const res = await fetch(`${API_BASE_URL}/api/v1/practitioners`);
        const data = await res.json();
        setPractitioners(data.practitioners ?? []);
        setIsFiltered(false);
      } catch {
        setPractitioners([]);
      } finally {
        setLoadingList(false);
      }
    }

    load();
  }, [chiefComplaint]);

  // ── Select a practitioner → load their slots ───────────────────────────────

  const handleSelectPractitioner = async (p: Practitioner) => {
    if (selectedPractitioner?.id === p.id) {
      setSelectedPractitioner(null);
      setSlots([]);
      setSelectedSlot(null);
      return;
    }
    setSelectedPractitioner(p);
    setSelectedSlot(null);
    setLoadingSlots(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/practitioners/${p.id}/slots`);
      const data = await res.json();
      setSlots(data.slots ?? []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  // ── Confirm booking ────────────────────────────────────────────────────────

  const handleConfirmBooking = async () => {
    if (!selectedPractitioner || !selectedSlot) return;
    setBookingState('CONFIRMING');
    try {
      const body = {
        practitioner_id: selectedPractitioner.id,
        slot_id: selectedSlot.id,
        case_id: caseId ?? null,
        patient_name: patientName,
        patient_phone: patientPhone,
        chief_complaint: chiefComplaint,
        triage_level: triageLevel,
      };
      const res = await fetch(`${API_BASE_URL}/api/v1/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('[Booking] HTTP', res.status, errText);
        throw new Error('Booking failed');
      }
      setBookedSlot(selectedSlot);
      setBookedDoctor(selectedPractitioner);
      setBookingState('SUCCESS');
    } catch (err) {
      console.warn('[Booking] failed:', err);
      setBookingState('ERROR');
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────

  if (bookingState === 'SUCCESS' && bookedSlot && bookedDoctor) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successHeading}>Appointment Booked</Text>
          <Text style={styles.successBody}>
            {bookedDoctor.name}{'\n'}
            {SPECIALTY_LABELS[bookedDoctor.specialty] ?? bookedDoctor.specialty}{'\n'}
            {bookedDoctor.clinic_name}, {bookedDoctor.city}
          </Text>
          <View style={styles.slotBox}>
            <Text style={styles.slotBoxText}>
              {bookedSlot.slot_date}  ·  {bookedSlot.slot_time}
            </Text>
          </View>
          <Text style={styles.successNote}>
            Your doctor will receive your pre-appointment clinical summary before the visit.
          </Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Error screen ───────────────────────────────────────────────────────────

  if (bookingState === 'ERROR') {
    return (
      <View style={styles.container}>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>Booking failed. Please try again.</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => setBookingState('BROWSING')}
          >
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main browse/pick layout ────────────────────────────────────────────────

  return (
    <ScrollView style={styles.bg} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Book an Appointment</Text>
      <Text style={styles.subheading}>
        {isFiltered && matchedSpecialty
          ? `Showing ${SPECIALTY_LABELS[matchedSpecialty] ?? matchedSpecialty}s recommended for your condition. Your clinical summary will be sent to them in advance.`
          : 'Select a doctor and a time that works for you. Your clinical summary will be sent to them in advance.'
        }
      </Text>

      {loadingList ? (
        <ActivityIndicator color="#60a5fa" style={styles.loader} />
      ) : practitioners.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No practitioners available right now.</Text>
        </View>
      ) : (
        practitioners.map((p) => {
          const isSelected = selectedPractitioner?.id === p.id;
          return (
            <View key={p.id} style={[styles.card, isSelected && styles.cardSelected]}>
              <TouchableOpacity
                onPress={() => handleSelectPractitioner(p)}
                activeOpacity={0.75}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardInfo}>
                    <Text style={styles.doctorName}>{p.name}</Text>
                    <Text style={styles.doctorMeta}>
                      {SPECIALTY_LABELS[p.specialty] ?? p.specialty}
                    </Text>
                    <Text style={styles.doctorMeta}>
                      {p.clinic_name} · {p.city}
                    </Text>
                    {p.phone && (
                      <Text style={styles.doctorPhone}>{p.phone}</Text>
                    )}
                  </View>
                  <View style={styles.slotCountBadge}>
                    <Text style={styles.slotCountText}>{p.available_slot_count}</Text>
                    <Text style={styles.slotCountLabel}>slots</Text>
                  </View>
                </View>

                {p.bio ? (
                  <Text style={styles.bio}>{p.bio}</Text>
                ) : null}
              </TouchableOpacity>

              {/* Slot picker — only shown when this practitioner is selected */}
              {isSelected && (
                <View style={styles.slotSection}>
                  <Text style={styles.slotSectionLabel}>Available slots</Text>

                  {loadingSlots ? (
                    <ActivityIndicator color="#60a5fa" />
                  ) : slots.length === 0 ? (
                    <Text style={styles.noSlotsText}>No available slots.</Text>
                  ) : (
                    <View style={styles.slotGrid}>
                      {slots.map((s) => {
                        const picked = selectedSlot?.id === s.id;
                        return (
                          <TouchableOpacity
                            key={s.id}
                            style={[styles.slotChip, picked && styles.slotChipSelected]}
                            onPress={() => setSelectedSlot(picked ? null : s)}
                          >
                            <Text style={[styles.slotDate, picked && styles.slotTextSelected]}>
                              {s.slot_date}
                            </Text>
                            <Text style={[styles.slotTime, picked && styles.slotTextSelected]}>
                              {s.slot_time}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {selectedSlot && (
                    <TouchableOpacity
                      style={[
                        styles.confirmBtn,
                        bookingState === 'CONFIRMING' && styles.confirmBtnDisabled,
                      ]}
                      onPress={handleConfirmBooking}
                      disabled={bookingState === 'CONFIRMING'}
                    >
                      {bookingState === 'CONFIRMING' ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.confirmBtnText}>
                          Confirm — {selectedSlot.slot_date} at {selectedSlot.slot_time}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg:      { flex: 1, backgroundColor: '#030712' },
  content: { padding: 20, paddingTop: 24, paddingBottom: 40 },
  container: { flex: 1, backgroundColor: '#030712', justifyContent: 'center', padding: 24 },

  heading:    { color: '#ffffff', fontSize: 22, fontWeight: '700', marginBottom: 6 },
  subheading: { color: '#6b7280', fontSize: 14, lineHeight: 20, marginBottom: 20 },

  loader: { marginTop: 40 },

  emptyCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: { color: '#6b7280', fontSize: 14 },

  // Practitioner card
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  cardSelected: { borderColor: '#2563eb' },
  cardHeader: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'flex-start',
    gap: 12,
  },
  cardInfo: { flex: 1 },
  doctorName: { color: '#ffffff', fontSize: 16, fontWeight: '600', marginBottom: 3 },
  doctorMeta: { color: '#9ca3af', fontSize: 13, lineHeight: 18 },
  doctorPhone: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  bio: { color: '#6b7280', fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 12 },

  slotCountBadge: {
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 48,
  },
  slotCountText:  { color: '#60a5fa', fontSize: 18, fontWeight: '700' },
  slotCountLabel: { color: '#6b7280', fontSize: 10 },

  // Slot section
  slotSection: {
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    padding: 16,
  },
  slotSectionLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  noSlotsText: { color: '#6b7280', fontSize: 13 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  slotChip: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  slotChipSelected: { borderColor: '#2563eb', backgroundColor: '#1d3461' },
  slotDate: { color: '#9ca3af', fontSize: 11 },
  slotTime: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  slotTextSelected: { color: '#93c5fd' },

  confirmBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },

  // Success
  successCard: {
    backgroundColor: '#052e16',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#166534',
  },
  successIcon:    { fontSize: 44, color: '#4ade80', marginBottom: 12 },
  successHeading: { color: '#ffffff', fontSize: 22, fontWeight: '700', marginBottom: 10 },
  successBody: {
    color: '#d1d5db',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  slotBox: {
    backgroundColor: '#14532d',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 16,
  },
  slotBoxText: { color: '#86efac', fontSize: 15, fontWeight: '600' },
  successNote: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  doneBtn: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  doneBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },

  // Error
  errorCard: {
    backgroundColor: '#1c0202',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  errorText: { color: '#fca5a5', fontSize: 15, marginBottom: 20, textAlign: 'center' },
  retryBtn: {
    backgroundColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
