export enum AuthMode {
  ADMIN = 'ADMIN',
  TEST = 'TEST'
}

export interface Student {
  id: string;
  registerNumber: string;
  name: string;
  email: string;
  department: string;
  enrollmentYear: number;
  status: 'Present' | 'Absent' | 'Late';
  faceDescription?: string; // Biometric hash
}

export interface TimetableEntry {
  id: string;
  subject: string;
  department: string;
  enrollmentYear?: number; // Optional batch filter for the class
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  dayOfWeek: string;
  calendarDate?: string; // YYYY-MM-DD
}

export interface PresenceCheck {
  timestamp: string;
  verified: boolean;
}

export interface AdminProfile {
  name: string;
  faceDescription: string;
  recoverySecret: string; // Master password for resets
  recoveryEmail?: string; // Gmail for recovery-secret reset
  registeredAt: string;
}

export interface HistoryRecord {
  id: string;
  date: string;
  subject: string;
  department: string;
  presentCount: number;
  totalCount: number;
  startTime: string;
  endTime: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isAdmin: boolean;
  user: AdminProfile | null;
}
