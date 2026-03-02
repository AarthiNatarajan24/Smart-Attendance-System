import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Student, TimetableEntry} from '../types';
import { MOCK_TIMETABLE, DAYS, DEPARTMENTS } from '../constants';
import { faceRecognitionService } from '../services/faceRecognitionService';
import { geminiService } from '../services/geminiService';
import { sqliteService } from '../services/sqliteService';

interface DashboardProps {
  onLogout: () => void;
  adminName: string;
  currentTheme: 'light' | 'dark';
  onToggleTheme: () => void;
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
}

const CLASS_PERIOD_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '120 min', value: 120 },
];

const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
const CONTINUOUS_CHECK_INTERVAL_MINUTES = 15;

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

const Dashboard: React.FC<DashboardProps> = ({ onLogout, adminName, currentTheme, onToggleTheme }) => {
  const [activeTab, setActiveTab] = useState<'monitoring' | 'students' | 'schedule'>('monitoring');
  const [monitoringSubTab, setMonitoringSubTab] = useState<'live' | 'history'>('live');
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
      return parsed.filter(
        (record): record is HistoryRecord =>
          !!record &&
          typeof record.id === 'string' &&
          typeof record.classId === 'string' &&
          typeof record.studentId === 'string' &&
          typeof record.date === 'string' &&
          typeof record.name === 'string' &&
          typeof record.registerNumber === 'string' &&
          typeof record.subject === 'string' &&
          typeof record.department === 'string' &&
          (record.attendance === 'Present' || record.attendance === 'Absent')
      );
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

  const [newClass, setNewClass] = useState<Partial<TimetableEntry>>({ dayOfWeek: 'Monday' });
  const [classPeriodMinutes, setClassPeriodMinutes] = useState<string>('60');
  const [startHour12, setStartHour12] = useState<string>('09');
  const [startMinute, setStartMinute] = useState<string>('00');
  const [startMeridiem, setStartMeridiem] = useState<'AM' | 'PM'>('AM');
  const [showAddClass, setShowAddClass] = useState(false);

  const [historyDateFilter, setHistoryDateFilter] = useState<string>('');
  const [historyDeptFilter, setHistoryDeptFilter] = useState<string>('all');
  const [clockTick, setClockTick] = useState<number>(Date.now());

  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingCandidatesRef = useRef<{ label: string; descriptor: Float32Array }[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  const departmentDescriptors = useMemo(() => {
    if (!activeClass) return [];
    return students
      .filter(s => s.department === activeClass.department && s.faceDescription)
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
        intervalMinutes: CONTINUOUS_CHECK_INTERVAL_MINUTES
      };
    }

    const duration = classDurationMinutes(activeClass.startTime, activeClass.endTime);
    const startMinutes = toMinutesOfDay(activeClass.startTime);
    const now = new Date(clockTick);
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();

    const checkpointCount = Math.max(2, Math.ceil(duration / CONTINUOUS_CHECK_INTERVAL_MINUTES));

    if (startMinutes === null || duration <= 0) {
      return {
        checkpointCount,
        currentCheckpointIndex: 0,
        currentCheckpointNumber: 1,
        intervalMinutes: CONTINUOUS_CHECK_INTERVAL_MINUTES
      };
    }

    let elapsed = nowMinutes - startMinutes;
    if (elapsed < 0) elapsed += 1440;
    const clampedElapsed = Math.min(Math.max(elapsed, 0), duration);
    const currentCheckpointIndex = Math.min(
      checkpointCount - 1,
      Math.floor(clampedElapsed / CONTINUOUS_CHECK_INTERVAL_MINUTES)
    );

    return {
      checkpointCount,
      currentCheckpointIndex,
      currentCheckpointNumber: currentCheckpointIndex + 1,
      intervalMinutes: CONTINUOUS_CHECK_INTERVAL_MINUTES
    };
  }, [activeClass, clockTick]);

  const getNormalizedChecks = (record: PresenceRecord | undefined, checkpointCount: number): boolean[] =>
    Array.from({ length: checkpointCount }, (_, i) => Boolean(record?.checks?.[i]));

  const hasContinuousPresenceByCheckpoint = (record: PresenceRecord | undefined, checkpointCount: number, checkpointIndex: number): boolean => {
    if (checkpointCount <= 0) return false;
    const checks = getNormalizedChecks(record, checkpointCount);
    return checks.slice(0, checkpointIndex + 1).every(Boolean);
  };

  useEffect(() => {
    setPresenceData({});
    setLastDetectedId(null);
  }, [activeClass?.id]);

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
    let scanInterval: ReturnType<typeof setInterval> | null = null;
    let highlightTimeout: ReturnType<typeof setTimeout> | null = null;
    let isMatchingFrame = false;
    let isDisposed = false;

    const setupLiveScan = async () => {
      if (activeTab !== 'monitoring' || monitoringSubTab !== 'live') return;

      try {
        await faceRecognitionService.loadModels();

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 }
          }
        });

        if (!videoRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        videoRef.current.srcObject = stream;

        scanInterval = setInterval(async () => {
          const pendingCandidates = pendingCandidatesRef.current;
          if (
            isDisposed ||
            isMatchingFrame ||
            !videoRef.current ||
            !activeClass ||
            pendingCandidates.length === 0
          ) {
            return;
          }

          isMatchingFrame = true;
          try {
            const matches = await faceRecognitionService.matchFaces(videoRef.current, pendingCandidates);
            if (matches.length > 0) {
              const matchedIds = matches.map(match => match.label);
              markPresenceBatch(
                matchedIds,
                activeCheckpointConfig.currentCheckpointIndex,
                activeCheckpointConfig.checkpointCount
              );
              setLastDetectedId(matches[0].label);

              if (highlightTimeout) clearTimeout(highlightTimeout);
              highlightTimeout = setTimeout(() => {
                setLastDetectedId(prev => (prev === matches[0].label ? null : prev));
              }, 1800);
            }
          } finally {
            isMatchingFrame = false;
          }
        }, liveScanIntervalMs);
      } catch (e) {
        console.error("Dashboard scan setup failed", e);
      }
    };

    setupLiveScan();

    return () => {
      isDisposed = true;
      if (scanInterval) {
        clearInterval(scanInterval);
      }
      if (highlightTimeout) {
        clearTimeout(highlightTimeout);
      }
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [
    activeTab,
    monitoringSubTab,
    activeClass,
    liveScanIntervalMs,
    activeCheckpointConfig.currentCheckpointIndex,
    activeCheckpointConfig.checkpointCount
  ]);

  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const day = DAYS[dayIndex];
      const match = timetable.find(t => t.dayOfWeek === day && timeStr >= t.startTime && timeStr <= t.endTime);
      setActiveClass(match || null);
    };
    checkTime();
    const interval = setInterval(checkTime, 10000);
    return () => clearInterval(interval);
  }, [timetable]);

  const currentClassStudents = useMemo(() => {
    return activeClass ? students.filter(s => s.department === activeClass.department) : [];
  }, [activeClass, students]);

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
    localStorage.setItem('insight_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];

    setHistory(prev => {
      const pastRecords = prev.filter(r => r.date !== today);
      const todayRecords = prev.filter(r => r.date === today);
      const todayRecordMap = new Map(todayRecords.map(r => [`${r.classId}|${r.studentId}`, r]));
      const nextTodayRecords: HistoryRecord[] = [];

      timetable.forEach(classEntry => {
        const classStudents = students.filter(student => student.department === classEntry.department);

        classStudents.forEach(student => {
          const key = `${classEntry.id}|${student.id}`;
          const existing = todayRecordMap.get(key);
          const attendance: 'Present' | 'Absent' =
            activeClass?.id === classEntry.id
              ? (
                  hasContinuousPresenceByCheckpoint(
                    presenceData[student.id],
                    activeCheckpointConfig.checkpointCount,
                    activeCheckpointConfig.currentCheckpointIndex
                  )
                    ? 'Present'
                    : 'Absent'
                )
              : (existing?.attendance || 'Absent');

          nextTodayRecords.push({
            id: `${today}_${classEntry.id}_${student.id}`,
            classId: classEntry.id,
            studentId: student.id,
            date: today,
            name: student.name,
            registerNumber: student.registerNumber,
            subject: classEntry.subject,
            department: classEntry.department,
            attendance
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
    return history.filter(h => {
      const matchDate = !historyDateFilter || h.date === historyDateFilter;
      const matchDept = historyDeptFilter === 'all' || h.department === historyDeptFilter;
      return matchDate && matchDept;
    });
  }, [history, historyDateFilter, historyDeptFilter]);

  const filteredStudents = useMemo(() => {
    return students.filter(s => yearFilter === 'all' || s.enrollmentYear.toString() === yearFilter);
  }, [students, yearFilter]);

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
    const headers = ["Record ID", "Date", "Name", "Register Number", "Subject", "Department", "Attendance"];
    const rows = filteredHistory.map(h => [
      h.id,
      h.date,
      `"${h.name}"`,
      h.registerNumber,
      `"${h.subject}"`,
      `"${h.department}"`,
      h.attendance
    ]);

    const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    downloadCSV(csvContent, `history_export_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const handleAddClass = () => {
    if (!newClass.subject || !newClass.department || !newClass.startTime || !newClass.endTime) return;
    const entry: TimetableEntry = {
      id: `T${Date.now()}`,
      subject: newClass.subject,
      department: newClass.department,
      startTime: newClass.startTime,
      endTime: newClass.endTime,
      dayOfWeek: newClass.dayOfWeek || 'Monday'
    };
    const updated = [...timetable, entry];
    setTimetable(updated);
    localStorage.setItem('insight_timetable', JSON.stringify(updated));
    setNewClass({ dayOfWeek: 'Monday' });
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

      <main className={`flex-1 mx-auto w-full ${activeTab === 'monitoring' && monitoringSubTab === 'live' ? 'p-4 lg:p-6 max-w-[1920px]' : 'p-6 lg:p-12 max-w-[1600px]'}`}>
        {activeTab === 'monitoring' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
               <div>
                  <h2 className="text-3xl font-black tracking-tight mb-2 text-slate-900 dark:text-white">System Monitoring</h2>
                  <div className="flex items-center space-x-3">
                    <button onClick={() => setMonitoringSubTab('live')} className={`text-[10px] font-black uppercase tracking-[0.2em] pb-1 border-b-2 transition-all ${monitoringSubTab === 'live' ? 'text-cyan-600 dark:text-cyan-400 border-cyan-600 dark:border-cyan-400' : 'text-slate-400 dark:text-slate-600 border-transparent hover:text-slate-600 dark:hover:text-slate-400'}`}>Live Session</button>
                    <button onClick={() => setMonitoringSubTab('history')} className={`text-[10px] font-black uppercase tracking-[0.2em] pb-1 border-b-2 transition-all ${monitoringSubTab === 'history' ? 'text-cyan-600 dark:text-cyan-400 border-cyan-600 dark:border-cyan-400' : 'text-slate-400 dark:text-slate-600 border-transparent hover:text-slate-600 dark:hover:text-slate-400'}`}>History Vault</button>
                  </div>
               </div>

               {monitoringSubTab === 'live' && (
                 <div className="flex flex-wrap items-center gap-3">
                   <span className="px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                     Pending: {pendingRecognitionCandidates.length}
                   </span>
                   <span className="px-4 py-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest">
                     Scan: {liveScanIntervalMs}ms
                   </span>
                   <span className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-widest">
                     Checkpoint: {activeCheckpointConfig.currentCheckpointNumber}/{activeCheckpointConfig.checkpointCount || 1}
                   </span>
                   <button onClick={handleExportCSV} disabled={!activeClass} className="px-6 py-3 bg-cyan-600 dark:bg-cyan-500 text-white dark:text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-cyan-500/10 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                     Export Session .CSV
                   </button>
                 </div>
               )}
            </div>

            {monitoringSubTab === 'live' ? (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-5 space-y-6">
                   <div className="bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-white/5 rounded-[2.5rem] p-4 lg:p-5 relative overflow-hidden aspect-[16/10] min-h-[340px] lg:min-h-[460px] shadow-inner transition-colors">
                      <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover rounded-[2rem] grayscale brightness-90 dark:brightness-75" />
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                         <div className="w-56 h-56 border-2 border-cyan-500/30 rounded-full animate-pulse"></div>
                         <div className="absolute bottom-8 px-6 py-2 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border border-slate-200 dark:border-cyan-500/30 rounded-xl shadow-lg">
                            <p className="text-[9px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-widest animate-pulse">Scanning Bio-Grid...</p>
                         </div>
                      </div>
                   </div>

                   <div className="bg-gradient-to-br from-indigo-50 dark:from-indigo-600/20 to-blue-50 dark:to-blue-600/10 border border-slate-200 dark:border-white/10 p-8 rounded-[2.5rem] shadow-sm transition-colors">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-4">High-Capacity Recognition</h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium mb-6">
                        Multi-face inference is active with continuous checkpoints every {activeCheckpointConfig.intervalMinutes} minutes. Missing any checkpoint marks the student absent.
                      </p>
                      <div className="grid grid-cols-2 gap-3 text-[10px] font-black uppercase tracking-wider">
                        <div className="px-3 py-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                          Pending: {pendingRecognitionCandidates.length}
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                          Scan: {liveScanIntervalMs}ms
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
                          Stage: {activeCheckpointConfig.currentCheckpointNumber}/{activeCheckpointConfig.checkpointCount || 1}
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                          Every {activeCheckpointConfig.intervalMinutes}m
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

                   <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                      <div className="px-6 py-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/30">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Class Roll Call</h3>
                         {activeClass && (
                           <span className="px-3 py-1 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-full text-[9px] font-black uppercase tracking-tighter">
                             {activeClass.subject} - {formatTo12HourTime(activeClass.startTime)} - {formatTo12HourTime(activeClass.endTime)}
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
                                    {clearedSoFar}/{activeCheckpointConfig.currentCheckpointNumber} checkpoints | {latestTimestamp}
                                  </td>
                                </tr>
                              );
                            }) : (
                              <tr>
                                <td colSpan={4} className="px-8 py-12 text-center">
                                  <div className="flex flex-col items-center opacity-40">
                                    <i className="fa-solid fa-radar text-4xl mb-4 text-slate-300 dark:text-slate-700"></i>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">No Active Class detected for your department</p>
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
                      onChange={(e) => setHistoryDateFilter(e.target.value)}
                   />
                   <select 
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 px-4 py-3 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-400 outline-none focus:ring-1 focus:ring-cyan-500/30 transition-colors shadow-sm"
                      onChange={(e) => setHistoryDeptFilter(e.target.value)}
                   >
                      <option value="all">All Departments</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                   </select>
                   <button onClick={handleExportHistoryCSV} className="ml-auto px-6 py-3 bg-white dark:bg-slate-800 text-slate-600 dark:text-white border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm">
                     Download Audit Log
                   </button>
                </div>

                <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                   <div className="overflow-x-auto">
                     <table className="w-full text-left">
                        <thead className="bg-slate-50/50 dark:bg-slate-950/50 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                          <tr>
                            <th className="px-8 py-5">Record ID</th>
                            <th className="px-8 py-5">Date</th>
                            <th className="px-8 py-5">Name</th>
                            <th className="px-8 py-5">Register No</th>
                            <th className="px-8 py-5">Subject</th>
                            <th className="px-8 py-5">Department</th>
                            <th className="px-8 py-5">Attendance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {filteredHistory.length > 0 ? filteredHistory.map(h => (
                            <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.01] transition-colors">
                              <td className="px-8 py-4 font-mono text-[10px] text-slate-400 dark:text-slate-500">{h.id}</td>
                              <td className="px-8 py-4 text-xs font-bold text-slate-800 dark:text-white">{h.date}</td>
                              <td className="px-8 py-4 text-xs font-bold text-slate-800 dark:text-white">{h.name}</td>
                              <td className="px-8 py-4 text-[10px] text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest">{h.registerNumber}</td>
                              <td className="px-8 py-4 text-xs font-bold text-slate-800 dark:text-white">{h.subject}</td>
                              <td className="px-8 py-4 text-[10px] text-slate-400 dark:text-slate-400 font-bold uppercase">{h.department}</td>
                              <td className="px-8 py-4">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${h.attendance === 'Present' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                                  {h.attendance}
                                </span>
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={7} className="px-8 py-10 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600">
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
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-8 gap-4 bg-white dark:bg-slate-900/50 p-6 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm transition-colors animate-in slide-in-from-top-4">
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
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">Day</p>
                    <select className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-white/5 p-4 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white" value={newClass.dayOfWeek || 'Monday'} onChange={e => setNewClass({...newClass, dayOfWeek: e.target.value})}>
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
                      <th className="px-8 py-5">Day</th>
                      <th className="px-8 py-5">Time Slot</th>
                      <th className="px-8 py-5">Session details</th>
                      <th className="px-8 py-5">Department</th>
                      <th className="px-8 py-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {timetable.sort((a,b) => DAYS.indexOf(a.dayOfWeek || '') - DAYS.indexOf(b.dayOfWeek || '')).map(entry => (
                      <tr key={entry.id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.01] transition-colors">
                        <td className="px-8 py-5"><span className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase">{entry.dayOfWeek}</span></td>
                        <td className="px-8 py-5 font-mono text-[10px] text-slate-400 dark:text-slate-500">{formatTo12HourTime(entry.startTime)} - {formatTo12HourTime(entry.endTime)}</td>
                        <td className="px-8 py-5"><p className="text-xs font-bold text-slate-800 dark:text-white">{entry.subject}</p></td>
                        <td className="px-8 py-5"><span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{entry.department}</span></td>
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
                  <option value="all">All Batches</option>
                  <option value="2024">Batch 2024</option>
                </select>
             </div>

             <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm transition-colors">
                <div className="overflow-x-auto">
                   <table className="w-full text-left">
                      <thead className="bg-slate-50/50 dark:bg-slate-950/50 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                        <tr>
                          <th className="px-8 py-5">Student</th>
                          <th className="px-8 py-5">Biometrics</th>
                          <th className="px-8 py-5">Department</th>
                          <th className="px-8 py-5">Enrollment</th>
                          <th className="px-8 py-5">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {filteredStudents.map(student => (
                          <tr key={student.id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
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
                        ))}
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
    </div>
  );
};

export default Dashboard;
