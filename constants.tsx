
import { Student, TimetableEntry } from './types';

export const DEPARTMENTS = [
  'Computer Science Engineering',
  'Information Technology',
  'Civil',
  'EEE',
  'ECE',
  'Biotech',
  'Pharma',
  'Petrochemical',
  'Automobile',
];

export const ENROLLMENT_YEARS = [2022, 2023, 2024, 2025, 2026];

export const MOCK_STUDENTS: Student[] = [
  { id: 'STU001', registerNumber: 'CSE24001', name: 'Alice Johnson', email: 'alice.j@uni.edu', department: 'Computer Science Engineering', enrollmentYear: 2024, status: 'Present' },
  { id: 'STU002', registerNumber: 'EEE24002', name: 'Bob Smith', email: 'bob.s@uni.edu', department: 'EEE', enrollmentYear: 2024, status: 'Absent' },
  { id: 'STU003', registerNumber: 'BIO24003', name: 'Charlie Davis', email: 'charlie.d@uni.edu', department: 'Biotech', enrollmentYear: 2024, status: 'Late' },
];

export const MOCK_TIMETABLE: TimetableEntry[] = [
  { id: 'T1', subject: 'Advanced AI Systems', department: 'Computer Science Engineering', enrollmentYear: 2024, startTime: '08:00', endTime: '09:00', dayOfWeek: 'Monday' },
  { id: 'T2', subject: 'Digital Signal Processing', department: 'ECE', enrollmentYear: 2023, startTime: '09:30', endTime: '10:30', dayOfWeek: 'Monday' },
  { id: 'T3', subject: 'Power Electronics', department: 'EEE', enrollmentYear: 2024, startTime: '11:00', endTime: '12:30', dayOfWeek: 'Tuesday' },
];

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const APP_THEME = {
  primary: 'cyan-500',
  secondary: 'blue-600',
  accent: 'indigo-500',
  bg: 'slate-950',
  card: 'slate-900',
  border: 'slate-800'
};
