import React, { useRef, useEffect, useState, useCallback } from 'react';
import { faceRecognitionService } from '../services/faceRecognitionService';

interface FaceScannerProps {
  onFaceDetected: (descriptor: Float32Array) => void;
  statusMessage: string;
  enabled: boolean;
  isVerifying: boolean;
  onCameraIssueChange?: (hasIssue: boolean) => void;
}

type ErrorType = 'PERMISSION' | 'NOT_FOUND' | 'IN_USE' | 'MODEL_LOAD' | 'GENERIC' | 'DISABLED';

interface ScannerError {
  type: ErrorType;
  message: string;
  tips: string[];
}

interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LIVENESS_THRESHOLD = 8; // Number of stable frames required

const FaceScanner: React.FC<FaceScannerProps> = ({ 
  onFaceDetected, 
  statusMessage, 
  enabled,
  isVerifying,
  onCameraIssueChange
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isFaceInFrame, setIsFaceInFrame] = useState(false);
  const [livenessProgress, setLivenessProgress] = useState(0);
  const [error, setError] = useState<ScannerError | null>(null);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef<boolean>(true);
  const descriptorBuffer = useRef<Float32Array[]>([]);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraReady(false);
    descriptorBuffer.current = [];
    setLivenessProgress(0);
    setFaceBox(null);
  }, []);

  const setupCamera = useCallback(async () => {
    stopCamera();
    setError(null);
    activeRef.current = true;
    
    try {
      const constraintFallbacks: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          } as any,
          audio: false
        },
        {
          video: { facingMode: 'user' } as any,
          audio: false
        },
        {
          video: true,
          audio: false
        }
      ];

      let stream: MediaStream | null = null;
      let lastError: any = null;

      for (const constraints of constraintFallbacks) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (e) {
          lastError = e;
        }
      }

      if (!stream) {
        throw lastError || new Error('Unable to open camera stream.');
      }
      
      // Try to apply continuous focus if supported
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' }]
          } as any);
          console.log("Hardware continuous focus engaged.");
        } catch (e) {
          console.warn("Could not apply hardware focus constraints", e);
        }
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.play().catch(e => console.error("Playback failed", e));
            setIsCameraReady(true);
          }
        };
      }
    } catch (err: any) {
      console.error("Camera error:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message?.includes('Permission denied')) {
        setError({
          type: 'PERMISSION',
          message: "Camera Access Blocked",
          tips: ["Click the camera icon in the URL bar", "Grant permission and click 'Retry Access'"]
        });
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError({
          type: 'NOT_FOUND',
          message: "Camera Not Found",
          tips: ["Connect a webcam and reload this page", "If camera is disconnected, reconnect and click 'Retry Access'"]
        });
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError' || err.name === 'AbortError') {
        setError({
          type: 'IN_USE',
          message: "Camera Busy",
          tips: ["Close other apps using the camera (Zoom/Teams/Meet)", "Click 'Retry Access' after freeing the camera"]
        });
      } else {
        setError({
          type: 'GENERIC',
          message: "Hardware Error",
          tips: ["Try reconnecting your camera", "Use Recovery Access if camera hardware is unavailable"]
        });
      }
    }
  }, [stopCamera]);

  useEffect(() => {
    const initModels = async () => {
      try {
        await faceRecognitionService.loadModels();
        setIsModelReady(true);
      } catch (err) {
        setError({
          type: 'MODEL_LOAD',
          message: "AI Core Failure",
          tips: ["Check your internet connection", "Refresh the page"]
        });
      }
    };
    initModels();
    return () => stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (enabled && !isCameraReady && !error && isModelReady) {
      setupCamera();
    }
  }, [enabled, isCameraReady, error, isModelReady, setupCamera]);

  useEffect(() => {
    if (!onCameraIssueChange) return;
    const hasTechnicalIssue = !!error && (error.type === 'NOT_FOUND' || error.type === 'IN_USE' || error.type === 'GENERIC');
    onCameraIssueChange(hasTechnicalIssue);
  }, [error, onCameraIssueChange]);

  useEffect(() => {
    if (!isCameraReady || !isModelReady || !enabled || isVerifying || error) {
      setIsFaceInFrame(false);
      setLivenessProgress(0);
      setFaceBox(null);
      descriptorBuffer.current = [];
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const detect = async () => {
      if (!activeRef.current || isVerifying || error) return;
      
      if (videoRef.current && videoRef.current.readyState === 4) {
        try {
          const result = await faceRecognitionService.getDescriptor(videoRef.current);
          
          if (result && activeRef.current) {
            const { descriptor, detection } = result;
            setIsFaceInFrame(true);

            // Update face box coordinates for focus UI
            // Map video resolution to percentage
            const videoWidth = videoRef.current.videoWidth;
            const videoHeight = videoRef.current.videoHeight;
            const box = detection.box;
            
            setFaceBox({
              x: (box.x / videoWidth) * 100,
              y: (box.y / videoHeight) * 100,
              width: (box.width / videoWidth) * 100,
              height: (box.height / videoHeight) * 100
            });
            
            // Check stability against the last frame if available
            if (descriptorBuffer.current.length > 0) {
              const last = descriptorBuffer.current[descriptorBuffer.current.length - 1];
              const sim = faceRecognitionService.calculateCosineSimilarity(descriptor, last);
              
              // If the face jumped too much (unstable), reset the sequence
              if (sim < 0.90) {
                descriptorBuffer.current = [descriptor];
              } else {
                descriptorBuffer.current.push(descriptor);
              }
            } else {
              descriptorBuffer.current.push(descriptor);
            }

            const currentLength = descriptorBuffer.current.length;
            const progress = Math.min(100, (currentLength / LIVENESS_THRESHOLD) * 100);
            setLivenessProgress(progress);

            if (currentLength >= LIVENESS_THRESHOLD) {
              // Average all descriptors in the sequence for ultimate precision
              const averaged = new Float32Array(descriptor.length);
              for (let i = 0; i < descriptor.length; i++) {
                let sum = 0;
                for (let j = 0; j < currentLength; j++) {
                  sum += descriptorBuffer.current[j][i];
                }
                averaged[i] = sum / currentLength;
              }
              
              onFaceDetected(averaged);
              descriptorBuffer.current = [];
              setLivenessProgress(0);
              return;
            }
          } else {
            // Face lost - reset
            setIsFaceInFrame(false);
            setFaceBox(null);
            if (descriptorBuffer.current.length > 0) {
              descriptorBuffer.current = [];
              setLivenessProgress(0);
            }
          }
        } catch (e) {
          setIsFaceInFrame(false);
          setFaceBox(null);
        }
      }
      
      timer = setTimeout(detect, 100); // Polling for liveness and tracking
    };

    detect();
    return () => clearTimeout(timer);
  }, [isCameraReady, isModelReady, enabled, isVerifying, onFaceDetected, error]);

  return (
    <div className="relative w-full max-w-md mx-auto aspect-square rounded-[3rem] overflow-hidden border-4 border-slate-800 bg-slate-900 shadow-2xl ring-1 ring-white/5 transition-all duration-500">
      
      <video 
        ref={videoRef} 
        autoPlay 
        muted 
        playsInline 
        className={`w-full h-full object-cover transition-all duration-700 ${isCameraReady && !error ? 'opacity-100 scale-100' : 'opacity-0 scale-110 grayscale'}`} 
      />
      
      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className={`absolute inset-0 bg-slate-950/40 transition-opacity duration-500 ${isCameraReady ? 'opacity-0' : 'opacity-100'}`}></div>
        
        {/* Dynamic Focus Reticle */}
        {faceBox && isCameraReady && !error && !isVerifying && (
          <div 
            className="absolute border-2 border-cyan-400/60 rounded-2xl transition-all duration-150 ease-out shadow-[0_0_15px_rgba(34,211,238,0.4)]"
            style={{
              left: `${faceBox.x}%`,
              top: `${faceBox.y}%`,
              width: `${faceBox.width}%`,
              height: `${faceBox.height}%`,
            }}
          >
            {/* Focus Crosshairs */}
            <div className="absolute -top-2 -left-2 w-4 h-4 border-t-2 border-l-2 border-cyan-400"></div>
            <div className="absolute -top-2 -right-2 w-4 h-4 border-t-2 border-r-2 border-cyan-400"></div>
            <div className="absolute -bottom-2 -left-2 w-4 h-4 border-b-2 border-l-2 border-cyan-400"></div>
            <div className="absolute -bottom-2 -right-2 w-4 h-4 border-b-2 border-r-2 border-cyan-400"></div>
            
            <div className="absolute top-1/2 left-[-10px] w-1 h-[20%] bg-cyan-400/40 -translate-y-1/2"></div>
            <div className="absolute top-1/2 right-[-10px] w-1 h-[20%] bg-cyan-400/40 -translate-y-1/2"></div>
          </div>
        )}

        <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
          {!error && isCameraReady && (
            <div className={`relative w-64 h-64 flex items-center justify-center transition-all duration-500 ${isFaceInFrame ? 'scale-105' : 'opacity-30'}`}>
              
              {/* Circular Liveness Progress */}
              <svg className="absolute inset-0 w-full h-full -rotate-90 drop-shadow-[0_0_8px_rgba(6,182,212,0.3)]" viewBox="0 0 100 100">
                <circle
                  cx="50" cy="50" r="46"
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-white/5"
                />
                <circle
                  cx="50" cy="50" r="46"
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray="289"
                  strokeDashoffset={289 - (289 * livenessProgress) / 100}
                  strokeLinecap="round"
                  className="text-cyan-500 transition-all duration-200"
                />
              </svg>

              {/* Reticle Corners */}
              <div className="absolute inset-0 rounded-[2.5rem] border border-white/10">
                <div className={`absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 rounded-tl-2xl transition-colors ${isFaceInFrame ? 'border-cyan-400' : 'border-slate-700'}`}></div>
                <div className={`absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 rounded-tr-2xl transition-colors ${isFaceInFrame ? 'border-cyan-400' : 'border-slate-700'}`}></div>
                <div className={`absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 rounded-bl-2xl transition-colors ${isFaceInFrame ? 'border-cyan-400' : 'border-slate-700'}`}></div>
                <div className={`absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 rounded-br-2xl transition-colors ${isFaceInFrame ? 'border-cyan-400' : 'border-slate-700'}`}></div>
              </div>
              
              {isVerifying && (
                <div className="w-full h-1 bg-cyan-500/50 absolute top-0 left-0 animate-scan"></div>
              )}
            </div>
          )}

          {!error && (
            <div className="absolute bottom-10 w-full px-8">
               <div className={`flex flex-col items-center space-y-2 px-6 py-4 bg-slate-950/90 backdrop-blur-2xl border ${enabled ? (isFaceInFrame ? 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.2)]' : 'border-white/10 shadow-xl') : 'border-white/5'} rounded-2xl transition-all`}>
                  <div className="flex items-center space-x-3">
                    <i className={`fa-solid ${isVerifying ? 'fa-spinner fa-spin' : (isFaceInFrame ? 'fa-crosshairs text-cyan-400 animate-pulse' : 'fa-id-card-clip')} text-xs`}></i>
                    <span className={`text-[10px] font-black tracking-widest uppercase truncate ${enabled ? 'text-white' : 'text-slate-600'}`}>
                      {livenessProgress > 0 && !isVerifying ? `Auto-Focus Locked: ${Math.round(livenessProgress)}%` : statusMessage}
                    </span>
                  </div>
                  {livenessProgress > 0 && !isVerifying && (
                    <div className="w-full h-0.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 transition-all duration-200" style={{ width: `${livenessProgress}%` }}></div>
                    </div>
                  )}
               </div>
            </div>
          )}
        </div>
      </div>

      {!isModelReady && !error && (
        <div className="absolute inset-0 bg-slate-950 z-20 flex flex-col items-center justify-center p-12 text-center">
          <div className="w-10 h-10 border-2 border-slate-800 border-t-cyan-500 rounded-full animate-spin mb-6"></div>
          <p className="text-slate-500 text-[9px] font-black uppercase tracking-[0.4em]">Optimizing Neural Core</p>
        </div>
      )}

      {!enabled && isModelReady && !error && !isCameraReady && (
        <div className="absolute inset-0 bg-slate-900 z-10 flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-500">
           <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6">
              <i className="fa-solid fa-user-lock text-slate-600 text-2xl"></i>
           </div>
           <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] max-w-[180px]">Fill details to enable biometric sensor</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 bg-slate-950 z-30 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
          <div className="w-16 h-16 bg-red-500/10 rounded-3xl flex items-center justify-center mb-6">
            <i className="fa-solid fa-lock text-red-500 text-2xl"></i>
          </div>
          <h3 className="text-white font-black uppercase text-sm mb-4 tracking-tighter">{error.message}</h3>
          <div className="w-full space-y-2 mb-8">
            {error.tips.map((tip, i) => (
              <div key={i} className="text-slate-400 text-[10px] font-medium p-3 bg-white/[0.03] rounded-xl border border-white/5 text-left leading-relaxed">
                {tip}
              </div>
            ))}
          </div>
          <button 
            onClick={setupCamera} 
            className="pointer-events-auto px-10 py-4 bg-white text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-cyan-400 transition-all shadow-xl active:scale-95"
          >
            Retry Access
          </button>
        </div>
      )}

      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          50% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan {
          animation: scan 2s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default FaceScanner;
