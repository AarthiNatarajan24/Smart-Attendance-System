import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Student, TimetableEntry} from '../types';
import { MOCK_TIMETABLE, DAYS, DEPARTMENTS, ENROLLMENT_YEARS } from '../constants';
import { faceRecognitionService } from '../services/faceRecognitionService';
import { geminiService } from '../services/geminiService';
import { sqliteService } from '../services/sqliteService';

interface DashboardProps {
  onLogout: () => void;
  adminName: string;
  currentTheme: 'light' | 'dark';
  onToggleTheme: () => void
}

interface PresenceRecord {
  checks: boolean[];
  timestamps: string[];
}

interface HistoryRecord {
  id: string;
  classId: string;
  studentId: string;
  date: string;
  name: string;
  registerNumber: string;
  subject: string;
  department: string;
  attendance: 'Present' | 'Absent';
  verificationTimes: string[];
  verifiedCheckpointCount: number;
  requiredCheckpointCount: number;
  startTime: string;
  endTime: string;
  finalized: boolean;
}

interface PhotoAttendanceRecord {
  student: Student;
  attendance: 'Present' | 'Absent';
  similarity?: number;
}

interface PhotoAttendanceSummary {
  totalStudents: number;
  presentCount: number;
  absentCount: number;
  matchedStudentCount: number;
  detectedFaceCount: number;
  rejectedDetectionCount: number;
}

interface PhotoAttendanceDebugCandidate {
  label: string;
  name: string;
  registerNumber: string;
  similarity: number;
  distance: number;
}

interface PhotoAttendanceDebugRecord {
  faceNumber: number;
  accepted: boolean;
  reason: string;
  bestCandidate?: PhotoAttendanceDebugCandidate;
  secondCandidate?: PhotoAttendanceDebugCandidate;
}

const CLASS_PERIOD_OPTIONS = [
  { label: '10 min', value: 10 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '120 min', value: 120 },
];

const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
const ATTENDANCE_CHECKPOINT_COUNT = 3;
const ATTENDANCE_CHECKPOINT_LABELS = ['Beginning', 'Middle', 'End'] as const;
const LIVE_CONFIRMATION_REQUIRED = 2;
const PHOTO_ATTENDANCE_ENGINE = 'face-api';
const PHOTO_RECOGNITION_STRICT_COSINE_THRESHOLD = 0.945;
const PHOTO_RECOGNITION_STRICT_DISTANCE_THRESHOLD = 0.46;
const PHOTO_RECOGNITION_STRICT_DISTANCE_MARGIN = 0.04;
const PHOTO_RECOGNITION_STRICT_COSINE_MARGIN = 0.01;
const LIVE_SCHEDULE_POLL_INTERVAL_MS = 1000;
const LIVE_CAMERA_SOURCE_STORAGE_KEY = 'insight_live_camera_source';
const LIVE_CAMERA_SOURCE_WEBCAM = 'webcam';
const LIVE_CAMERA_SOURCE_DROIDCAM = 'droidcam';
const LIVE_CAMERA_DEVICE_PREFIX = 'device:';
const DROIDCAM_LIVE_CAMERA_LABEL_PATTERN = /droidcam/i;
const AVOID_LIVE_CAMERA_LABEL_PATTERN = /infrared|ir camera|depth|hello|virtual|obs|snap camera|droidcam|epoccam/i;
const PREFERRED_LIVE_CAMERA_LABEL_PATTERNS = [/integrated/i, /webcam/i, /\bcamera\b/i, /front/i, /hd/i, /usb/i];

const buildLiveCameraConstraints = (deviceId?: string): MediaStreamConstraints => ({
  video: deviceId
    ? {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 }
      } as any
    : {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 }
      },
  audio: false
});

const formatLiveCameraDeviceLabel = (device: MediaDeviceInfo, index: number): string =>
  device.label || `Camera ${index + 1}`;

const scoreLiveCameraLabel = (label: string): number => {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) return 0;

  let score = 0;
  if (AVOID_LIVE_CAMERA_LABEL_PATTERN.test(normalizedLabel)) {
    score -= 100;
  }

  PREFERRED_LIVE_CAMERA_LABEL_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(normalizedLabel)) {
      score += 12 - index;
    }
  });

  return score;
};

const listLiveVideoDevices = async (): Promise<MediaDeviceInfo[]> => {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
  } catch (error) {
    console.warn('Unable to enumerate live-session camera devices.', error);
    return [];
  }
};

const findPreferredLiveVideoDevice = async (excludedIds: string[] = []): Promise<MediaDeviceInfo | null> => {
  const devices = (await listLiveVideoDevices()).filter(device => !excludedIds.includes(device.deviceId));
  if (devices.length === 0) return null;

  return [...devices].sort((a, b) => {
    const scoreDifference = scoreLiveCameraLabel(b.label) - scoreLiveCameraLabel(a.label);
    if (scoreDifference !== 0) return scoreDifference;
    return a.label.localeCompare(b.label);
  })[0];
};

const toMinutesOfDay = (time24: string): number | null => {
  const [h, m] = time24.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60) + m;
};

const classDurationMinutes = (startTime: string, endTime: string): number => {
  const start = toMinutesOfDay(startTime);
  const end = toMinutesOfDay(endTime);
  if (start === null || end === null) return 0;
  return end >= start ? end - start : (1440 - start) + end;
};

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDayOfWeekFromDate = (calendarDate: string): string => {
  const [year, month, day] = calendarDate.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return 'Monday';
  }

  const date = new Date(year, month - 1, day);
  const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
  return DAYS[dayIndex] || 'Monday';
};

const formatBatchLabel = (enrollmentYear?: number | null): string =>
  enrollmentYear ? `Batch ${enrollmentYear}` : 'All Batches';

const studentMatchesClassAudience = (
  student: Student,
  classEntry?: Pick<TimetableEntry, 'department' | 'enrollmentYear'> | null
): boolean => {
  if (!classEntry) return false;
  if (student.department !== classEntry.department) return false;
  return !classEntry.enrollmentYear || student.enrollmentYear === classEntry.enrollmentYear;
};

const getCheckpointLabel = (index: number) =>
  ATTENDANCE_CHECKPOINT_LABELS[
    Math.min(Math.max(index, 0), ATTENDANCE_CHECKPOINT_LABELS.length - 1)
  ];

const getNormalizedHistoryVerificationTimes = (times: unknown): string[] =>
  Array.isArray(times)
    ? times.map(time => typeof time === 'string' ? time : '')
    : [];

  const normalizeHistoryRecord = (record: Partial<HistoryRecord>): HistoryRecord | null => {
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.classId !== 'string' ||
    typeof record.studentId !== 'string' ||
    typeof record.date !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.registerNumber !== 'string' ||
    typeof record.subject !== 'string' ||
    typeof record.department !== 'string' ||
    (record.attendance !== 'Present' && record.attendance !== 'Absent')
  ) {
    return null;
  }

  const verificationTimes = getNormalizedHistoryVerificationTimes(record.verificationTimes);
  const requiredCheckpointCount = Number.isFinite(record.requiredCheckpointCount)
    ? Math.max(1, Number(record.requiredCheckpointCount))
    : ATTENDANCE_CHECKPOINT_COUNT;
  const rawVerifiedCheckpointCount = Number.isFinite(record.verifiedCheckpointCount)
    ? Math.max(0, Math.min(requiredCheckpointCount, Number(record.verifiedCheckpointCount)))
    : (record.attendance === 'Present' ? requiredCheckpointCount : verificationTimes.filter(Boolean).length);
  const finalized = typeof record.finalized === 'boolean'
    ? record.finalized
    : rawVerifiedCheckpointCount >= requiredCheckpointCount;
  const verifiedCheckpointCount =
    finalized && record.attendance === 'Present'
      ? requiredCheckpointCount
      : rawVerifiedCheckpointCount;
  const derivedAttendance: 'Present' | 'Absent' =
    finalized && verifiedCheckpointCount >= requiredCheckpointCount && requiredCheckpointCount > 0
      ? 'Present'
      : 'Absent';

  return {
    id: record.id,
    classId: record.classId,
    studentId: record.studentId,
    date: record.date,
    name: record.name,
    registerNumber: record.registerNumber,
    subject: record.subject,
    department: record.department,
    attendance: derivedAttendance,
    verificationTimes,
    verifiedCheckpointCount,
    requiredCheckpointCount,
    startTime: typeof record.startTime === 'string' ? record.startTime : '',
    endTime: typeof record.endTime === 'string' ? record.endTime : '',
    finalized
  };
};

const formatHistoryVerificationTimeline = (record: HistoryRecord): string =>
  record.verificationTimes.some(Boolean)
    ? record.verificationTimes
        .map((time, index) => time ? `${getCheckpointLabel(index)}: ${time}` : '')
        .filter(Boolean)
        .join(' | ')
    : 'No checkpoints verified';

const mergeCheckpointTimes = (existing: string[], incoming: string[], checkpointCount: number): string[] =>
  Array.from({ length: checkpointCount }, (_, index) => incoming[index] || existing[index] || '');

