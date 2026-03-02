import React, { useState, useEffect, useCallback } from 'react';
import { AuthMode, AuthState, AdminProfile, Student } from './types';
import FaceScanner from './components/FaceScanner';
import Dashboard from './components/Dashboard';
import { DEPARTMENTS } from './constants';
import { faceRecognitionService } from './services/faceRecognitionService';
import { sqliteService } from './services/sqliteService';

const ADMIN_MATCH_THRESHOLD = 0.94;
const ADMIN_REQUIRED_CONSECUTIVE_MATCHES = 2;
const STUDENT_DUP_FACE_THRESHOLD = 0.93;
const MAX_INTRUDER_ATTEMPTS = 3;
const INTRUDER_LOCK_MS = 30000;
const FALLBACK_ADMIN_RECOVERY_EMAIL = 'lishibora24@gmail.com';

const isValidGmail = (email: string) => /^[^\s@]+@gmail\.com$/i.test(email.trim());

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const savedTheme = localStorage.getItem('insight_theme');
      return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
    } catch {
      return 'dark';
    }
  });

  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    isAdmin: false,
    user: null
  });
  const [mode, setMode] = useState<AuthMode>(AuthMode.ADMIN);
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState('System Initializing...');
  const [adminNameInput, setAdminNameInput] = useState('');
  const [adminRecoveryEmailInput, setAdminRecoveryEmailInput] = useState('');
  const [adminRecoveryInput, setAdminRecoveryInput] = useState('');
  const [isRecoveryActive, setIsRecoveryActive] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<'password' | 'gmail'>('password');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryGmailInput, setRecoveryGmailInput] = useState('');
  const [newRecoveryPasswordInput, setNewRecoveryPasswordInput] = useState('');
  const [confirmRecoveryPasswordInput, setConfirmRecoveryPasswordInput] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [scannerTechnicalIssue, setScannerTechnicalIssue] = useState(false);
  const [intruderAttempts, setIntruderAttempts] = useState(0);
  const [adminMatchStreak, setAdminMatchStreak] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [storedAdmin, setStoredAdmin] = useState<AdminProfile | null>(null);
  const [isDbReady, setIsDbReady] = useState(false);
  
  const [newStudent, setNewStudent] = useState<Partial<Student>>({ name: '', registerNumber: '', department: '' });
  const [successToast, setSuccessToast] = useState<{ name: string; id: string } | null>(null);

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.setAttribute('data-theme', theme);
    if (document.body) {
      document.body.classList.toggle('dark', isDark);
      document.body.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem('insight_theme', theme);
    } catch (e) {
      console.error('Failed to persist theme setting', e);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      const isDark = nextTheme === 'dark';
      document.documentElement.classList.toggle('dark', isDark);
      if (document.body) {
        document.body.classList.toggle('dark', isDark);
      }
      return nextTheme;
    });
  };

  useEffect(() => {
    let active = true;

    const loadSecureVault = async () => {
      try {
        await sqliteService.init();
        const admin = await sqliteService.getAdmin();
        if (active) {
          if (admin && !admin.recoveryEmail) {
            const patchedAdmin: AdminProfile = {
              ...admin,
              recoveryEmail: FALLBACK_ADMIN_RECOVERY_EMAIL
            };
            await sqliteService.upsertAdmin(patchedAdmin);
            setStoredAdmin(patchedAdmin);
          } else {
            setStoredAdmin(admin);
          }
          setIsDbReady(true);
        }
      } catch (error) {
        console.error('Secure database initialization failed:', error);
        if (active) {
          setStatus('Secure Vault Initialization Failed');
          setIsDbReady(true);
        }
      }
    };

    loadSecureVault();

    return () => {
      active = false;
    };
  }, []);
  
  const isSensorEnabled = !!(
    isDbReady &&
    (mode === AuthMode.ADMIN && !isRecoveryActive && (
      !!storedAdmin ||
      (
        adminNameInput.trim().length > 2 &&
        adminRecoveryInput.trim().length > 5 &&
        isValidGmail(adminRecoveryEmailInput)
      )
    )) ||
    (isDbReady && mode === AuthMode.TEST && newStudent.name && newStudent.name.trim().length > 2 && newStudent.registerNumber && newStudent.registerNumber.trim().length > 2 && newStudent.department)
  );

  useEffect(() => {
    if (!isDbReady) {
      setStatus('Loading Secure Vault...');
      return;
    }

    if (isRecoveryActive) {
      setStatus('Identity Recovery Mode');
      return;
    }

    if (mode === AuthMode.ADMIN) {
      if (!storedAdmin) {
        setStatus(adminNameInput.trim().length > 2 && adminRecoveryInput.trim().length > 5 && isValidGmail(adminRecoveryEmailInput)
          ? 'Ready for Biometric Enrollment' 
          : 'Define Admin Credentials + Recovery Gmail');
      } else {
        setStatus(`Identifying: ${storedAdmin.name}`);
      }
    } else {
      setStatus(
        newStudent.name && newStudent.registerNumber && newStudent.department
          ? 'Position Face in Frame'
          : 'Enter Name, Register Number, and Department'
      );
    }
  }, [mode, adminNameInput, adminRecoveryInput, adminRecoveryEmailInput, storedAdmin, newStudent, isRecoveryActive, isDbReady]);

  const handleFaceDetected = useCallback(async (descriptor: Float32Array) => {
    if (!isSensorEnabled || isVerifying || isRecoveryActive) return;

    try {
      if (mode === AuthMode.ADMIN && storedAdmin && lockoutUntil && Date.now() < lockoutUntil) {
        const remainingSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000);
        setStatus(`Security Lockdown: Retry in ${remainingSeconds}s`);
        return;
      }
      if (mode === AuthMode.ADMIN && lockoutUntil && Date.now() >= lockoutUntil) {
        setLockoutUntil(null);
      }

      setIsVerifying(true);
      setStatus('Processing Biometrics...');
      
      if (mode === AuthMode.ADMIN) {
        if (!storedAdmin) {
          const normalizedRecoveryEmail = adminRecoveryEmailInput.trim().toLowerCase();
          if (!isValidGmail(normalizedRecoveryEmail)) {
            setStatus('Recovery Gmail must be a valid @gmail.com address');
            return;
          }

          const newAdmin: AdminProfile = {
            name: adminNameInput.trim(),
            faceDescription: faceRecognitionService.serializeDescriptor(descriptor),
            recoverySecret: adminRecoveryInput.trim(),
            recoveryEmail: normalizedRecoveryEmail,
            registeredAt: new Date().toISOString()
          };
          await sqliteService.upsertAdmin(newAdmin);
          setStoredAdmin(newAdmin);
          setAuth({ isAuthenticated: true, isAdmin: true, user: newAdmin });
          setIntruderAttempts(0);
          setAdminMatchStreak(0);
          setLockoutUntil(null);
        } else {
          const storedDescriptor = faceRecognitionService.deserializeDescriptor(storedAdmin.faceDescription);
          const similarity = faceRecognitionService.calculateCosineSimilarity(descriptor, storedDescriptor);
          
          if (similarity >= ADMIN_MATCH_THRESHOLD) {
            const nextMatchStreak = adminMatchStreak + 1;
            if (nextMatchStreak >= ADMIN_REQUIRED_CONSECUTIVE_MATCHES) {
              setAuth({ isAuthenticated: true, isAdmin: true, user: storedAdmin });
              setIntruderAttempts(0);
              setAdminMatchStreak(0);
              setLockoutUntil(null);
            } else {
              setAdminMatchStreak(nextMatchStreak);
              setStatus(`Admin verification ${nextMatchStreak}/${ADMIN_REQUIRED_CONSECUTIVE_MATCHES}`);
              await new Promise(r => setTimeout(r, 500));
            }
          } else {
            setAdminMatchStreak(0);
            // Only if it's NOT the admin face, check if it matches any student and block those.
            const enrolledStudents = await sqliteService.getStudents();
            const bestStudentMatch = enrolledStudents
              .filter(studentRecord => !!studentRecord.faceDescription)
              .map(studentRecord => {
                const existingDescriptor = faceRecognitionService.deserializeDescriptor(studentRecord.faceDescription!);
                const similarityToStudent = faceRecognitionService.calculateCosineSimilarity(descriptor, existingDescriptor);
                return { student: studentRecord, similarity: similarityToStudent };
              })
              .sort((a, b) => b.similarity - a.similarity)[0];

            const nextAttempts = intruderAttempts + 1;

            if (bestStudentMatch && bestStudentMatch.similarity >= STUDENT_DUP_FACE_THRESHOLD) {
              if (nextAttempts >= MAX_INTRUDER_ATTEMPTS) {
                const lockUntil = Date.now() + INTRUDER_LOCK_MS;
                setLockoutUntil(lockUntil);
                setIntruderAttempts(0);
                setStatus(`Intruder Blocked: Retry in ${Math.ceil(INTRUDER_LOCK_MS / 1000)}s`);
              } else {
                setIntruderAttempts(nextAttempts);
                setStatus(`Access Denied (Student Profile Detected) ${nextAttempts}/${MAX_INTRUDER_ATTEMPTS}`);
              }
            } else {
              if (nextAttempts >= MAX_INTRUDER_ATTEMPTS) {
                const lockUntil = Date.now() + INTRUDER_LOCK_MS;
                setLockoutUntil(lockUntil);
                setIntruderAttempts(0);
                setStatus(`Intruder Blocked: Retry in ${Math.ceil(INTRUDER_LOCK_MS / 1000)}s`);
              } else {
                setIntruderAttempts(nextAttempts);
                setStatus(`Intruder Detected: Access Denied (${nextAttempts}/${MAX_INTRUDER_ATTEMPTS})`);
              }
            }
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } else {
        const studentName = newStudent.name!.trim();
        const registerNumber = newStudent.registerNumber!.trim().toUpperCase();
        const department = newStudent.department!.trim();
        const existingStudents = await sqliteService.getStudents();

        const existingFaceMatch = existingStudents
          .filter(studentRecord => !!studentRecord.faceDescription)
          .map(studentRecord => {
            const existingDescriptor = faceRecognitionService.deserializeDescriptor(studentRecord.faceDescription!);
            const similarity = faceRecognitionService.calculateCosineSimilarity(descriptor, existingDescriptor);
            return { student: studentRecord, similarity };
          })
          .sort((a, b) => b.similarity - a.similarity)[0];

        if (existingFaceMatch && existingFaceMatch.similarity >= STUDENT_DUP_FACE_THRESHOLD) {
          setStatus(`Registration blocked: Face already exists (${existingFaceMatch.student.name} / ${existingFaceMatch.student.registerNumber})`);
          await new Promise(r => setTimeout(r, 2000));
          return;
        }

        const duplicateRegisterNumber = existingStudents.some(
          studentRecord => studentRecord.registerNumber.trim().toUpperCase() === registerNumber
        );
        if (duplicateRegisterNumber) {
          setStatus('Registration blocked: Register number already exists');
          await new Promise(r => setTimeout(r, 2000));
          return;
        }

        const duplicateName = existingStudents.some(
          studentRecord => studentRecord.name.trim().toLowerCase() === studentName.toLowerCase()
        );
        if (duplicateName) {
          setStatus('Registration blocked: Student name already exists');
          await new Promise(r => setTimeout(r, 2000));
          return;
        }

        const student: Student = {
          id: `STU${Math.floor(10000 + Math.random() * 90000)}`,
          registerNumber,
          name: studentName,
          email: `${studentName.toLowerCase().replace(/\s/g, '.')}@uni.ac.in`,
          department,
          enrollmentYear: new Date().getFullYear(),
          status: 'Present',
          faceDescription: faceRecognitionService.serializeDescriptor(descriptor)
        };
        await sqliteService.addStudent(student);
        
        setSuccessToast({ name: student.name, id: student.id });
        setNewStudent({ name: '', registerNumber: '', department: '' });
        
        await new Promise(r => setTimeout(r, 3000));
        setSuccessToast(null);
      }
    } catch (err) {
      console.error("Biometric processing error:", err);
      setStatus("Error: System Failure");
    } finally {
      setIsVerifying(false);
    }
  }, [
    isSensorEnabled,
    isVerifying,
    mode,
    adminNameInput,
    adminRecoveryInput,
    adminRecoveryEmailInput,
    storedAdmin,
    newStudent,
    isRecoveryActive,
    adminMatchStreak,
    intruderAttempts,
    lockoutUntil
  ]);

  const logout = () => {
    setAuth({ isAuthenticated: false, isAdmin: false, user: null });
    setAdminNameInput('');
    setAdminRecoveryEmailInput('');
    setAdminRecoveryInput('');
    setIsRecoveryActive(false);
    setRecoveryMode('password');
    setRecoveryPassword('');
    setRecoveryGmailInput('');
    setNewRecoveryPasswordInput('');
    setConfirmRecoveryPasswordInput('');
    setRecoveryError('');
    setNewStudent({ name: '', registerNumber: '', department: '' });
    setIntruderAttempts(0);
    setAdminMatchStreak(0);
    setLockoutUntil(null);
  };

  const handleRecoveryAccess = (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError('');
    
    const stored = storedAdmin;
    if (!stored) {
      setRecoveryError('No admin profile found. Please enroll admin again.');
      return;
    }

    if (recoveryPassword !== stored.recoverySecret) {
      setRecoveryError('Incorrect Recovery Secret');
      return;
    }

    setAuth({ isAuthenticated: true, isAdmin: true, user: stored });
    setStatus(scannerTechnicalIssue ? 'Emergency Admin Access Granted' : 'Recovery Access Granted');
    setIsRecoveryActive(false);
    setRecoveryMode('password');
    setRecoveryPassword('');
    setRecoveryGmailInput('');
    setNewRecoveryPasswordInput('');
    setConfirmRecoveryPasswordInput('');
    setIntruderAttempts(0);
    setAdminMatchStreak(0);
    setLockoutUntil(null);
  };

  const handleGmailRecoveryReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError('');

    const stored = storedAdmin;
    if (!stored) {
      setRecoveryError('No admin profile found. Please enroll admin again.');
      return;
    }

    const configuredRecoveryEmail = (stored.recoveryEmail || FALLBACK_ADMIN_RECOVERY_EMAIL).toLowerCase();
    if (!stored.recoveryEmail) {
      const patchedAdmin: AdminProfile = {
        ...stored,
        recoveryEmail: configuredRecoveryEmail
      };
      await sqliteService.upsertAdmin(patchedAdmin);
      setStoredAdmin(patchedAdmin);
    }

    const inputGmail = recoveryGmailInput.trim().toLowerCase();
    if (!isValidGmail(inputGmail)) {
      setRecoveryError('Enter a valid @gmail.com address.');
      return;
    }

    if (inputGmail !== configuredRecoveryEmail) {
      setRecoveryError('Gmail does not match the registered recovery account.');
      return;
    }

    if (newRecoveryPasswordInput.trim().length < 6) {
      setRecoveryError('New recovery password must be at least 6 characters.');
      return;
    }

    if (newRecoveryPasswordInput !== confirmRecoveryPasswordInput) {
      setRecoveryError('New recovery passwords do not match.');
      return;
    }

    const updatedAdmin: AdminProfile = {
      ...stored,
      recoverySecret: newRecoveryPasswordInput.trim()
    };

    await sqliteService.upsertAdmin(updatedAdmin);
    setStoredAdmin(updatedAdmin);
    setRecoveryMode('password');
    setRecoveryPassword('');
    setRecoveryGmailInput('');
    setNewRecoveryPasswordInput('');
    setConfirmRecoveryPasswordInput('');
    setStatus('Recovery password updated. Enter it to continue.');
  };

  if (auth.isAuthenticated) {
    return <Dashboard adminName={auth.user?.name || 'Admin'} onLogout={logout} currentTheme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row font-sans text-slate-900 dark:text-slate-100 selection:bg-cyan-500/30 relative overflow-hidden transition-colors duration-500">
      
      {/* Theme Toggle Button (Auth Page) */}
      <button 
        onClick={toggleTheme}
        className="fixed top-6 right-6 z-[110] w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-all text-slate-500 dark:text-cyan-400"
      >
        <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      {/* Decorative Blobs */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20 dark:opacity-20 transition-opacity">
         <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 dark:bg-cyan-500/10 blur-[150px] rounded-full"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 dark:bg-blue-600/10 blur-[150px] rounded-full"></div>
      </div>

      {successToast && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm animate-in slide-in-from-top-4 fade-in duration-500">
          <div className="bg-white dark:bg-slate-900 border border-emerald-500/30 rounded-3xl p-6 backdrop-blur-3xl flex items-center space-x-5 shadow-2xl">
             <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-500">
                <i className="fa-solid fa-check-double text-xl"></i>
             </div>
             <div>
               <p className="text-[10px] font-black uppercase text-emerald-500 tracking-[0.2em] mb-1">Registration Successful</p>
               <p className="text-sm font-bold text-slate-800 dark:text-white">{successToast.name} has been enrolled.</p>
             </div>
          </div>
        </div>
      )}

      {/* Left Column: Branding */}
      <div className="hidden lg:flex flex-[1.2] flex-col justify-center p-24 bg-white/50 dark:bg-slate-900/40 backdrop-blur-md border-r border-slate-200 dark:border-white/5 relative">
        <div className="relative z-10">
          <div className="flex items-center space-x-4 mb-16">
            <div className="w-14 h-14 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl ring-4 ring-cyan-500/10">
              <i className="fa-solid fa-fingerprint text-white text-2xl"></i>
            </div>
            <div>
               <h1 className="text-xl font-black tracking-tighter text-slate-900 dark:text-white uppercase">InsightScan <span className="text-cyan-500 font-medium">Identity</span></h1>
               <p className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">Neural Biometric System</p>
            </div>
          </div>
          <h2 className="text-7xl font-black mb-8 leading-[1] tracking-tighter text-slate-900 dark:text-white">
            Digital <br/> 
            <span className="text-slate-200 dark:text-slate-700 transition-colors">Attendance</span> <br/> 
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-blue-600">Reimagined.</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-lg leading-relaxed max-w-md font-medium opacity-80">
            Enterprise-grade facial recognition using on-device inference. Encrypted, offline, and instant.
          </p>
        </div>
      </div>

      {/* Right Column: Auth Logic */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-sm space-y-12">
          
          {/* Mode Switcher */}
          {!isRecoveryActive && (
            <div className="bg-white/80 dark:bg-slate-900/50 p-1.5 rounded-2xl border border-slate-200 dark:border-white/5 shadow-2xl backdrop-blur-xl transition-all">
              <div className="flex">
                <button 
                  onClick={() => { setMode(AuthMode.ADMIN); setStatus('System Ready'); }} 
                  className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all duration-300 ${mode === AuthMode.ADMIN ? 'bg-slate-100 dark:bg-slate-800 text-cyan-600 dark:text-cyan-400 shadow-md dark:shadow-xl ring-1 ring-slate-200 dark:ring-white/5' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                  Admin Portal
                </button>
                <button 
                  onClick={() => { setMode(AuthMode.TEST); setStatus('Enter Metadata'); }} 
                  className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all duration-300 ${mode === AuthMode.TEST ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-md dark:shadow-xl ring-1 ring-slate-200 dark:ring-white/5' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                  Student Setup
                </button>
              </div>
            </div>
          )}

          <div className="space-y-8">
            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
              {isRecoveryActive ? (
                <div className="space-y-6">
                   <div className="bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 p-6 rounded-[2rem] text-center">
                      <i className="fa-solid fa-triangle-exclamation text-red-500 text-2xl mb-4"></i>
                      <h3 className="text-sm font-black uppercase tracking-widest text-red-500 mb-2">
                        {scannerTechnicalIssue ? 'Emergency Recovery Access' : 'Vault Recovery'}
                      </h3>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                        {scannerTechnicalIssue
                          ? 'Camera hardware issue detected. Enter your master recovery password to sign in as admin.'
                          : 'Enter your master recovery password to sign in as admin, or use Gmail to recover a forgotten password.'}
                      </p>
                   </div>

                   {recoveryMode === 'password' ? (
                     <form onSubmit={handleRecoveryAccess} className="space-y-4">
                        <div className="group relative">
                          <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-red-500 transition-colors">
                             <i className="fa-solid fa-key"></i>
                          </div>
                          <input 
                            type="password" 
                            autoFocus
                            placeholder="Master Recovery Key" 
                            value={recoveryPassword}
                            onChange={e => setRecoveryPassword(e.target.value)}
                            className={`w-full bg-white dark:bg-slate-900 border ${recoveryError ? 'border-red-500/50' : 'border-slate-200 dark:border-white/5'} py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-red-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700`}
                          />
                        </div>
                        
                        {recoveryError && (
                          <p className="text-[10px] font-black text-red-500 uppercase tracking-widest text-center">{recoveryError}</p>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                          <button 
                            type="button"
                            onClick={() => {
                              setIsRecoveryActive(false);
                              setRecoveryError('');
                            }}
                            className="py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700"
                          >
                            Cancel
                          </button>
                          <button 
                            type="submit"
                            className="py-4 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-600/20 hover:bg-red-500 transition-colors"
                          >
                            Verify & Login
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setRecoveryMode('gmail');
                            setRecoveryError('');
                          }}
                          className="w-full text-[10px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-400 hover:opacity-80 transition-opacity pt-2"
                        >
                          Forgot Recovery Password? Use Gmail
                        </button>
                     </form>
                   ) : (
                     <form onSubmit={handleGmailRecoveryReset} className="space-y-4">
                        <div className="group relative">
                          <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-cyan-500 transition-colors">
                             <i className="fa-solid fa-envelope"></i>
                          </div>
                          <input 
                            type="email"
                            autoFocus
                            placeholder="Registered Gmail (example@gmail.com)" 
                            value={recoveryGmailInput}
                            onChange={e => setRecoveryGmailInput(e.target.value)}
                            className={`w-full bg-white dark:bg-slate-900 border ${recoveryError ? 'border-red-500/50' : 'border-slate-200 dark:border-white/5'} py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-cyan-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700`}
                          />
                        </div>
                        <div className="group relative">
                          <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-cyan-500 transition-colors">
                             <i className="fa-solid fa-lock"></i>
                          </div>
                          <input
                            type="password"
                            placeholder="New Recovery Password"
                            value={newRecoveryPasswordInput}
                            onChange={e => setNewRecoveryPasswordInput(e.target.value)}
                            className={`w-full bg-white dark:bg-slate-900 border ${recoveryError ? 'border-red-500/50' : 'border-slate-200 dark:border-white/5'} py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-cyan-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700`}
                          />
                        </div>
                        <div className="group relative">
                          <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-cyan-500 transition-colors">
                             <i className="fa-solid fa-lock"></i>
                          </div>
                          <input
                            type="password"
                            placeholder="Confirm New Recovery Password"
                            value={confirmRecoveryPasswordInput}
                            onChange={e => setConfirmRecoveryPasswordInput(e.target.value)}
                            className={`w-full bg-white dark:bg-slate-900 border ${recoveryError ? 'border-red-500/50' : 'border-slate-200 dark:border-white/5'} py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-cyan-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700`}
                          />
                        </div>

                        {recoveryError && (
                          <p className="text-[10px] font-black text-red-500 uppercase tracking-widest text-center">{recoveryError}</p>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                          <button
                            type="button"
                            onClick={() => {
                              setRecoveryMode('password');
                              setRecoveryError('');
                            }}
                            className="py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700"
                          >
                            Back
                          </button>
                          <button
                            type="submit"
                            className="py-4 bg-cyan-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-cyan-600/20 hover:bg-cyan-500 transition-colors"
                          >
                            Reset Password
                          </button>
                        </div>
                     </form>
                   )}
                </div>
              ) : mode === AuthMode.ADMIN ? (
                !storedAdmin ? (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 px-4">Initialize Administrative Core</p>
                    <div className="group relative">
                      <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-cyan-500 transition-colors">
                         <i className="fa-solid fa-shield-halved"></i>
                      </div>
                      <input 
                        type="text" 
                        placeholder="Admin Name" 
                        value={adminNameInput} 
                        onChange={e => setAdminNameInput(e.target.value)} 
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-cyan-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700" 
                      />
                    </div>
                    <div className="group relative">
                      <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-cyan-500 transition-colors">
                         <i className="fa-solid fa-envelope"></i>
                      </div>
                      <input 
                        type="email" 
                        placeholder="Recovery Gmail (example@gmail.com)" 
                        value={adminRecoveryEmailInput} 
                        onChange={e => setAdminRecoveryEmailInput(e.target.value)} 
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-cyan-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700" 
                      />
                    </div>
                    <div className="group relative">
                      <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-cyan-500 transition-colors">
                         <i className="fa-solid fa-lock"></i>
                      </div>
                      <input 
                        type="password" 
                        placeholder="Master Recovery Password" 
                        value={adminRecoveryInput} 
                        onChange={e => setAdminRecoveryInput(e.target.value)} 
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-cyan-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700" 
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center mb-6">
                    <div className="w-16 h-16 rounded-3xl bg-cyan-500/5 dark:bg-cyan-500/10 border border-cyan-500/20 dark:border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-500 mb-4 animate-in zoom-in-50 duration-500">
                      <i className="fa-solid fa-user-shield text-2xl"></i>
                    </div>
                    <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{storedAdmin.name}</h3>
                    <p className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest mt-1">System Controller</p>
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 px-4">Register Student Identity</p>
                  <div className="group relative">
                     <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-indigo-500 transition-colors">
                        <i className="fa-solid fa-signature"></i>
                     </div>
                     <input 
                      type="text" 
                      placeholder="Full Legal Name" 
                      value={newStudent.name || ''} 
                      onChange={e => setNewStudent({...newStudent, name: e.target.value})} 
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-indigo-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700" 
                     />
                  </div>
                  <div className="group relative">
                     <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-indigo-500 transition-colors">
                        <i className="fa-solid fa-id-card"></i>
                     </div>
                     <input
                      type="text"
                      placeholder="Register Number"
                      value={newStudent.registerNumber || ''}
                      onChange={e => setNewStudent({...newStudent, registerNumber: e.target.value})}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 py-5 pl-14 pr-6 rounded-[2rem] text-slate-900 dark:text-white font-bold outline-none focus:ring-1 focus:ring-indigo-500/30 shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700 uppercase"
                     />
                  </div>
                  <div className="group relative">
                     <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-600 group-focus-within:text-indigo-500 transition-colors">
                        <i className="fa-solid fa-graduation-cap"></i>
                     </div>
                     <select 
                      value={newStudent.department || ''} 
                      onChange={e => setNewStudent({...newStudent, department: e.target.value})} 
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 py-5 pl-14 pr-6 rounded-[2rem] text-slate-500 dark:text-slate-400 font-bold outline-none appearance-none cursor-pointer focus:ring-1 focus:ring-indigo-500/30 shadow-sm transition-all"
                     >
                       <option value="">Select Department</option>
                       {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                     </select>
                  </div>
                </div>
              )}
            </div>
            
            <div className={`relative transition-all duration-700 ${isRecoveryActive ? 'opacity-0 scale-95 pointer-events-none h-0 overflow-hidden' : 'opacity-100'}`}>
              <FaceScanner 
                onFaceDetected={handleFaceDetected} 
                statusMessage={status} 
                enabled={isSensorEnabled} 
                isVerifying={isVerifying}
                onCameraIssueChange={setScannerTechnicalIssue}
              />
            </div>

            {storedAdmin && mode === AuthMode.ADMIN && !isRecoveryActive && (
              <div className="text-center">
                <button 
                  onClick={() => {
                    setRecoveryMode('password');
                    setRecoveryError('');
                    setRecoveryPassword('');
                    setRecoveryGmailInput('');
                    setNewRecoveryPasswordInput('');
                    setConfirmRecoveryPasswordInput('');
                    setIsRecoveryActive(true);
                  }}
                  className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600 hover:text-cyan-600 dark:hover:text-cyan-500 transition-colors"
                >
                  <i className="fa-solid fa-key-skeleton mr-2"></i>
                  {scannerTechnicalIssue ? 'Camera Failed? Use Recovery Access' : 'Forgot Biometrics? Recovery Options'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