const Dashboard: React.FC<DashboardProps> = ({ onLogout, adminName, currentTheme, onToggleTheme }) => {
  const [activeTab, setActiveTab] = useState<'monitoring' | 'students' | 'schedule'>('monitoring');
  const [monitoringSubTab, setMonitoringSubTab] = useState<'live' | 'photo' | 'history'>('live');
  const [students, setStudents] = useState<Student[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>(() => {
    const saved = localStorage.getItem('insight_timetable');
    return saved ? JSON.parse(saved) : MOCK_TIMETABLE;
  });
  
  const [history, setHistory] = useState<HistoryRecord[]>(() => {
    try {
      const saved = localStorage.getItem('insight_history');
      if (!saved) return [];

      const parsed = JSON.parse(saved) as Array<Partial<HistoryRecord>>;
      return parsed
        .map(record => normalizeHistoryRecord(record))
        .filter((record): record is HistoryRecord => record !== null);
    } catch {
      return [];
    }
  });
  
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const [activeClass, setActiveClass] = useState<TimetableEntry | null>(null);
  const [presenceData, setPresenceData] = useState<Record<string, PresenceRecord>>({});
  const [lastDetectedId, setLastDetectedId] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);

  const [newClass, setNewClass] = useState<Partial<TimetableEntry>>({ dayOfWeek: 'Monday', calendarDate: '' });
  const [classPeriodMinutes, setClassPeriodMinutes] = useState<string>('60');
  const [startHour12, setStartHour12] = useState<string>('09');
  const [startMinute, setStartMinute] = useState<string>('00');
  const [startMeridiem, setStartMeridiem] = useState<'AM' | 'PM'>('AM');
  const [showAddClass, setShowAddClass] = useState(false);

  const [historyDateFilter, setHistoryDateFilter] = useState<string>('');
  const [historyDeptFilter, setHistoryDeptFilter] = useState<string>('all');
  const [historySubjectFilter, setHistorySubjectFilter] = useState<string>('');
  const [photoAttendanceDepartment, setPhotoAttendanceDepartment] = useState<string>('');
  const [photoAttendanceYear, setPhotoAttendanceYear] = useState<string>('');
  const [photoAttendanceSubject, setPhotoAttendanceSubject] = useState<string>('');
  const [photoAttendanceImageUrl, setPhotoAttendanceImageUrl] = useState<string | null>(null);
  const [photoAttendanceImageName, setPhotoAttendanceImageName] = useState<string>('');
  const [photoAttendanceImageReady, setPhotoAttendanceImageReady] = useState(false);
  const [photoAttendanceStatus, setPhotoAttendanceStatus] = useState('Upload a classroom photo to scan registered students only.');
  const [photoAttendanceProcessing, setPhotoAttendanceProcessing] = useState(false);
  const [photoAttendanceResults, setPhotoAttendanceResults] = useState<PhotoAttendanceRecord[]>([]);
  const [photoAttendanceSummary, setPhotoAttendanceSummary] = useState<PhotoAttendanceSummary | null>(null);
  const [photoAttendanceDebugRecords, setPhotoAttendanceDebugRecords] = useState<PhotoAttendanceDebugRecord[]>([]);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [clockTick, setClockTick] = useState<number>(Date.now());
  const [isLiveCameraReady, setIsLiveCameraReady] = useState(false);
  const [liveCameraError, setLiveCameraError] = useState<string | null>(null);
  const [liveVideoDevices, setLiveVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [liveCameraSource, setLiveCameraSource] = useState<string>(() => (
    localStorage.getItem(LIVE_CAMERA_SOURCE_STORAGE_KEY) || LIVE_CAMERA_SOURCE_WEBCAM
  ));
  const [activeLiveCameraLabel, setActiveLiveCameraLabel] = useState<string>('No live camera active');

  const videoRef = useRef<HTMLVideoElement>(null);
  const photoAttendanceImageRef = useRef<HTMLImageElement>(null);
  const pendingCandidatesRef = useRef<{ label: string; descriptor: Float32Array }[]>([]);
  const liveMatchStreaksRef = useRef<Record<string, { checkpointIndex: number; count: number; lastSeenAt: number }>>({});
  const autoOpenedClassIdRef = useRef<string | null>(null);

  const refreshLiveCameraDevices = async () => {
    const devices = await listLiveVideoDevices();
    setLiveVideoDevices(devices);
    return devices;
  };

  useEffect(() => {
    localStorage.setItem(LIVE_CAMERA_SOURCE_STORAGE_KEY, liveCameraSource);
  }, [liveCameraSource]);

  useEffect(() => {
    let isDisposed = false;

    const refreshDevices = async () => {
      const devices = await listLiveVideoDevices();
      if (!isDisposed) {
        setLiveVideoDevices(devices);
      }
    };

    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

    return () => {
      isDisposed = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeClass) return;
    setPhotoAttendanceDepartment(prev => prev || activeClass.department);
    setPhotoAttendanceYear(prev => prev || (activeClass.enrollmentYear ? activeClass.enrollmentYear.toString() : ''));
    setPhotoAttendanceSubject(prev => prev || activeClass.subject);
  }, [activeClass?.id]);

  useEffect(() => {
    return () => {
      if (photoAttendanceImageUrl) {
        URL.revokeObjectURL(photoAttendanceImageUrl);
      }
    };
  }, [photoAttendanceImageUrl]);

  const departmentDescriptors = useMemo(() => {
    if (!activeClass) return [];
    return students
      .filter(s => studentMatchesClassAudience(s, activeClass))
      .filter(s => s.faceDescription && faceRecognitionService.isStoredDescriptorCompatible(s.faceDescription))
      .map(s => ({
        label: s.id,
        descriptor: faceRecognitionService.deserializeDescriptor(s.faceDescription!)
      }));
  }, [activeClass, students]);

  const activeCheckpointConfig = useMemo(() => {
    if (!activeClass) {
      return {
        checkpointCount: 0,
        currentCheckpointIndex: 0,
        currentCheckpointNumber: 0,
        currentCheckpointLabel: getCheckpointLabel(0),
        phaseDurationMinutes: 0
      };
    }

    const duration = classDurationMinutes(activeClass.startTime, activeClass.endTime);
    const startMinutes = toMinutesOfDay(activeClass.startTime);
    const now = new Date(clockTick);
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const checkpointCount = ATTENDANCE_CHECKPOINT_COUNT;
    const phaseDurationMinutes = duration > 0
      ? Math.max(1, Math.ceil(duration / checkpointCount))
      : 0;

    if (startMinutes === null || duration <= 0) {
      return {
        checkpointCount,
        currentCheckpointIndex: 0,
        currentCheckpointNumber: 1,
        currentCheckpointLabel: getCheckpointLabel(0),
        phaseDurationMinutes
      };
    }

    let elapsed = nowMinutes - startMinutes;
    if (elapsed < 0) elapsed += 1440;
    const clampedElapsed = Math.min(Math.max(elapsed, 0), duration);
    const currentCheckpointIndex = Math.min(
      checkpointCount - 1,
      Math.floor((clampedElapsed / Math.max(duration, 1)) * checkpointCount)
    );

    return {
      checkpointCount,
      currentCheckpointIndex,
      currentCheckpointNumber: currentCheckpointIndex + 1,
      currentCheckpointLabel: getCheckpointLabel(currentCheckpointIndex),
      phaseDurationMinutes
    };
  }, [activeClass, clockTick]);

  const getNormalizedChecks = (record: PresenceRecord | undefined, checkpointCount: number): boolean[] =>
    Array.from({ length: checkpointCount }, (_, i) => Boolean(record?.checks?.[i]));

  const getNormalizedTimestamps = (record: PresenceRecord | undefined, checkpointCount: number): string[] =>
    Array.from({ length: checkpointCount }, (_, i) => record?.timestamps?.[i] || '');

  const hasContinuousPresenceByCheckpoint = (record: PresenceRecord | undefined, checkpointCount: number, checkpointIndex: number): boolean => {
    if (checkpointCount <= 0) return false;
    const checks = getNormalizedChecks(record, checkpointCount);
    return checks.slice(0, checkpointIndex + 1).every(Boolean);
  };

  useEffect(() => {
    setPresenceData({});
    setLastDetectedId(null);
    liveMatchStreaksRef.current = {};
  }, [activeClass?.id]);

  useEffect(() => {
    if (!activeClass?.id) {
      autoOpenedClassIdRef.current = null;
      return;
    }

    if (autoOpenedClassIdRef.current === activeClass.id) {
      return;
    }

    autoOpenedClassIdRef.current = activeClass.id;
    setActiveTab('monitoring');
    setMonitoringSubTab('live');
  }, [activeClass?.id]);

  useEffect(() => {
    liveMatchStreaksRef.current = {};
  }, [activeCheckpointConfig.currentCheckpointIndex]);

  const pendingRecognitionCandidates = useMemo(() => {
    if (!activeClass || activeCheckpointConfig.checkpointCount === 0) return [];

    const checkpointIndex = activeCheckpointConfig.currentCheckpointIndex;
    const checkpointCount = activeCheckpointConfig.checkpointCount;

    return departmentDescriptors.filter(candidate => {
      const checks = getNormalizedChecks(presenceData[candidate.label], checkpointCount);
      const missedEarlierCheckpoint = checks.slice(0, checkpointIndex).some(checked => !checked);
      if (missedEarlierCheckpoint) return false;
      return !checks[checkpointIndex];
    });
  }, [activeClass, activeCheckpointConfig.currentCheckpointIndex, activeCheckpointConfig.checkpointCount, departmentDescriptors, presenceData]);

  const liveScanIntervalMs = useMemo(() => {
    if (pendingRecognitionCandidates.length > 40) return 650;
    if (pendingRecognitionCandidates.length > 20) return 800;
    return 1000;
  }, [pendingRecognitionCandidates.length]);

  useEffect(() => {
    pendingCandidatesRef.current = pendingRecognitionCandidates;
  }, [pendingRecognitionCandidates]);

  useEffect(() => {
    let active = true;

    const loadStudents = async () => {
      try {
        await sqliteService.init();
        const storedStudents = await sqliteService.getStudents();
        if (active) {
          setStudents(storedStudents);
        }
      } catch (error) {
        console.error('Failed to load students from SQLite:', error);
      }
    };

    loadStudents();

    return () => {
      active = false;
    };
  }, []);

  const calculateEndTime = (startTime: string, minutesToAdd: number): string => {
    const [hours, minutes] = startTime.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';

    const totalMinutes = (hours * 60) + minutes + minutesToAdd;
    const wrappedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
    const endHours = Math.floor(wrappedMinutes / 60).toString().padStart(2, '0');
    const endMinutes = (wrappedMinutes % 60).toString().padStart(2, '0');
    return `${endHours}:${endMinutes}`;
  };

  const to24HourTime = (hour12: string, minute: string, meridiem: 'AM' | 'PM'): string => {
    const parsedHour = Number(hour12);
    const parsedMinute = Number(minute);
    if (!Number.isFinite(parsedHour) || !Number.isFinite(parsedMinute)) return '';

    const hour24 = (parsedHour % 12) + (meridiem === 'PM' ? 12 : 0);
    return `${hour24.toString().padStart(2, '0')}:${parsedMinute.toString().padStart(2, '0')}`;
  };

  const formatTo12HourTime = (time24: string): string => {
    const [hourRaw, minuteRaw] = time24.split(':').map(Number);
    if (!Number.isFinite(hourRaw) || !Number.isFinite(minuteRaw)) return '--:--';

    const meridiem = hourRaw >= 12 ? 'PM' : 'AM';
    const hour12 = hourRaw % 12 || 12;
    return `${hour12.toString().padStart(2, '0')}:${minuteRaw.toString().padStart(2, '0')} ${meridiem}`;
  };

  useEffect(() => {
    const computedStartTime = to24HourTime(startHour12, startMinute, startMeridiem);
    if (!computedStartTime) {
      setNewClass(prev => ({ ...prev, startTime: '', endTime: '' }));
      return;
    }

    const computedEndTime = calculateEndTime(computedStartTime, Number(classPeriodMinutes));
    setNewClass(prev => (
      prev.startTime === computedStartTime && prev.endTime === computedEndTime
        ? prev
        : { ...prev, startTime: computedStartTime, endTime: computedEndTime }
    ));
  }, [startHour12, startMinute, startMeridiem, classPeriodMinutes]);

  const markPresenceBatch = (studentIds: string[], checkpointIndex: number, checkpointCount: number) => {
    if (studentIds.length === 0) return;

    setPresenceData(prev => {
      let next = prev;
      let changed = false;

      for (const sid of studentIds) {
        const current = next[sid] || { checks: [], timestamps: [] };
        const normalizedChecks = Array.from({ length: checkpointCount }, (_, i) => Boolean(current.checks[i]));
        const normalizedTimestamps = Array.from({ length: checkpointCount }, (_, i) => current.timestamps[i] || '');
        if (normalizedChecks[checkpointIndex]) continue;

        if (!changed) {
          next = { ...next };
          changed = true;
        }

        normalizedChecks[checkpointIndex] = true;
        normalizedTimestamps[checkpointIndex] = new Date().toLocaleTimeString();

        next[sid] = {
          checks: normalizedChecks,
          timestamps: normalizedTimestamps
        };
      }

      return changed ? next : prev;
    });
  };

  useEffect(() => {
    let isDisposed = false;
    let stream: MediaStream | null = null;

    const stopLiveStream = () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }

      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      setIsLiveCameraReady(false);
      setActiveLiveCameraLabel('No live camera active');
    };

    const setupLiveCamera = async () => {
      if (activeTab !== 'monitoring' || monitoringSubTab !== 'live' || !activeClass) {
        setLiveCameraError(null);
        stopLiveStream();
        return;
      }

      setLiveCameraError(null);

      try {
        await faceRecognitionService.loadModels();

        let availableDevices = await refreshLiveCameraDevices();
        let selectedDevice: MediaDeviceInfo | null = null;

        if (liveCameraSource.startsWith(LIVE_CAMERA_DEVICE_PREFIX)) {
          const selectedDeviceId = liveCameraSource.slice(LIVE_CAMERA_DEVICE_PREFIX.length);
          selectedDevice = availableDevices.find(device => device.deviceId === selectedDeviceId) || null;

          if (!selectedDevice) {
            throw Object.assign(new Error('Selected camera device is no longer available.'), {
              name: 'SelectedLiveCameraNotFoundError'
            });
          }
        } else if (liveCameraSource === LIVE_CAMERA_SOURCE_DROIDCAM) {
          selectedDevice = availableDevices.find(device => DROIDCAM_LIVE_CAMERA_LABEL_PATTERN.test(device.label)) || null;

          if (!selectedDevice && availableDevices.every(device => !device.label)) {
            const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            permissionStream.getTracks().forEach(track => track.stop());
            availableDevices = await refreshLiveCameraDevices();
            selectedDevice = availableDevices.find(device => DROIDCAM_LIVE_CAMERA_LABEL_PATTERN.test(device.label)) || null;
          }

          if (!selectedDevice) {
            throw Object.assign(new Error('DroidCam virtual camera was not found.'), {
              name: 'DroidCamNotFoundError'
            });
          }
        } else {
          selectedDevice = await findPreferredLiveVideoDevice();
        }

        const constraintFallbacks: MediaStreamConstraints[] = selectedDevice
          ? [
              buildLiveCameraConstraints(selectedDevice.deviceId),
              {
                video: {
                  deviceId: { exact: selectedDevice.deviceId }
                } as any,
                audio: false
              }
            ]
          : [
              {
                video: {
                  facingMode: 'environment',
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 24, max: 30 }
                } as any,
                audio: false
              },
              buildLiveCameraConstraints(),
              {
                video: true,
                audio: false
              }
            ];

        let nextStream: MediaStream | null = null;
        let lastError: any = null;

        for (const constraints of constraintFallbacks) {
          try {
            nextStream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (error) {
            lastError = error;
          }
        }

        if (!nextStream) {
          throw lastError || new Error('Unable to open classroom camera stream.');
        }

        const initialTrack = nextStream.getVideoTracks()[0];
        const initialDeviceId = initialTrack?.getSettings?.().deviceId;
        let initialLabel = initialTrack?.label || selectedDevice?.label || '';

        if (
          liveCameraSource === LIVE_CAMERA_SOURCE_WEBCAM &&
          initialLabel &&
          AVOID_LIVE_CAMERA_LABEL_PATTERN.test(initialLabel)
        ) {
          const alternateDevice = await findPreferredLiveVideoDevice(initialDeviceId ? [initialDeviceId] : []);

          if (alternateDevice && !AVOID_LIVE_CAMERA_LABEL_PATTERN.test(alternateDevice.label)) {
            nextStream.getTracks().forEach(track => track.stop());
            nextStream = await navigator.mediaDevices.getUserMedia(buildLiveCameraConstraints(alternateDevice.deviceId));
            initialLabel = nextStream.getVideoTracks()[0]?.label || alternateDevice.label || initialLabel;
          }
        }

        if (isDisposed || !videoRef.current) {
          nextStream.getTracks().forEach(track => track.stop());
          return;
        }

        stream = nextStream;
        setActiveLiveCameraLabel(initialLabel || (liveCameraSource === LIVE_CAMERA_SOURCE_DROIDCAM ? 'DroidCam Phone' : 'Laptop Webcam'));
        void refreshLiveCameraDevices();
        const videoElement = videoRef.current;

        const markReady = async () => {
          try {
            await videoElement.play();
          } catch (error) {
            console.error('Live session playback failed', error);
          } finally {
            if (!isDisposed) {
              setIsLiveCameraReady(true);
            }
          }
        };

        videoElement.srcObject = nextStream;
        videoElement.onloadedmetadata = () => {
          void markReady();
        };
        videoElement.onloadeddata = () => {
          void markReady();
        };

        if (videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
          void markReady();
        }
      } catch (error: any) {
        console.error('Dashboard live camera setup failed', error);
        stopLiveStream();

        if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
          setLiveCameraError('Camera access is blocked for the scheduled live session.');
        } else if (error?.name === 'DroidCamNotFoundError') {
          setLiveCameraError('DroidCam was selected, but the DroidCam virtual camera was not found. Open DroidCam Classic on the phone, connect it in the laptop client, then refresh cameras.');
        } else if (error?.name === 'SelectedLiveCameraNotFoundError') {
          setLiveCameraError('The selected live camera is no longer available. Refresh cameras or choose Laptop Webcam.');
        } else if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError' || error?.name === 'AbortError') {
          setLiveCameraError('The classroom camera is busy in another app.');
        } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
          setLiveCameraError('No classroom camera was found on this device.');
        } else {
          setLiveCameraError('The live session camera could not be started.');
        }
      }
    };

    void setupLiveCamera();

    return () => {
      isDisposed = true;
      stopLiveStream();
    };
  }, [activeTab, monitoringSubTab, activeClass?.id, liveCameraSource]);

  useEffect(() => {
    let scanInterval: ReturnType<typeof setInterval> | null = null;
    let highlightTimeout: ReturnType<typeof setTimeout> | null = null;
    let isMatchingFrame = false;
    let isDisposed = false;

    if (activeTab !== 'monitoring' || monitoringSubTab !== 'live' || !activeClass || !isLiveCameraReady) {
      liveMatchStreaksRef.current = {};
      return;
    }

    scanInterval = setInterval(async () => {
      const pendingCandidates = pendingCandidatesRef.current;
      if (
        isDisposed ||
        isMatchingFrame ||
        !videoRef.current ||
        videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !activeClass
      ) {
        return;
      }

      if (pendingCandidates.length === 0) {
        liveMatchStreaksRef.current = {};
        return;
      }

      isMatchingFrame = true;
      try {
        const matches = await faceRecognitionService.matchFaces(videoRef.current, pendingCandidates);
        const checkpointIndex = activeCheckpointConfig.currentCheckpointIndex;
        const nowMs = Date.now();

        if (matches.length > 0) {
          const streaks = liveMatchStreaksRef.current;
          const confirmedIds: string[] = [];
          const nextStreaks: Record<string, { checkpointIndex: number; count: number; lastSeenAt: number }> = {};

          for (const match of matches) {
            const previous = streaks[match.label];
            const count =
              previous &&
              previous.checkpointIndex === checkpointIndex &&
              (nowMs - previous.lastSeenAt) <= (liveScanIntervalMs * 2.5)
                ? previous.count + 1
                : 1;

            nextStreaks[match.label] = {
              checkpointIndex,
              count,
              lastSeenAt: nowMs
            };

            if (count >= LIVE_CONFIRMATION_REQUIRED) {
              confirmedIds.push(match.label);
            }
          }

          liveMatchStreaksRef.current = nextStreaks;

          if (confirmedIds.length === 0) {
            return;
          }

          markPresenceBatch(
            Array.from(new Set(confirmedIds)),
            checkpointIndex,
            activeCheckpointConfig.checkpointCount
          );
          setLastDetectedId(confirmedIds[0]);

          if (highlightTimeout) clearTimeout(highlightTimeout);
          highlightTimeout = setTimeout(() => {
            setLastDetectedId(prev => (prev === confirmedIds[0] ? null : prev));
          }, 1800);
        } else {
          liveMatchStreaksRef.current = {};
        }
      } finally {
        isMatchingFrame = false;
      }
    }, liveScanIntervalMs);

    return () => {
      isDisposed = true;
      liveMatchStreaksRef.current = {};
      if (scanInterval) {
        clearInterval(scanInterval);
      }
      if (highlightTimeout) {
        clearTimeout(highlightTimeout);
      }
    };
  }, [
    activeTab,
    monitoringSubTab,
    activeClass,
    isLiveCameraReady,
    liveScanIntervalMs,
    activeCheckpointConfig.currentCheckpointIndex,
    activeCheckpointConfig.checkpointCount
  ]);

  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const dateStr = formatLocalDate(now);
      const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const day = DAYS[dayIndex];
      const match = timetable
        .filter(t =>
          t.dayOfWeek === day &&
          (!t.calendarDate || t.calendarDate === dateStr) &&
          timeStr >= t.startTime &&
          timeStr <= t.endTime
        )
        .sort((a, b) => Number(Boolean(b.calendarDate)) - Number(Boolean(a.calendarDate)))[0];
      setActiveClass(match || null);
    };
    checkTime();
    const interval = setInterval(checkTime, LIVE_SCHEDULE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [timetable]);

  const currentClassStudents = useMemo(() => {
    return activeClass ? students.filter(student => studentMatchesClassAudience(student, activeClass)) : [];
  }, [activeClass, students]);

  const photoAttendanceStudents = useMemo(() => {
    if (!photoAttendanceDepartment || !photoAttendanceYear) return [];
    return students
      .filter(student =>
        student.department === photoAttendanceDepartment &&
        student.enrollmentYear.toString() === photoAttendanceYear
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.registerNumber.localeCompare(b.registerNumber));
  }, [students, photoAttendanceDepartment, photoAttendanceYear]);

  const photoAttendanceCandidates = useMemo(() => {
    return photoAttendanceStudents
      .filter(student => student.faceDescription && faceRecognitionService.isStoredDescriptorCompatible(student.faceDescription, PHOTO_ATTENDANCE_ENGINE))
      .map(student => ({
        label: student.id,
        descriptor: faceRecognitionService.deserializeDescriptor(student.faceDescription!)
      }));
  }, [photoAttendanceStudents]);

  const photoAttendanceBiometricStats = useMemo(() => {
    const enrolled = photoAttendanceStudents.filter(student => !!student.faceDescription).length;
    return {
      enrolled,
      faceApiReady: photoAttendanceCandidates.length,
      disabledCount: Math.max(0, enrolled - photoAttendanceCandidates.length),
      totalReady: photoAttendanceCandidates.length
    };
  }, [photoAttendanceStudents, photoAttendanceCandidates.length]);

  const photoAttendanceSnapshot = useMemo<PhotoAttendanceSummary>(() => (
    photoAttendanceSummary || {
      totalStudents: photoAttendanceStudents.length,
      presentCount: 0,
      absentCount: photoAttendanceStudents.length,
      matchedStudentCount: 0,
      detectedFaceCount: 0,
      rejectedDetectionCount: 0
    }
  ), [photoAttendanceSummary, photoAttendanceStudents.length]);

  const rejectedPhotoAttendanceDebugRecords = useMemo(
    () => photoAttendanceDebugRecords.filter(record => !record.accepted),
    [photoAttendanceDebugRecords]
  );

  const attendanceStats = useMemo(() => {
    const total = currentClassStudents.length;
    const present = currentClassStudents.filter(student =>
      hasContinuousPresenceByCheckpoint(
        presenceData[student.id],
        activeCheckpointConfig.checkpointCount,
        activeCheckpointConfig.currentCheckpointIndex
      )
    ).length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent: total - present, percentage };
  }, [currentClassStudents, presenceData, activeCheckpointConfig.checkpointCount, activeCheckpointConfig.currentCheckpointIndex]);

  useEffect(() => {
    setAiReport(null);
    setIsGeneratingReport(false);
  }, [activeClass?.id]);

  const handleGenerateAIReport = async () => {
    if (!activeClass) {
      setAiReport('AI Report unavailable: no scheduled class is currently active.');
      return;
    }

    if (attendanceStats.total === 0) {
      setAiReport('AI Report unavailable: no students are registered for this scheduled class.');
      return;
    }

    setIsGeneratingReport(true);
    setAiReport(null);

    try {
      const report = await geminiService.generateAttendanceReport({
        totalStudents: attendanceStats.total,
        presentCount: attendanceStats.present,
        absentCount: attendanceStats.absent,
        department: activeClass.department,
        subject: activeClass.subject
      });
      setAiReport(report);
    } catch (error) {
      console.error('AI attendance report generation failed:', error);
      setAiReport('The AI report could not be generated right now.');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('insight_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    const now = new Date();
    const today = formatLocalDate(now);
    const todayDayOfWeek = getDayOfWeekFromDate(today);
    const timeNow = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    setHistory(prev => {
      const pastRecords = prev.filter(r => r.date !== today);
      const todayRecords = prev.filter(r => r.date === today);
      const todayRecordMap = new Map<string, HistoryRecord>(
        todayRecords.map(r => [`${r.classId}|${r.studentId}`, r] as const)
      );
      const nextTodayRecords: HistoryRecord[] = [];

      const todaysStartedClasses = timetable.filter(classEntry => {
        const matchesDate = (!classEntry.calendarDate && classEntry.dayOfWeek === todayDayOfWeek) || classEntry.calendarDate === today;
        if (!matchesDate) return false;
        return timeNow >= classEntry.startTime || todayRecords.some(record => record.classId === classEntry.id);
      });

      todaysStartedClasses.forEach(classEntry => {
        const classStudents = students.filter(student => studentMatchesClassAudience(student, classEntry));
        const classHasFinished = timeNow > classEntry.endTime;

        classStudents.forEach(student => {
          const key = `${classEntry.id}|${student.id}`;
          const existing = todayRecordMap.get(key);
          const isCurrentActiveClass = activeClass?.id === classEntry.id;
          const requiredCheckpointCount = existing?.requiredCheckpointCount || ATTENDANCE_CHECKPOINT_COUNT;
          const existingVerificationTimes = existing?.verificationTimes || [];
          const existingVerifiedCheckpointCount = existing?.finalized && existing?.attendance === 'Present'
            ? requiredCheckpointCount
            : (existing?.verifiedCheckpointCount || existingVerificationTimes.filter(Boolean).length);
          const liveVerificationTimes = isCurrentActiveClass
            ? getNormalizedTimestamps(presenceData[student.id], requiredCheckpointCount)
            : [];
          const liveVerifiedCheckpointCount = isCurrentActiveClass
            ? getNormalizedChecks(presenceData[student.id], requiredCheckpointCount).filter(Boolean).length
            : 0;
          const verificationTimes = mergeCheckpointTimes(
            existingVerificationTimes,
            liveVerificationTimes,
            requiredCheckpointCount
          );
          const verifiedCheckpointCount = Math.max(
            existingVerifiedCheckpointCount,
            verificationTimes.filter(Boolean).length,
            liveVerifiedCheckpointCount
          );
          const hasCompletedRequiredCheckpoints = verifiedCheckpointCount >= requiredCheckpointCount && requiredCheckpointCount > 0;
          const finalized = existing?.finalized || classHasFinished || hasCompletedRequiredCheckpoints;
          const attendance: 'Present' | 'Absent' =
            finalized && hasCompletedRequiredCheckpoints
              ? 'Present'
              : 'Absent';

          nextTodayRecords.push({
            id: `${today}_${classEntry.id}_${student.id}`,
            classId: classEntry.id,
            studentId: student.id,
            date: today,
            name: student.name,
            registerNumber: student.registerNumber,
            subject: classEntry.subject,
            department: classEntry.department,
            attendance,
            verificationTimes,
            verifiedCheckpointCount,
            requiredCheckpointCount,
            startTime: classEntry.startTime,
            endTime: classEntry.endTime,
            finalized
          });
        });
      });

      const next = [...pastRecords, ...nextTodayRecords].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
        return a.name.localeCompare(b.name);
      });

      if (next.length === prev.length && next.every((record, idx) => JSON.stringify(record) === JSON.stringify(prev[idx]))) {
        return prev;
      }

      return next;
    });
  }, [
    timetable,
    students,
    activeClass,
    presenceData,
    activeCheckpointConfig.checkpointCount,
    activeCheckpointConfig.currentCheckpointIndex
  ]);

  const filteredHistory = useMemo(() => {
    const normalizedSubjectFilter = historySubjectFilter.trim().toLowerCase();
    return history.filter(h => {
      const matchDate = !historyDateFilter || h.date === historyDateFilter;
      const matchDept = historyDeptFilter === 'all' || h.department === historyDeptFilter;
      const matchSubject = !normalizedSubjectFilter || h.subject.toLowerCase().includes(normalizedSubjectFilter);
      return matchDate && matchDept && matchSubject;
    });
  }, [history, historyDateFilter, historyDeptFilter, historySubjectFilter]);

  const historySummary = useMemo(() => {
    const present = filteredHistory.filter(record => record.attendance === 'Present').length;
    const absent = filteredHistory.length - present;
    return {
      total: filteredHistory.length,
      present,
      absent
    };
  }, [filteredHistory]);

  useEffect(() => {
    setPhotoAttendanceResults([]);
    setPhotoAttendanceSummary(null);
    setPhotoAttendanceDebugRecords([]);
    if (!photoAttendanceImageUrl) {
      setPhotoAttendanceStatus('Upload a classroom photo to scan registered students only.');
      setPhotoAttendanceImageReady(false);
      setPhotoAttendanceImageName('');
    }
  }, [photoAttendanceDepartment, photoAttendanceYear, photoAttendanceImageUrl]);

  const batchSummary = useMemo(() => {
    const counts = students.reduce<Record<string, number>>((acc, student) => {
      const year = student.enrollmentYear.toString();
      acc[year] = (acc[year] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts)
      .map(([year, total]) => ({ year, total }))
      .sort((a, b) => Number(b.year) - Number(a.year));
  }, [students]);

  const filteredStudents = useMemo(() => {
    return students
      .filter(s => yearFilter === 'all' || s.enrollmentYear.toString() === yearFilter)
      .sort((a, b) => {
        if (a.enrollmentYear !== b.enrollmentYear) return b.enrollmentYear - a.enrollmentYear;

        const departmentCompare = a.department.localeCompare(b.department);
        if (departmentCompare !== 0) return departmentCompare;

        const nameCompare = a.name.localeCompare(b.name);
        if (nameCompare !== 0) return nameCompare;

        return a.registerNumber.localeCompare(b.registerNumber);
      });
  }, [students, yearFilter]);

  const departmentSummary = useMemo(() => {
    const counts = filteredStudents.reduce<Record<string, number>>((acc, student) => {
      acc[student.department] = (acc[student.department] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts)
      .map(([department, total]) => ({ department, total }))
      .sort((a, b) => b.total - a.total || a.department.localeCompare(b.department));
  }, [filteredStudents]);

  const selectedBatchLabel = yearFilter === 'all' ? 'All Batches' : `Batch ${yearFilter}`;

  useEffect(() => {
    if (yearFilter !== 'all' && !batchSummary.some(batch => batch.year === yearFilter)) {
      setYearFilter('all');
    }
  }, [batchSummary, yearFilter]);

  const downloadCSV = (content: string, fileName: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePhotoAttendanceImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (photoAttendanceImageUrl) {
      URL.revokeObjectURL(photoAttendanceImageUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setPhotoAttendanceImageUrl(objectUrl);
    setPhotoAttendanceImageName(file.name);
    setPhotoAttendanceImageReady(false);
    setPhotoAttendanceResults([]);
    setPhotoAttendanceSummary(null);
    setPhotoAttendanceDebugRecords([]);
    setPhotoAttendanceStatus(`Loaded ${file.name}. Once the preview is ready, start the scan.`);
    event.target.value = '';
  };

  const handleAnalyzePhotoAttendance = async () => {
    if (!photoAttendanceDepartment) {
      setPhotoAttendanceStatus('Select a department before scanning the group photo.');
      return;
    }

    if (!photoAttendanceYear) {
      setPhotoAttendanceStatus('Select a batch year before scanning the group photo.');
      return;
    }

    if (!photoAttendanceImageRef.current || !photoAttendanceImageReady) {
      setPhotoAttendanceStatus('Wait for the uploaded image preview to finish loading before scanning.');
      return;
    }

    if (photoAttendanceStudents.length === 0) {
      setPhotoAttendanceStatus(`No registered students were found for ${photoAttendanceDepartment} ${formatBatchLabel(Number(photoAttendanceYear))}.`);
      return;
    }

    if (photoAttendanceCandidates.length === 0) {
      setPhotoAttendanceStatus(
        photoAttendanceBiometricStats.disabledCount > 0
          ? 'This department only has biometric records from the disabled InsightFace engine. Re-enroll those students with face-api to use group-photo scanning.'
          : 'No compatible biometric records are available for the selected department and batch.'
      );
      return;
    }

    setPhotoAttendanceProcessing(true);
    setPhotoAttendanceResults([]);
    setPhotoAttendanceSummary(null);
    setPhotoAttendanceDebugRecords([]);
    setPhotoAttendanceStatus('Scanning uploaded group photo across upright and rotated orientations...');

    try {
      await faceRecognitionService.loadModels(PHOTO_ATTENDANCE_ENGINE);

      const studentLookup = new Map(photoAttendanceStudents.map(student => [student.id, student] as const));
      const detections = await faceRecognitionService.getDescriptors(photoAttendanceImageRef.current);
      const analyzedDetections = detections.map((detection, index) => {
        const rankedCandidates: PhotoAttendanceDebugCandidate[] = photoAttendanceCandidates
          .map(candidate => ({
            label: candidate.label,
            name: studentLookup.get(candidate.label)?.name || candidate.label,
            registerNumber: studentLookup.get(candidate.label)?.registerNumber || 'N/A',
            similarity: faceRecognitionService.calculateCosineSimilarity(detection.descriptor, candidate.descriptor),
            distance: faceRecognitionService.calculateEuclideanDistance(detection.descriptor, candidate.descriptor)
          }))
          .filter(candidate => Number.isFinite(candidate.similarity) && Number.isFinite(candidate.distance))
          .sort((a, b) => {
            if (a.distance !== b.distance) return a.distance - b.distance;
            return b.similarity - a.similarity;
          });

        const [bestCandidate, secondCandidate] = rankedCandidates;
        const hasStrictSimilarity = Boolean(bestCandidate && bestCandidate.similarity >= PHOTO_RECOGNITION_STRICT_COSINE_THRESHOLD);
        const hasStrictDistance = Boolean(bestCandidate && bestCandidate.distance <= PHOTO_RECOGNITION_STRICT_DISTANCE_THRESHOLD);
        const hasClearSeparation = !bestCandidate || !secondCandidate || (
          (secondCandidate.distance - bestCandidate.distance) >= PHOTO_RECOGNITION_STRICT_DISTANCE_MARGIN &&
          (bestCandidate.similarity - secondCandidate.similarity) >= PHOTO_RECOGNITION_STRICT_COSINE_MARGIN
        );
        const accepted = Boolean(bestCandidate && hasStrictSimilarity && hasStrictDistance && hasClearSeparation);
        const rejectionReasons: string[] = [];

        if (!bestCandidate) {
          rejectionReasons.push('No compatible registered student profile could be compared');
        } else {
          if (!hasStrictSimilarity) {
            rejectionReasons.push(`Similarity ${(bestCandidate.similarity * 100).toFixed(1)}% is below ${(PHOTO_RECOGNITION_STRICT_COSINE_THRESHOLD * 100).toFixed(1)}%`);
          }

          if (!hasStrictDistance) {
            rejectionReasons.push(`Distance ${bestCandidate.distance.toFixed(3)} is above ${PHOTO_RECOGNITION_STRICT_DISTANCE_THRESHOLD.toFixed(2)}`);
          }

          if (!hasClearSeparation && secondCandidate) {
            rejectionReasons.push(`Too close to ${secondCandidate.name} (${(secondCandidate.similarity * 100).toFixed(1)}%)`);
          }
        }

        return {
          faceNumber: index + 1,
          accepted,
          reason: accepted ? 'Passed strict recognition rules' : rejectionReasons.join(' | '),
          bestCandidate,
          secondCandidate,
          descriptor: detection.descriptor,
          detection: detection.detection
        };
      });

      const bestAcceptedByLabel = new Map<string, (typeof analyzedDetections)[number]>();
      analyzedDetections.forEach(analysis => {
        if (!analysis.accepted || !analysis.bestCandidate) return;

        const existing = bestAcceptedByLabel.get(analysis.bestCandidate.label);
        if (!existing || analysis.bestCandidate.similarity > existing.bestCandidate!.similarity) {
          bestAcceptedByLabel.set(analysis.bestCandidate.label, analysis);
        }
      });

      const acceptedFaceNumbers = new Set(
        Array.from(bestAcceptedByLabel.values()).map(analysis => analysis.faceNumber)
      );
      const debugRecords: PhotoAttendanceDebugRecord[] = analyzedDetections.map(analysis => {
        const accepted = analysis.accepted && acceptedFaceNumbers.has(analysis.faceNumber);
        return {
          faceNumber: analysis.faceNumber,
          accepted,
          reason: accepted
            ? analysis.reason
            : analysis.accepted && analysis.bestCandidate
              ? `Ignored duplicate weaker match for ${analysis.bestCandidate.name}`
              : analysis.reason,
          bestCandidate: analysis.bestCandidate,
          secondCandidate: analysis.secondCandidate
        };
      });
      const strictMatches = Array.from(bestAcceptedByLabel.values()).map(analysis => ({
        label: analysis.bestCandidate!.label,
        similarity: analysis.bestCandidate!.similarity,
        descriptor: analysis.descriptor,
        detection: analysis.detection
      }));

      const matchByStudentId = new Map(strictMatches.map(match => [match.label, match] as const));
      const results: PhotoAttendanceRecord[] = photoAttendanceStudents.map(student => {
        const match = matchByStudentId.get(student.id);
        return {
          student,
          attendance: match ? 'Present' : 'Absent',
          similarity: match?.similarity
        };
      });

      const presentCount = results.filter(record => record.attendance === 'Present').length;
      const absentCount = results.length - presentCount;
      const rejectedDetectionCount = debugRecords.filter(record => !record.accepted).length;
      const summary: PhotoAttendanceSummary = {
        totalStudents: results.length,
        presentCount,
        absentCount,
        matchedStudentCount: strictMatches.length,
        detectedFaceCount: detections.length,
        rejectedDetectionCount
      };

      setPhotoAttendanceResults(results);
      setPhotoAttendanceSummary(summary);
      setPhotoAttendanceDebugRecords(debugRecords);
      setPhotoAttendanceStatus(
        presentCount > 0
          ? `Photo scan completed for ${photoAttendanceSubject || `${photoAttendanceDepartment} ${formatBatchLabel(Number(photoAttendanceYear))}`}. ${presentCount} registered student${presentCount === 1 ? '' : 's'} matched.${rejectedDetectionCount > 0 ? ` ${rejectedDetectionCount} detected face${rejectedDetectionCount === 1 ? '' : 's'} moved to low-confidence debug.` : ''} All non-registered faces were ignored.`
          : detections.length === 0
            ? 'Photo scan completed, but face-api did not detect any faces in this image. Try a sharper upright photo or crop closer to the group.'
            : rejectedDetectionCount > 0
              ? 'Photo scan completed. Faces were detected, but strict recognition rejected them. Check the low-confidence debug panel for similarity scores.'
              : 'Photo scan completed, but no registered students were matched in that image. All non-registered faces were ignored.'
      );
    } catch (error) {
      console.error('Group photo attendance scan failed:', error);
      setPhotoAttendanceStatus('Photo attendance scan failed. Try a clearer image with visible front-facing faces.');
    } finally {
      setPhotoAttendanceProcessing(false);
    }
  };

  const handleExportPhotoAttendanceCSV = () => {
    if (photoAttendanceResults.length === 0) return;

    const headers = ['Student ID', 'Register Number', 'Name', 'Department', 'Batch', 'Subject', 'Attendance', 'Match Confidence'];
    const rows = photoAttendanceResults.map(record => [
      record.student.id,
      record.student.registerNumber,
      `"${record.student.name}"`,
      `"${record.student.department}"`,
      record.student.enrollmentYear,
      `"${photoAttendanceSubject || 'Group Photo Scan'}"`,
      record.attendance,
      record.similarity ? `${(record.similarity * 100).toFixed(1)}%` : 'N/A'
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    downloadCSV(
      csvContent,
      `group_photo_attendance_${(photoAttendanceSubject || photoAttendanceDepartment || 'scan').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    );
  };

  const handleExportCSV = () => {
    const headers = ["Student ID", "Register Number", "Name", "Department", "Status", "Verification Time"];
    const rows = currentClassStudents.map(s => {
      const record = presenceData[s.id];
      const isPresent = hasContinuousPresenceByCheckpoint(
        record,
        activeCheckpointConfig.checkpointCount,
        activeCheckpointConfig.currentCheckpointIndex
      );
      const time = record?.timestamps.filter(Boolean).slice(-1)[0] || "N/A";
      return [s.id, s.registerNumber, `"${s.name}"`, `"${s.department}"`, isPresent ? "Present" : "Absent", time];
    });

    const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    downloadCSV(csvContent, `attendance_${activeClass?.subject || 'session'}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const handleExportHistoryCSV = () => {
    const headers = ["Record ID", "Date", "Name", "Register Number", "Subject", "Department", "Attendance", "Verified Checkpoints", "Verification Timeline", "Session Time"];
    const rows = filteredHistory.map(h => [
      h.id,
      h.date,
      `"${h.name}"`,
      h.registerNumber,
      `"${h.subject}"`,
      `"${h.department}"`,
      h.attendance,
      `${h.verifiedCheckpointCount}/${h.requiredCheckpointCount}`,
      `"${formatHistoryVerificationTimeline(h)}"`,
      `"${h.startTime && h.endTime ? `${formatTo12HourTime(h.startTime)} - ${formatTo12HourTime(h.endTime)}` : 'N/A'}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    downloadCSV(csvContent, `history_export_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const handleClearHistory = () => {
    setConfirmClearHistory(true);
  };

  const confirmClearHistoryVault = () => {
    setHistory([]);
    localStorage.removeItem('insight_history');
    setConfirmClearHistory(false);
  };

  const handleAddClass = () => {
    if (!newClass.subject || !newClass.department || !newClass.startTime || !newClass.endTime || !newClass.enrollmentYear) return;
    const resolvedDayOfWeek = newClass.calendarDate
      ? getDayOfWeekFromDate(newClass.calendarDate)
      : (newClass.dayOfWeek || 'Monday');

    const entry: TimetableEntry = {
      id: `T${Date.now()}`,
      subject: newClass.subject,
      department: newClass.department,
      enrollmentYear: newClass.enrollmentYear,
      startTime: newClass.startTime,
      endTime: newClass.endTime,
      dayOfWeek: resolvedDayOfWeek,
      calendarDate: newClass.calendarDate || undefined
    };
    const updated = [...timetable, entry];
    setTimetable(updated);
    localStorage.setItem('insight_timetable', JSON.stringify(updated));
    setNewClass({ dayOfWeek: 'Monday', calendarDate: '' });
    setClassPeriodMinutes('60');
    setStartHour12('09');
    setStartMinute('00');
    setStartMeridiem('AM');
    setShowAddClass(false);
  };

  const handleDeleteClass = (id: string) => {
    const updated = timetable.filter(t => t.id !== id);
    setTimetable(updated);
    localStorage.setItem('insight_timetable', JSON.stringify(updated));
  };

  const confirmDeleteStudent = async () => {
    if (!studentToDelete) return;
    await sqliteService.deleteStudentById(studentToDelete.id);
    const updated = await sqliteService.getStudents();
    setStudents(updated);
    setStudentToDelete(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col font-sans text-slate-900 dark:text-slate-100 overflow-x-hidden transition-colors duration-500">
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-white/5 px-6 lg:px-12 py-4 flex items-center justify-between transition-colors">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
            <i className="fa-solid fa-face-viewfinder text-white"></i>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-black tracking-tighter uppercase text-slate-900 dark:text-white">InsightScan <span className="text-cyan-500">Admin</span></h1>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{adminName}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-white/5 transition-colors">
           <button onClick={() => setActiveTab('monitoring')} className={`px-4 lg:px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === 'monitoring' ? 'bg-white dark:bg-slate-800 text-cyan-600 dark:text-cyan-400 shadow-md' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>Monitoring</button>
           <button onClick={() => setActiveTab('schedule')} className={`px-4 lg:px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === 'schedule' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-md' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>Schedule</button>
           <button onClick={() => setActiveTab('students')} className={`px-4 lg:px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === 'students' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-md' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>Identities</button>
        </div>

        <div className="flex items-center space-x-4">
          <button 
            onClick={onToggleTheme}
            className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-cyan-400 flex items-center justify-center hover:scale-105 active:scale-95 transition-all border border-slate-200 dark:border-white/5 shadow-sm"
          >
            <i className={`fa-solid ${currentTheme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
          </button>
          <button onClick={onLogout} className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            Sign Out
          </button>
        </div>
      </nav>

      <main className={`flex-1 mx-auto w-full ${activeTab === 'monitoring' && (monitoringSubTab === 'live' || monitoringSubTab === 'photo') ? 'p-4 lg:p-6 max-w-[1920px]' : 'p-6 lg:p-12 max-w-[1600px]'}`}>
        {activeTab === 'monitoring' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
               <div>
                  <h2 className="text-3xl font-black tracking-tight mb-2 text-slate-900 dark:text-white">System Monitoring</h2>
                  <div className="flex items-center space-x-3">
                    <button onClick={() => setMonitoringSubTab('live')} className={`text-[10px] font-black uppercase tracking-[0.2em] pb-1 border-b-2 transition-all ${monitoringSubTab === 'live' ? 'text-cyan-600 dark:text-cyan-400 border-cyan-600 dark:border-cyan-400' : 'text-slate-400 dark:text-slate-600 border-transparent hover:text-slate-600 dark:hover:text-slate-400'}`}>Live Session</button>
                    <button onClick={() => setMonitoringSubTab('photo')} className={`text-[10px] font-black uppercase tracking-[0.2em] pb-1 border-b-2 transition-all ${monitoringSubTab === 'photo' ? 'text-cyan-600 dark:text-cyan-400 border-cyan-600 dark:border-cyan-400' : 'text-slate-400 dark:text-slate-600 border-transparent hover:text-slate-600 dark:hover:text-slate-400'}`}>Group Photo</button>
                    <button onClick={() => setMonitoringSubTab('history')} className={`text-[10px] font-black uppercase tracking-[0.2em] pb-1 border-b-2 transition-all ${monitoringSubTab === 'history' ? 'text-cyan-600 dark:text-cyan-400 border-cyan-600 dark:border-cyan-400' : 'text-slate-400 dark:text-slate-600 border-transparent hover:text-slate-600 dark:hover:text-slate-400'}`}>History Vault</button>
                  </div>
               </div>

                {monitoringSubTab === 'live' && (
                 <div className="flex flex-wrap items-center gap-3">
                   <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-sm">
                     <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Camera</span>
                     <select
                       value={liveCameraSource}
                       onChange={(e) => setLiveCameraSource(e.target.value)}
                       className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white outline-none"
                     >
                       <option value={LIVE_CAMERA_SOURCE_WEBCAM}>Laptop Webcam Default</option>
                       <option value={LIVE_CAMERA_SOURCE_DROIDCAM}>DroidCam Phone</option>
                       {liveVideoDevices.length > 0 && (
                         <option disabled value="">Detected Devices</option>
                       )}
                       {liveVideoDevices.map((device, index) => (
                         <option key={device.deviceId || `${device.kind}-${index}`} value={`${LIVE_CAMERA_DEVICE_PREFIX}${device.deviceId}`}>
                           {formatLiveCameraDeviceLabel(device, index)}
                         </option>
                       ))}
                     </select>
                   </div>
                   <button
                     onClick={() => void refreshLiveCameraDevices()}
                     className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-sm"
                   >
                     Refresh Cameras
                   </button>
                   <span className="px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                     Pending: {pendingRecognitionCandidates.length}
                   </span>
                   <span className="px-4 py-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest">
                     Scan: {liveScanIntervalMs}ms
                   </span>
                   <span className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-widest">
                     Checkpoint: {activeCheckpointConfig.currentCheckpointLabel} {activeCheckpointConfig.currentCheckpointNumber}/{activeCheckpointConfig.checkpointCount || ATTENDANCE_CHECKPOINT_COUNT}
                   </span>
                    <button onClick={handleExportCSV} disabled={!activeClass} className="px-6 py-3 bg-cyan-600 dark:bg-cyan-500 text-white dark:text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-cyan-500/10 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                      Export Session .CSV
                    </button>
                    <button
                      onClick={handleGenerateAIReport}
                      disabled={!activeClass || attendanceStats.total === 0 || isGeneratingReport}
                      className="px-6 py-3 bg-slate-950 dark:bg-white text-white dark:text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeneratingReport ? 'Generating AI...' : 'Generate AI Summary'}
                    </button>
                  </div>
                )}

                {monitoringSubTab === 'photo' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="px-4 py-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 text-[10px] font-black uppercase tracking-widest">
                      Engine: {faceRecognitionService.getEngineLabel(PHOTO_ATTENDANCE_ENGINE)}
                    </span>
                    <button
                      onClick={handleAnalyzePhotoAttendance}
                      disabled={!photoAttendanceImageUrl || !photoAttendanceDepartment || !photoAttendanceYear || photoAttendanceProcessing}
                      className="px-6 py-3 bg-cyan-600 dark:bg-cyan-500 text-white dark:text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-cyan-500/10 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {photoAttendanceProcessing ? 'Scanning...' : 'Scan Group Photo'}
                    </button>
                    <button
                      onClick={handleExportPhotoAttendanceCSV}
                      disabled={photoAttendanceResults.length === 0}
                      className="px-6 py-3 bg-white dark:bg-slate-800 text-slate-600 dark:text-white border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Export Photo Report
                    </button>
                  </div>
                )}
             </div>

            {monitoringSubTab === 'live' ? (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-5 space-y-6">
                   <div className="bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-white/5 rounded-[2.5rem] p-4 lg:p-5 relative overflow-hidden aspect-[16/10] min-h-[340px] lg:min-h-[460px] shadow-inner transition-colors">
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className={`w-full h-full object-cover rounded-[2rem] transition-opacity duration-500 ${isLiveCameraReady && !liveCameraError ? 'opacity-100 grayscale brightness-90 dark:brightness-75' : 'opacity-0'}`}
                      />
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                         {!activeClass ? (
                           <div className="max-w-sm px-8 py-6 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-[2rem] shadow-lg text-center">
                              <i className="fa-solid fa-calendar-check text-cyan-600 dark:text-cyan-400 text-2xl mb-4"></i>
                              <p className="text-[10px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-widest mb-2">Waiting For Scheduled Class</p>
                              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                                The live camera arms automatically when the current time enters a scheduled class window.
                              </p>
                           </div>
                         ) : liveCameraError ? (
                           <div className="max-w-sm px-8 py-6 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border border-rose-200 dark:border-rose-500/20 rounded-[2rem] shadow-lg text-center">
                              <i className="fa-solid fa-camera-slash text-rose-500 text-2xl mb-4"></i>
                              <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2">Live Camera Unavailable</p>
                              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                                {liveCameraError}
                              </p>
                           </div>
                         ) : !isLiveCameraReady ? (
                           <>
                             <div className="w-56 h-56 border-2 border-cyan-500/30 rounded-full animate-pulse"></div>
                             <div className="absolute bottom-8 px-6 py-2 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border border-slate-200 dark:border-cyan-500/30 rounded-xl shadow-lg">
                                <p className="text-[9px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-widest animate-pulse">Connecting Classroom Camera...</p>
                             </div>
                           </>
                         ) : (
                           <>
                             <div className="w-56 h-56 border-2 border-cyan-500/30 rounded-full animate-pulse"></div>
                             <div className="absolute bottom-8 px-6 py-2 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border border-slate-200 dark:border-cyan-500/30 rounded-xl shadow-lg">
                                <p className="text-[9px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-widest animate-pulse">Scanning Bio-Grid...</p>
                             </div>
                           </>
                         )}
                      </div>
                   </div>

                   <div className="bg-gradient-to-br from-indigo-50 dark:from-indigo-600/20 to-blue-50 dark:to-blue-600/10 border border-slate-200 dark:border-white/10 p-8 rounded-[2.5rem] shadow-sm transition-colors">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-4">High-Capacity Recognition</h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium mb-6">
                        Attendance is checked in 3 class-timed phases: beginning, middle, and end. A student is marked present only when that registered face is confirmed live in the current phase. Missing any phase marks the student absent.
                      </p>
                      <div className="mb-5 px-4 py-3 rounded-2xl bg-white/70 dark:bg-slate-950/30 border border-white/70 dark:border-white/5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">Active Live Camera</p>
                        <p className="text-xs font-black text-slate-700 dark:text-white">{activeLiveCameraLabel}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-[10px] font-black uppercase tracking-wider">
                        <div className="px-3 py-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                          Pending: {pendingRecognitionCandidates.length}
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                          Scan: {liveScanIntervalMs}ms
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
                          Stage: {activeCheckpointConfig.currentCheckpointLabel}
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                          {activeCheckpointConfig.currentCheckpointNumber}/{activeCheckpointConfig.checkpointCount || ATTENDANCE_CHECKPOINT_COUNT} phases
                        </div>
                      </div>
                   </div>
                </div>

                <div className="xl:col-span-7 space-y-6">
                   <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label: 'Enrolled', value: attendanceStats.total, icon: 'fa-users', color: 'text-blue-500 dark:text-blue-400' },
                        { label: 'Present', value: attendanceStats.present, icon: 'fa-check-double', color: 'text-emerald-500 dark:text-emerald-400' },
                        { label: 'Absent', value: attendanceStats.absent, icon: 'fa-user-slash', color: 'text-rose-500 dark:text-rose-400' },
                        { label: 'Attendance', value: `${attendanceStats.percentage}%`, icon: 'fa-chart-pie', color: 'text-amber-500 dark:text-amber-400' },
                      ].map((stat, i) => (
                        <div key={i} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 p-5 rounded-[2rem] flex flex-col justify-between shadow-sm transition-colors">
                           <i className={`fa-solid ${stat.icon} ${stat.color} text-xl mb-4`}></i>
                           <div>
                             <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">{stat.label}</p>
                             <p className="text-2xl font-black text-slate-900 dark:text-white">{stat.value}</p>
                           </div>
                        </div>
                      ))}
                   </div>

                   <div className="bg-gradient-to-br from-slate-950 to-cyan-950 dark:from-cyan-500/10 dark:to-blue-500/10 border border-slate-800 dark:border-cyan-500/10 rounded-[2.5rem] p-6 shadow-sm transition-colors">
                     <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                       <div>
                         <p className="text-[9px] font-black uppercase tracking-[0.25em] text-cyan-300 dark:text-cyan-400">Gemini AI Report</p>
                         <h3 className="mt-2 text-xl font-black tracking-tight text-white">Attendance Insight Summary</h3>
                       </div>
                       <button
                         onClick={handleGenerateAIReport}
                         disabled={!activeClass || attendanceStats.total === 0 || isGeneratingReport}
                         className="px-5 py-3 rounded-2xl bg-white text-slate-950 dark:bg-cyan-500 dark:text-slate-950 text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                         {isGeneratingReport ? 'Generating...' : 'Generate Report'}
                       </button>
                     </div>
                     <div className="mt-5 rounded-2xl bg-white/10 dark:bg-slate-950/40 border border-white/10 dark:border-white/5 px-5 py-4">
                       <p className="text-xs font-medium leading-relaxed text-slate-100 dark:text-slate-300">
                         {isGeneratingReport
                           ? 'Gemini is analyzing the current class attendance...'
                           : aiReport || 'Click Generate Report to create the 3-sentence AI attendance summary for the active scheduled class.'}
                       </p>
                     </div>
                   </div>

                   <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                      <div className="px-6 py-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/30">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Class Roll Call</h3>
                         {activeClass && (
                           <span className="px-3 py-1 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-full text-[9px] font-black uppercase tracking-tighter">
                             {activeClass.subject} - {formatTo12HourTime(activeClass.startTime)} - {formatTo12HourTime(activeClass.endTime)} - {formatBatchLabel(activeClass.enrollmentYear)}
                           </span>
                         )}
                      </div>
                      <div className="overflow-auto max-h-[68vh]">
                        <table className="w-full text-left">
                          <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-950/95 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5 backdrop-blur-sm">
                            <tr>
                              <th className="px-6 py-4">Identity</th>
                              <th className="px-6 py-4">Register No</th>
                              <th className="px-6 py-4">Status</th>
                              <th className="px-6 py-4">Verification</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                            {currentClassStudents.length > 0 ? currentClassStudents.map(student => {
                              const record = presenceData[student.id];
                              const checks = getNormalizedChecks(record, activeCheckpointConfig.checkpointCount);
                              const currentIdx = activeCheckpointConfig.currentCheckpointIndex;
                              const clearedSoFar = checks.slice(0, currentIdx + 1).filter(Boolean).length;
                              const isOnTrack = hasContinuousPresenceByCheckpoint(
                                record,
                                activeCheckpointConfig.checkpointCount,
                                currentIdx
                              );
                              const latestTimestamp = record?.timestamps.filter(Boolean).slice(-1)[0] || '--:--:--';

                              return (
                                <tr key={student.id} className={`group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors ${lastDetectedId === student.id ? 'bg-cyan-500/5' : ''}`}>
                                  <td className="px-6 py-3.5">
                                    <div className="flex items-center space-x-4">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-black ${isOnTrack ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
                                        {student.name.charAt(0)}
                                      </div>
                                      <div>
                                        <p className="text-xs font-bold text-slate-800 dark:text-white">{student.name}</p>
                                        <p className="text-[9px] font-black uppercase tracking-tighter text-slate-400 dark:text-slate-600">{student.id}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                    {student.registerNumber}
                                  </td>
                                  <td className="px-6 py-3.5">
                                    <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full ${isOnTrack ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-500'}`}>
                                      <div className={`w-1.5 h-1.5 rounded-full ${isOnTrack ? 'bg-emerald-600 animate-pulse' : 'bg-rose-600'}`}></div>
                                      <span className="text-[9px] font-black uppercase tracking-widest">{isOnTrack ? 'Present' : 'Absent'}</span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                                    {clearedSoFar}/{activeCheckpointConfig.checkpointCount || ATTENDANCE_CHECKPOINT_COUNT} checkpoints | {latestTimestamp}
                                  </td>
                                </tr>
                              );
                            }) : (
                              <tr>
                                <td colSpan={4} className="px-8 py-12 text-center">
                                  <div className="flex flex-col items-center opacity-40">
                                    <i className="fa-solid fa-radar text-4xl mb-4 text-slate-300 dark:text-slate-700"></i>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">No active class detected for your scheduled department and batch</p>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                   </div>
                </div>
              </div>
            ) : monitoringSubTab === 'photo' ? (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-5 space-y-6">
                  <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] p-6 shadow-sm transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">Separate Attendance Mode</p>
                        <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">Group Photo Recognition</h3>
                        <p className="mt-3 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                          Upload a high-resolution classroom image. The scanner checks upright and rotated orientations, then matches only registered students for the selected department and batch.
                        </p>
                      </div>
                      <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                        <i className="fa-solid fa-users-viewfinder text-lg"></i>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Subject Label</p>
                        <input
                          type="text"
                          value={photoAttendanceSubject}
                          onChange={(e) => setPhotoAttendanceSubject(e.target.value)}
                          placeholder={activeClass?.subject || 'e.g. Computer Networks'}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold focus:ring-1 focus:ring-cyan-500/30 outline-none text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Department</p>
                        <select
                          value={photoAttendanceDepartment}
                          onChange={(e) => setPhotoAttendanceDepartment(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                        >
                          <option value="">Select Department</option>
                          {DEPARTMENTS.map(department => (
                            <option key={department} value={department}>{department}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Batch</p>
                        <select
                          value={photoAttendanceYear}
                          onChange={(e) => setPhotoAttendanceYear(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                        >
                          <option value="">Select Batch</option>
                          {ENROLLMENT_YEARS.map(year => (
                            <option key={year} value={year.toString()}>{formatBatchLabel(year)}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-end">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Group Photo</p>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoAttendanceImageUpload}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-500/10 file:px-3 file:py-2 file:text-[10px] file:font-black file:uppercase file:tracking-widest file:text-cyan-600 dark:file:text-cyan-400"
                        />
                      </div>
                      <button
                        onClick={handleAnalyzePhotoAttendance}
                        disabled={!photoAttendanceImageUrl || !photoAttendanceDepartment || !photoAttendanceYear || photoAttendanceProcessing}
                        className="px-6 py-4 bg-cyan-600 dark:bg-cyan-500 text-white dark:text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-cyan-500/10 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {photoAttendanceProcessing ? 'Scanning...' : 'Run Scan'}
                      </button>
                    </div>

                    <div className="mt-5 rounded-2xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-950/60 px-5 py-4">
                      <div className="flex flex-wrap items-center gap-3 text-[10px] font-black uppercase tracking-widest">
                        <span className="px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                          {photoAttendanceImageName || 'No photo selected'}
                        </span>
                        <span className="px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                          Registered Face Profiles: {photoAttendanceBiometricStats.faceApiReady}
                        </span>
                        {photoAttendanceBiometricStats.disabledCount > 0 && (
                          <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            Disabled InsightFace: {photoAttendanceBiometricStats.disabledCount}
                          </span>
                        )}
                        <span className="px-3 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                          Department: {photoAttendanceDepartment || 'Not set'}
                        </span>
                        <span className="px-3 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                          Batch: {photoAttendanceYear ? formatBatchLabel(Number(photoAttendanceYear)) : 'Not set'}
                        </span>
                      </div>
                      <p className="mt-3 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                        {photoAttendanceStatus}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-white/5 rounded-[2.5rem] p-4 lg:p-5 relative overflow-hidden min-h-[360px] lg:min-h-[460px] shadow-inner transition-colors">
                    {photoAttendanceImageUrl ? (
                      <img
                        ref={photoAttendanceImageRef}
                        src={photoAttendanceImageUrl}
                        alt="Uploaded classroom group"
                        onLoad={() => {
                          setPhotoAttendanceImageReady(true);
                          setPhotoAttendanceStatus(prev =>
                            prev.startsWith('Loaded') ? `${photoAttendanceImageName || 'Image'} preview is ready. Start the scan when you want.` : prev
                          );
                        }}
                        className="w-full h-full object-contain rounded-[2rem] bg-slate-950/30"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center">
                        <div className="w-20 h-20 rounded-3xl bg-white/60 dark:bg-slate-800/70 flex items-center justify-center mb-6">
                          <i className="fa-solid fa-image text-2xl text-cyan-600 dark:text-cyan-400"></i>
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">Upload Classroom Photo</p>
                        <p className="mt-4 max-w-sm text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                          For 30+ students, use a high-resolution landscape photo with upright, front-facing, evenly lit faces. Keep everyone close enough that each face is clear; non-registered faces are ignored.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="xl:col-span-7 space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { label: 'Registered Students', value: photoAttendanceSnapshot.totalStudents, icon: 'fa-users', color: 'text-blue-500 dark:text-blue-400' },
                      { label: 'Present', value: photoAttendanceSnapshot.presentCount, icon: 'fa-check-double', color: 'text-emerald-500 dark:text-emerald-400' },
                      { label: 'Absent', value: photoAttendanceSnapshot.absentCount, icon: 'fa-user-slash', color: 'text-rose-500 dark:text-rose-400' },
                      { label: 'Matched Students', value: photoAttendanceSnapshot.matchedStudentCount, icon: 'fa-user-check', color: 'text-indigo-500 dark:text-indigo-400' },
                      { label: 'Faces Detected', value: photoAttendanceSnapshot.detectedFaceCount, icon: 'fa-camera-retro', color: 'text-cyan-500 dark:text-cyan-400' },
                      { label: 'Debug Rejected', value: photoAttendanceSnapshot.rejectedDetectionCount, icon: 'fa-triangle-exclamation', color: 'text-amber-500 dark:text-amber-400' }
                    ].map(stat => (
                      <div key={stat.label} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 p-5 rounded-[2rem] flex flex-col justify-between shadow-sm transition-colors">
                        <i className={`fa-solid ${stat.icon} ${stat.color} text-xl mb-4`}></i>
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">{stat.label}</p>
                          <p className="text-2xl font-black text-slate-900 dark:text-white">{stat.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {photoAttendanceResults.length > 0 && (
                    <div className="bg-white dark:bg-slate-900/50 border border-amber-200 dark:border-amber-500/10 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                      <div className="px-6 py-5 border-b border-amber-100 dark:border-amber-500/10 flex flex-wrap items-center justify-between gap-3 bg-amber-50/70 dark:bg-amber-500/5">
                        <div>
                          <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Low-Confidence Debug</h3>
                          <p className="mt-1 text-[10px] font-bold text-amber-700/70 dark:text-amber-200/60">
                            Debug only: rejected rows are not marked present.
                          </p>
                        </div>
                        <span className="px-3 py-1 rounded-full bg-white/80 dark:bg-slate-950/50 text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                          {photoAttendanceSnapshot.detectedFaceCount} detected / {photoAttendanceSnapshot.rejectedDetectionCount} rejected
                        </span>
                      </div>

                      {photoAttendanceSnapshot.detectedFaceCount === 0 ? (
                        <div className="px-6 py-8 text-xs font-bold leading-relaxed text-slate-500 dark:text-slate-400">
                          No faces were detected by face-api in this image. Try a sharper photo, rotate it upright, or crop closer to the group.
                        </div>
                      ) : rejectedPhotoAttendanceDebugRecords.length > 0 ? (
                        <div className="overflow-auto max-h-72">
                          <table className="w-full text-left">
                            <thead className="sticky top-0 z-10 bg-amber-50/95 dark:bg-slate-950/95 text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 border-b border-amber-100 dark:border-amber-500/10">
                              <tr>
                                <th className="px-6 py-4">Face</th>
                                <th className="px-6 py-4">Best Registered Match</th>
                                <th className="px-6 py-4">Similarity</th>
                                <th className="px-6 py-4">Distance</th>
                                <th className="px-6 py-4">Second Best</th>
                                <th className="px-6 py-4">Why Ignored</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-100/70 dark:divide-white/5">
                              {rejectedPhotoAttendanceDebugRecords.map(record => (
                                <tr key={record.faceNumber} className="hover:bg-amber-50/40 dark:hover:bg-white/[0.02] transition-colors">
                                  <td className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                    Face #{record.faceNumber}
                                  </td>
                                  <td className="px-6 py-3.5">
                                    {record.bestCandidate ? (
                                      <div>
                                        <p className="text-xs font-bold text-slate-800 dark:text-white">{record.bestCandidate.name}</p>
                                        <p className="text-[9px] font-black uppercase tracking-tighter text-slate-400 dark:text-slate-600">{record.bestCandidate.registerNumber}</p>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] font-bold text-slate-400">No candidate</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-3.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                    {record.bestCandidate ? `${(record.bestCandidate.similarity * 100).toFixed(1)}%` : '--'}
                                  </td>
                                  <td className="px-6 py-3.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                    {record.bestCandidate ? record.bestCandidate.distance.toFixed(3) : '--'}
                                  </td>
                                  <td className="px-6 py-3.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                    {record.secondCandidate
                                      ? `${record.secondCandidate.name} ${(record.secondCandidate.similarity * 100).toFixed(1)}%`
                                      : '--'}
                                  </td>
                                  <td className="px-6 py-3.5 text-[10px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">
                                    {record.reason || 'Rejected by strict recognition rules'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="px-6 py-8 text-xs font-bold leading-relaxed text-slate-500 dark:text-slate-400">
                          No low-confidence rows. Every detected registered match passed the strict checks.
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                    <div className="px-6 py-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/30">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Photo Attendance Report</h3>
                      <span className="px-3 py-1 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-full text-[9px] font-black uppercase tracking-tighter">
                        {photoAttendanceSubject || activeClass?.subject || 'Group Photo'} - {photoAttendanceDepartment || 'Select Department'} - {photoAttendanceYear ? formatBatchLabel(Number(photoAttendanceYear)) : 'Select Batch'}
                      </span>
                    </div>
                    <div className="overflow-auto max-h-[68vh]">
                      <table className="w-full text-left">
                        <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-950/95 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5 backdrop-blur-sm">
                          <tr>
                            <th className="px-6 py-4">Identity</th>
                            <th className="px-6 py-4">Register No</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Match Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {photoAttendanceResults.length > 0 ? photoAttendanceResults.map(record => (
                            <tr key={record.student.id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                              <td className="px-6 py-3.5">
                                <div className="flex items-center space-x-4">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-black ${record.attendance === 'Present' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
                                    {record.student.name.charAt(0)}
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-slate-800 dark:text-white">{record.student.name}</p>
                                    <p className="text-[9px] font-black uppercase tracking-tighter text-slate-400 dark:text-slate-600">{record.student.id}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                {record.student.registerNumber}
                              </td>
                              <td className="px-6 py-3.5">
                                <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full ${record.attendance === 'Present' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-500'}`}>
                                  <div className={`w-1.5 h-1.5 rounded-full ${record.attendance === 'Present' ? 'bg-emerald-600' : 'bg-rose-600'}`}></div>
                                  <span className="text-[9px] font-black uppercase tracking-widest">{record.attendance}</span>
                                </div>
                              </td>
                              <td className="px-6 py-3.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                                {record.similarity
                                  ? `Confidence ${(record.similarity * 100).toFixed(1)}%`
                                  : (record.student.faceDescription ? 'Not found in this photo' : 'No face profile enrolled')}
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={4} className="px-8 py-12 text-center">
                                <div className="flex flex-col items-center opacity-50">
                                  <i className="fa-solid fa-image-portrait text-4xl mb-4 text-slate-300 dark:text-slate-700"></i>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Run a scan to build the separate photo attendance report</p>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                 <div className="flex flex-wrap gap-4">
                    <input 
                       type="date" 
                       className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 px-4 py-3 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-400 outline-none focus:ring-1 focus:ring-cyan-500/30 transition-colors shadow-sm"
                       value={historyDateFilter}
                       onChange={(e) => setHistoryDateFilter(e.target.value)}
                    />
                    <input
                       type="text"
                       placeholder="Search subject"
                       value={historySubjectFilter}
                       className="min-w-[220px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 px-4 py-3 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-400 outline-none focus:ring-1 focus:ring-cyan-500/30 transition-colors shadow-sm"
                       onChange={(e) => setHistorySubjectFilter(e.target.value)}
                    />
                    <select 
                       value={historyDeptFilter}
                       className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 px-4 py-3 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-400 outline-none focus:ring-1 focus:ring-cyan-500/30 transition-colors shadow-sm"
                       onChange={(e) => setHistoryDeptFilter(e.target.value)}
                    >
                       <option value="all">All Departments</option>
                       {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                   </select>
                   <button onClick={handleExportHistoryCSV} className="ml-auto px-6 py-3 bg-white dark:bg-slate-800 text-slate-600 dark:text-white border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm">
                     Download Audit Log
                   </button>
                    <button onClick={handleClearHistory} className="px-6 py-3 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 shadow-xl shadow-red-500/10 transition-all active:scale-95">
                      Clear History Vault
                    </button>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { label: 'Filtered Records', value: historySummary.total, tone: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10' },
                      { label: 'Present', value: historySummary.present, tone: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
                      { label: 'Absent', value: historySummary.absent, tone: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' }
                    ].map(card => (
                      <div key={card.label} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2rem] p-5 shadow-sm transition-colors">
                         <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{card.label}</p>
                         <div className={`inline-flex items-center px-3 py-1 rounded-full ${card.bg} ${card.tone}`}>
                           <span className="text-xl font-black">{card.value}</span>
                         </div>
                      </div>
                    ))}
                 </div>

                 <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                         <thead className="bg-slate-50/50 dark:bg-slate-950/50 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                           <tr>
                              <th className="px-8 py-5">Record ID</th>
                              <th className="px-8 py-5">Date</th>
                              <th className="px-8 py-5">Session</th>
                              <th className="px-8 py-5">Name</th>
                              <th className="px-8 py-5">Register No</th>
                              <th className="px-8 py-5">Subject</th>
                              <th className="px-8 py-5">Department</th>
                              <th className="px-8 py-5">Attendance</th>
                              <th className="px-8 py-5">Verification Timeline</th>
                           </tr>
                         </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {filteredHistory.length > 0 ? filteredHistory.map(h => (
                            <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.01] transition-colors">
                              <td className="px-8 py-4 font-mono text-[10px] text-slate-400 dark:text-slate-500">{h.id}</td>
                              <td className="px-8 py-4 text-xs font-bold text-slate-800 dark:text-white">{h.date}</td>
                              <td className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                {h.startTime && h.endTime ? `${formatTo12HourTime(h.startTime)} - ${formatTo12HourTime(h.endTime)}` : '--'}
                              </td>
                              <td className="px-8 py-4 text-xs font-bold text-slate-800 dark:text-white">{h.name}</td>
                              <td className="px-8 py-4 text-[10px] text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest">{h.registerNumber}</td>
                              <td className="px-8 py-4 text-xs font-bold text-slate-800 dark:text-white">{h.subject}</td>
                              <td className="px-8 py-4 text-[10px] text-slate-400 dark:text-slate-400 font-bold uppercase">{h.department}</td>
                              <td className="px-8 py-4">
                                 <span className={`inline-flex items-center px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${h.attendance === 'Present' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                                   {h.attendance}
                                 </span>
                              </td>
                              <td className="px-8 py-4 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                <div className="space-y-1">
                                  <div>{formatHistoryVerificationTimeline(h)}</div>
                                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                    {h.verifiedCheckpointCount}/{h.requiredCheckpointCount} checkpoints
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={9} className="px-8 py-10 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600">
                                No attendance records found for selected filters
                              </td>
                            </tr>
                          )}
                        </tbody>
                     </table>
                   </div>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'schedule' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex items-end justify-between">
                <div>
                   <h2 className="text-3xl font-black tracking-tight mb-2 text-slate-900 dark:text-white">Schedule Management</h2>
                   <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600">Active Academic Calendar</p>
                </div>
                <button 
                  onClick={() => setShowAddClass(!showAddClass)}
                  className="px-6 py-3 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all flex items-center space-x-2 shadow-lg"
                >
                  <i className={`fa-solid ${showAddClass ? 'fa-xmark' : 'fa-plus'}`}></i>
                  <span>{showAddClass ? 'Cancel' : 'Add Session'}</span>
                </button>
             </div>

             {showAddClass && (
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-10 gap-4 bg-white dark:bg-slate-900/50 p-6 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm transition-colors animate-in slide-in-from-top-4">
                  <div className="lg:col-span-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Subject Name</p>
                    <input type="text" placeholder="e.g. Machine Learning" className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold focus:ring-1 focus:ring-emerald-500/30 outline-none text-slate-900 dark:text-white" value={newClass.subject || ''} onChange={e => setNewClass({...newClass, subject: e.target.value})} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Dept</p>
                    <select className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white" value={newClass.department || ''} onChange={e => setNewClass({...newClass, department: e.target.value})}>
                      <option value="">Select</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Batch</p>
                    <select
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                      value={newClass.enrollmentYear?.toString() || ''}
                      onChange={e => setNewClass({ ...newClass, enrollmentYear: e.target.value ? Number(e.target.value) : undefined })}
                    >
                      <option value="">Select Batch</option>
                      {ENROLLMENT_YEARS.map(year => <option key={year} value={year}>{formatBatchLabel(year)}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Date</p>
                    <input
                      type="date"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                      value={newClass.calendarDate || ''}
                      onChange={e => {
                        const calendarDate = e.target.value;
                        setNewClass({
                          ...newClass,
                          calendarDate,
                          dayOfWeek: calendarDate ? getDayOfWeekFromDate(calendarDate) : (newClass.dayOfWeek || 'Monday')
                        });
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Day</p>
                    <select
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white disabled:opacity-60"
                      value={newClass.dayOfWeek || 'Monday'}
                      onChange={e => setNewClass({...newClass, dayOfWeek: e.target.value})}
                      disabled={Boolean(newClass.calendarDate)}
                    >
                      {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Start (12h)</p>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                        value={startHour12}
                        onChange={e => setStartHour12(e.target.value)}
                      >
                        {HOUR_12_OPTIONS.map(hour => (
                          <option key={hour} value={hour}>{hour}</option>
                        ))}
                      </select>
                      <select
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                        value={startMinute}
                        onChange={e => setStartMinute(e.target.value)}
                      >
                        {MINUTE_OPTIONS.map(min => (
                          <option key={min} value={min}>{min}</option>
                        ))}
                      </select>
                      <select
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                        value={startMeridiem}
                        onChange={e => setStartMeridiem(e.target.value as 'AM' | 'PM')}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Period</p>
                    <select
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                      value={classPeriodMinutes}
                      onChange={e => setClassPeriodMinutes(e.target.value)}
                    >
                      {CLASS_PERIOD_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">End</p>
                    <input
                      type="text"
                      className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-100 dark:border-white/10 p-4 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300"
                      value={newClass.endTime ? formatTo12HourTime(newClass.endTime) : '--:--'}
                      readOnly
                    />
                  </div>
                  <div className="flex items-end">
                    <button onClick={handleAddClass} className="w-full py-4 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-slate-950 rounded-xl text-[10px] font-black uppercase tracking-widest">Register</button>
                  </div>
               </div>
             )}

             <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                <table className="w-full text-left">
                  <thead className="bg-slate-50/50 dark:bg-slate-950/50 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                    <tr>
                      <th className="px-8 py-5">Date</th>
                      <th className="px-8 py-5">Day</th>
                      <th className="px-8 py-5">Time Slot</th>
                      <th className="px-8 py-5">Session details</th>
                      <th className="px-8 py-5">Department</th>
                      <th className="px-8 py-5">Batch</th>
                      <th className="px-8 py-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {[...timetable]
                      .sort((a, b) => {
                        if (a.calendarDate && b.calendarDate && a.calendarDate !== b.calendarDate) {
                          return a.calendarDate.localeCompare(b.calendarDate);
                        }
                        if (a.calendarDate && !b.calendarDate) return -1;
                        if (!a.calendarDate && b.calendarDate) return 1;

                        const dayDiff = DAYS.indexOf(a.dayOfWeek || '') - DAYS.indexOf(b.dayOfWeek || '');
                        if (dayDiff !== 0) return dayDiff;
                        return (a.startTime || '').localeCompare(b.startTime || '');
                      })
                      .map(entry => (
                      <tr key={entry.id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.01] transition-colors">
                        <td className="px-8 py-5">
                          <span className={`text-[10px] font-black uppercase tracking-widest ${entry.calendarDate ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-500'}`}>
                            {entry.calendarDate || 'Recurring'}
                          </span>
                        </td>
                        <td className="px-8 py-5"><span className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase">{entry.dayOfWeek}</span></td>
                        <td className="px-8 py-5 font-mono text-[10px] text-slate-400 dark:text-slate-500">{formatTo12HourTime(entry.startTime)} - {formatTo12HourTime(entry.endTime)}</td>
                        <td className="px-8 py-5"><p className="text-xs font-bold text-slate-800 dark:text-white">{entry.subject}</p></td>
                        <td className="px-8 py-5"><span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{entry.department}</span></td>
                        <td className="px-8 py-5"><span className="text-[9px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-400">{formatBatchLabel(entry.enrollmentYear)}</span></td>
                        <td className="px-8 py-5 text-right"><button onClick={() => handleDeleteClass(entry.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors p-2"><i className="fa-solid fa-trash-can"></i></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex items-end justify-between">
                <div>
                   <h2 className="text-3xl font-black tracking-tight mb-2 text-slate-900 dark:text-white">Identity Vault</h2>
                   <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600">Secure Biometric Repository</p>
                </div>
                <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 outline-none shadow-sm">
                  <option value="all">All Batches ({students.length})</option>
                  {batchSummary.map(batch => (
                    <option key={batch.year} value={batch.year}>
                      Batch {batch.year} ({batch.total})
                    </option>
                  ))}
                </select>
             </div>

             <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6">
                <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] p-6 shadow-sm transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">Visible Student Count</p>
                      <h3 className="mt-3 text-4xl font-black tracking-tight text-slate-900 dark:text-white">{filteredStudents.length}</h3>
                      <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                        {selectedBatchLabel} across {departmentSummary.length} department{departmentSummary.length === 1 ? '' : 's'}.
                      </p>
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                      <i className="fa-solid fa-users text-lg"></i>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-100 dark:border-white/5 p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Current View</p>
                      <p className="mt-2 text-sm font-black text-slate-800 dark:text-white">{selectedBatchLabel}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-100 dark:border-white/5 p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Departments</p>
                      <p className="mt-2 text-sm font-black text-slate-800 dark:text-white">{departmentSummary.length}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-100 dark:border-white/5 p-4 col-span-2 md:col-span-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Overall Students</p>
                      <p className="mt-2 text-sm font-black text-slate-800 dark:text-white">{students.length}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] p-6 shadow-sm transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">Batch Strength</p>
                      <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">Students In Each Batch</h3>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{batchSummary.length} batches</span>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    {batchSummary.length > 0 ? batchSummary.map(batch => (
                      <div
                        key={batch.year}
                        className={`min-w-[130px] rounded-2xl border px-4 py-3 transition-colors ${
                          yearFilter === batch.year
                            ? 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300'
                            : 'border-slate-100 bg-slate-50 text-slate-700 dark:border-white/5 dark:bg-slate-950/70 dark:text-slate-300'
                        }`}
                      >
                        <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Batch {batch.year}</p>
                        <p className="mt-2 text-2xl font-black">{batch.total}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                          Student{batch.total === 1 ? '' : 's'}
                        </p>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 px-4 py-6 text-sm font-bold text-slate-400 dark:text-slate-500">
                        No batch records available yet.
                      </div>
                    )}
                  </div>
                </div>
             </div>

             <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] p-6 shadow-sm transition-colors">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">Department Totals</p>
                    <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">{selectedBatchLabel}</h3>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{filteredStudents.length} students</span>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  {departmentSummary.length > 0 ? departmentSummary.map(summary => (
                    <div key={summary.department} className="rounded-[1.75rem] bg-slate-50 dark:bg-slate-950/70 border border-slate-100 dark:border-white/5 p-5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Department</p>
                      <p className="mt-2 text-sm font-black leading-relaxed text-slate-800 dark:text-white">{summary.department}</p>
                      <p className="mt-4 text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">{summary.total}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        Student{summary.total === 1 ? '' : 's'}
                      </p>
                    </div>
                  )) : (
                    <div className="sm:col-span-2 xl:col-span-4 rounded-[1.75rem] border border-dashed border-slate-200 dark:border-white/10 px-5 py-8 text-sm font-bold text-slate-400 dark:text-slate-500">
                      No students found for the selected batch.
                    </div>
                  )}
                </div>
             </div>

             <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                <div className="overflow-x-auto">
                   <table className="w-full text-left">
                      <thead className="bg-slate-50/50 dark:bg-slate-950/50 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                        <tr>
                          <th className="px-8 py-5">S.No</th>
                          <th className="px-8 py-5">Student</th>
                          <th className="px-8 py-5">Biometrics</th>
                          <th className="px-8 py-5">Department</th>
                          <th className="px-8 py-5">Enrollment</th>
                          <th className="px-8 py-5">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {filteredStudents.length > 0 ? filteredStudents.map((student, index) => (
                          <tr key={student.id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                             <td className="px-8 py-5">
                                <span className="inline-flex min-w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-[10px] font-black text-slate-500 dark:text-slate-400">
                                  {index + 1}
                                </span>
                             </td>
                             <td className="px-8 py-5">
                                <div className="flex items-center space-x-4">
                                   <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-400 dark:text-slate-500">
                                      {student.name.split(' ').map(n => n[0]).join('')}
                                   </div>
                                   <div>
                                      <p className="text-xs font-bold text-slate-800 dark:text-white">{student.name}</p>
                                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-tighter">{student.email}</p>
                                      <p className="text-[10px] font-black text-cyan-600/80 dark:text-cyan-400/80 uppercase tracking-widest">Reg: {student.registerNumber}</p>
                                   </div>
                                </div>
                             </td>
                             <td className="px-8 py-5">
                                {student.faceDescription ? (
                                   <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
                                      <i className="fa-solid fa-fingerprint text-sm"></i>
                                      <span className="text-[9px] font-black uppercase tracking-widest">Secured</span>
                                   </div>
                                ) : (
                                   <div className="flex items-center space-x-2 text-slate-300 dark:text-slate-600">
                                      <i className="fa-solid fa-user-slash text-sm"></i>
                                      <span className="text-[9px] font-black uppercase tracking-widest">Missing Bio</span>
                                   </div>
                                )}
                             </td>
                             <td className="px-8 py-5"><span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400">{student.department}</span></td>
                             <td className="px-8 py-5 text-xs font-bold text-slate-500">Class of {student.enrollmentYear}</td>
                             <td className="px-8 py-5">
                                <button onClick={() => setStudentToDelete(student)} className="w-10 h-10 rounded-xl bg-red-500/5 dark:bg-red-500/10 hover:bg-red-600 text-red-600 hover:text-white transition-all flex items-center justify-center shadow-sm">
                                   <i className="fa-solid fa-trash-can text-sm"></i>
                                </button>
                             </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={6} className="px-8 py-12 text-center">
                              <p className="text-sm font-black text-slate-500 dark:text-slate-400">No student identities match the selected batch.</p>
                              <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-600">
                                Change the batch filter to see more records.
                              </p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                   </table>
                </div>
             </div>
          </div>
        )}
      </main>

      {studentToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setStudentToDelete(null)}></div>
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 duration-300">
             <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mb-8 mx-auto">
                <i className="fa-solid fa-triangle-exclamation text-red-500 text-3xl"></i>
             </div>
             <h3 className="text-2xl font-black text-center mb-4 tracking-tighter text-slate-900 dark:text-white">Purge Identity Record?</h3>
             <p className="text-slate-500 dark:text-slate-400 text-center text-sm mb-10 leading-relaxed font-medium">Permanently delete <span className="text-slate-900 dark:text-white font-bold">{studentToDelete.name}</span>'s record? This action cannot be undone.</p>
             <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setStudentToDelete(null)} className="py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">Cancel</button>
                <button onClick={confirmDeleteStudent} className="py-4 rounded-2xl bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-500 shadow-xl shadow-red-500/10 transition-all active:scale-95">Purge Record</button>
             </div>
          </div>
        </div>
      )}

      {confirmClearHistory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setConfirmClearHistory(false)}></div>
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 duration-300">
             <div className="w-20 h-20 bg-amber-500/10 rounded-3xl flex items-center justify-center mb-8 mx-auto">
                <i className="fa-solid fa-database text-amber-500 text-3xl"></i>
             </div>
             <h3 className="text-2xl font-black text-center mb-4 tracking-tighter text-slate-900 dark:text-white">Clear History Vault?</h3>
             <p className="text-slate-500 dark:text-slate-400 text-center text-sm mb-10 leading-relaxed font-medium">This will erase all attendance history records from this device’s vault. Action is restricted to the signed-in admin.</p>
             <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setConfirmClearHistory(false)} className="py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">Cancel</button>
                <button onClick={confirmClearHistoryVault} className="py-4 rounded-2xl bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-500 shadow-xl shadow-red-500/10 transition-all active:scale-95">Erase All</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
