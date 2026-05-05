/**
 * Browser biometric service using face-api.js only.
 * InsightFace records are recognized as stored metadata, but that engine is disabled.
 */

const FACE_API_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js';
const FACE_API_MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

const LIVE_MATCH_COSINE_THRESHOLD = 0.94;
const LIVE_MATCH_DISTANCE_THRESHOLD = 0.46;
const LIVE_MATCH_DISTANCE_MARGIN = 0.05;
const LIVE_MATCH_COSINE_MARGIN = 0.015;

const PHOTO_MATCH_COSINE_THRESHOLD = 0.9;
const PHOTO_MATCH_DISTANCE_THRESHOLD = 0.58;
const PHOTO_MATCH_DISTANCE_MARGIN = 0.015;
const PHOTO_MATCH_COSINE_MARGIN = 0.002;
const PHOTO_SINGLE_MATCH_THRESHOLD = 0.89;

export type RecognitionEngine = 'face-api' | 'insightface';

interface SerializedDescriptorPayloadV2 {
  version: 2;
  engine: RecognitionEngine;
  vector: number[];
}

interface StoredDescriptorRecord {
  descriptor: Float32Array;
  engine: RecognitionEngine;
  isLegacy: boolean;
}

export interface RecognitionMatch {
  label: string;
  similarity: number;
  descriptor: Float32Array;
  detection: any;
}

export interface DetectionResult {
  descriptor: Float32Array;
  detection: any;
}

type RecognitionInput = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

type MatchThresholdConfig = {
  cosineThreshold: number;
  distanceThreshold: number;
  distanceMargin: number;
  cosineMargin: number;
  singleMatchThreshold: number;
};

const pendingScriptLoads = new Map<string, Promise<void>>();

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isStoredEngine = (value: string | null | undefined): value is RecognitionEngine =>
  value === 'face-api' || value === 'insightface';

const ensureScript = async (src: string, ready: () => boolean): Promise<void> => {
  if (ready()) return;

  const existingPromise = pendingScriptLoads.get(src);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  pendingScriptLoads.set(src, loadPromise);
  try {
    await loadPromise;
  } finally {
    pendingScriptLoads.delete(src);
  }
};

const isStillImageInput = (input: RecognitionInput): input is HTMLImageElement | HTMLCanvasElement =>
  !(typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement);

const getInputDimensions = (input: RecognitionInput): { width: number; height: number } => {
  if (typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement) {
    return {
      width: input.videoWidth || input.clientWidth || 0,
      height: input.videoHeight || input.clientHeight || 0
    };
  }

  if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
    return {
      width: input.naturalWidth || input.width || 0,
      height: input.naturalHeight || input.height || 0
    };
  }

  return {
    width: input.width || 0,
    height: input.height || 0
  };
};

export const faceRecognitionService = {
  isLoaded: false,
  activeEngine: null as RecognitionEngine | null,
  faceApiLoaded: false,
  faceApiStillImageLoaded: false,
  faceApiStillImageUnavailable: false,

  getPreferredEngine(): RecognitionEngine {
    return 'face-api';
  },

  getRuntimeEngine(): RecognitionEngine {
    return 'face-api';
  },

  getEngineLabel(engine: RecognitionEngine = this.getRuntimeEngine()): string {
    return engine === 'insightface' ? 'InsightFace' : 'face-api';
  },

  describeStoredDescriptor(str: string): StoredDescriptorRecord {
    try {
      const parsed = JSON.parse(str) as SerializedDescriptorPayloadV2 | number[];

      if (Array.isArray(parsed)) {
        return {
          descriptor: new Float32Array(parsed),
          engine: 'face-api',
          isLegacy: true
        };
      }

      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.version === 2 &&
        isStoredEngine(parsed.engine) &&
        Array.isArray(parsed.vector)
      ) {
        return {
          descriptor: new Float32Array(parsed.vector),
          engine: parsed.engine,
          isLegacy: false
        };
      }
    } catch {
      // Fall through to the invalid-record fallback below.
    }

    return {
      descriptor: new Float32Array(0),
      engine: 'face-api',
      isLegacy: false
    };
  },

  isStoredDescriptorCompatible(str: string, engine: RecognitionEngine = this.getRuntimeEngine()): boolean {
    const stored = this.describeStoredDescriptor(str);
    return stored.descriptor.length > 0 && stored.engine === engine;
  },

  async loadModels(engine: RecognitionEngine = 'face-api') {
    if (engine === 'insightface') {
      console.warn('InsightFace is disabled in this build. Using face-api instead.');
    }

    if (this.isLoaded && this.activeEngine === 'face-api') return;
    await this.loadFaceApiModels();
    this.isLoaded = true;
  },

  async loadFaceApiModels() {
    if (this.faceApiLoaded) {
      this.activeEngine = 'face-api';
      return;
    }

    const getFaceApi = () => (window as any).faceapi;
    let faceapi = getFaceApi();

    if (!faceapi) {
      await delay(500);
      faceapi = getFaceApi();
    }

    if (!faceapi) {
      await ensureScript(FACE_API_SCRIPT_URL, () => Boolean(getFaceApi()));
      faceapi = getFaceApi();
    }

    if (!faceapi) {
      throw new Error('face-api.js not loaded. Check script tag in index.html.');
    }

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL)
    ]);

    this.faceApiLoaded = true;
    this.activeEngine = 'face-api';
    console.log('face-api biometric engine initialized.');
  },

  async loadOptionalStillImageModels() {
    if (this.faceApiStillImageLoaded || this.faceApiStillImageUnavailable) return;

    const faceapi = (window as any).faceapi;
    if (!faceapi) return;

    try {
      await faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_API_MODEL_URL);
      this.faceApiStillImageLoaded = true;
    } catch (error) {
      this.faceApiStillImageUnavailable = true;
      console.warn('Optional SSD face detector unavailable. Keeping TinyFaceDetector for still images.', error);
    }
  },

  getMatchThresholds(input: RecognitionInput): MatchThresholdConfig {
    return isStillImageInput(input)
      ? {
          cosineThreshold: PHOTO_MATCH_COSINE_THRESHOLD,
          distanceThreshold: PHOTO_MATCH_DISTANCE_THRESHOLD,
          distanceMargin: PHOTO_MATCH_DISTANCE_MARGIN,
          cosineMargin: PHOTO_MATCH_COSINE_MARGIN,
          singleMatchThreshold: PHOTO_SINGLE_MATCH_THRESHOLD
        }
      : {
          cosineThreshold: LIVE_MATCH_COSINE_THRESHOLD,
          distanceThreshold: LIVE_MATCH_DISTANCE_THRESHOLD,
          distanceMargin: LIVE_MATCH_DISTANCE_MARGIN,
          cosineMargin: LIVE_MATCH_COSINE_MARGIN,
          singleMatchThreshold: 0.92
        };
  },

  createCanvasVariant(
    input: RecognitionInput,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    scale = 1
  ): HTMLCanvasElement | null {
    const width = Math.max(1, Math.round(sourceWidth));
    const height = Math.max(1, Math.round(sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext('2d');
    if (!context) return null;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      input as CanvasImageSource,
      sourceX,
      sourceY,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  },

  createRotatedCanvasVariant(input: HTMLImageElement | HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement | null {
    const { width, height } = getInputDimensions(input);
    if (width <= 0 || height <= 0) return null;

    const canvas = document.createElement('canvas');
    const isSideways = degrees === 90 || degrees === 270;
    canvas.width = isSideways ? height : width;
    canvas.height = isSideways ? width : height;

    const context = canvas.getContext('2d');
    if (!context) return null;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    if (degrees === 90) {
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
    } else if (degrees === 180) {
      context.translate(canvas.width, canvas.height);
      context.rotate(Math.PI);
    } else {
      context.translate(0, canvas.height);
      context.rotate((3 * Math.PI) / 2);
    }

    context.drawImage(input as CanvasImageSource, 0, 0, width, height);
    return canvas;
  },

  buildStillImageVariants(input: HTMLImageElement | HTMLCanvasElement): RecognitionInput[] {
    const baseVariants: RecognitionInput[] = [input];

    ([90, 180, 270] as const).forEach(degrees => {
      const rotated = this.createRotatedCanvasVariant(input, degrees);
      if (rotated) {
        baseVariants.push(rotated);
      }
    });

    const variants: RecognitionInput[] = [];

    for (const baseVariant of baseVariants) {
      variants.push(baseVariant);

      const { width, height } = getInputDimensions(baseVariant);
      if (width <= 0 || height <= 0) continue;

      const minSide = Math.min(width, height);
      const maxSide = Math.max(width, height);

      if (minSide < 1200 && maxSide < 2600) {
        const upscaled = this.createCanvasVariant(baseVariant, 0, 0, width, height, 1.75);
        if (upscaled) {
          variants.push(upscaled);
        }
      }

      if (width >= 720 && height >= 720) {
        const overlapRatio = 0.18;
        const tileWidth = Math.min(width, Math.ceil(width * (0.5 + overlapRatio)));
        const tileHeight = Math.min(height, Math.ceil(height * (0.5 + overlapRatio)));
        const xOffsets = [0, Math.max(0, width - tileWidth)];
        const yOffsets = [0, Math.max(0, height - tileHeight)];

        for (const x of xOffsets) {
          for (const y of yOffsets) {
            const tile = this.createCanvasVariant(baseVariant, x, y, tileWidth, tileHeight, 1.3);
            if (tile) {
              variants.push(tile);
            }
          }
        }
      }
    }

    return variants;
  },

  getDetectionArea(detection: any): number {
    const box = detection?.box || detection;
    const width = Number(box?.width) || 0;
    const height = Number(box?.height) || 0;
    return width * height;
  },

  dedupeDetectionResults(detections: DetectionResult[]): DetectionResult[] {
    const sortedDetections = [...detections].sort(
      (a, b) => this.getDetectionArea(b.detection) - this.getDetectionArea(a.detection)
    );
    const unique: DetectionResult[] = [];

    for (const candidate of sortedDetections) {
      const isDuplicate = unique.some(existing => {
        const similarity = this.calculateCosineSimilarity(candidate.descriptor, existing.descriptor);
        const distance = this.calculateEuclideanDistance(candidate.descriptor, existing.descriptor);
        return (
          (Number.isFinite(similarity) && similarity >= 0.985) ||
          (Number.isFinite(distance) && distance <= 0.18)
        );
      });

      if (!isDuplicate) {
        unique.push(candidate);
      }
    }

    return unique;
  },

  async getDescriptor(input: RecognitionInput): Promise<DetectionResult | null> {
    if (!this.isLoaded) return null;
    return this.getFaceApiDescriptor(input);
  },

  async getDescriptors(input: RecognitionInput): Promise<DetectionResult[]> {
    if (!this.isLoaded) return [];
    return this.getFaceApiDescriptors(input);
  },

  async getFaceApiDescriptor(input: RecognitionInput): Promise<DetectionResult | null> {
    const faceapi = (window as any).faceapi;
    if (!faceapi || this.activeEngine !== 'face-api') return null;

    if (isStillImageInput(input)) {
      const detections = await this.getFaceApiDescriptors(input);
      return detections.sort((a, b) => this.getDetectionArea(b.detection) - this.getDetectionArea(a.detection))[0] || null;
    }

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const detection = await faceapi.detectSingleFace(input, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      return detection ? { descriptor: detection.descriptor, detection: detection.detection } : null;
    } catch {
      return null;
    }
  },

  async getFaceApiDescriptors(input: RecognitionInput): Promise<DetectionResult[]> {
    const faceapi = (window as any).faceapi;
    if (!faceapi || this.activeEngine !== 'face-api') return [];

    try {
      if (isStillImageInput(input)) {
        await this.loadOptionalStillImageModels();
        const variants = this.buildStillImageVariants(input);
        const aggregateDetections: DetectionResult[] = [];

        for (const variant of variants) {
          const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.2 });
          const tinyDetections = await faceapi.detectAllFaces(variant, tinyOptions)
            .withFaceLandmarks()
            .withFaceDescriptors();

          aggregateDetections.push(...tinyDetections.map((d: any) => ({
            descriptor: d.descriptor,
            detection: d.detection
          })));

          if (this.faceApiStillImageLoaded) {
            const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.18, maxResults: 64 });
            const ssdDetections = await faceapi.detectAllFaces(variant, ssdOptions)
              .withFaceLandmarks()
              .withFaceDescriptors();

            aggregateDetections.push(...ssdDetections.map((d: any) => ({
              descriptor: d.descriptor,
              detection: d.detection
            })));
          }
        }

        return this.dedupeDetectionResults(aggregateDetections);
      }

      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
      const detections = await faceapi.detectAllFaces(input, options)
        .withFaceLandmarks()
        .withFaceDescriptors();

      return detections.map((d: any) => ({
        descriptor: d.descriptor,
        detection: d.detection
      }));
    } catch {
      return [];
    }
  },

  calculateCosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) return Number.NaN;

    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      mA += vecA[i] * vecA[i];
      mB += vecB[i] * vecB[i];
    }
    mA = Math.sqrt(mA);
    mB = Math.sqrt(mB);
    return dotProduct / (mA * mB || 1);
  },

  calculateEuclideanDistance(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) return Number.NaN;

    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      const diff = vecA[i] - vecB[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  },

  async matchFace(input: RecognitionInput, labeledDescriptors: { label: string, descriptor: Float32Array }[]): Promise<RecognitionMatch | null> {
    const result = await this.getDescriptor(input);
    if (!result || labeledDescriptors.length === 0) return null;
    const thresholds = this.getMatchThresholds(input);

    let bestMatch = { label: 'unknown', similarity: 0, descriptor: result.descriptor, detection: result.detection };

    for (const stored of labeledDescriptors) {
      const similarity = this.calculateCosineSimilarity(result.descriptor, stored.descriptor);
      if (!Number.isFinite(similarity)) continue;
      if (similarity > bestMatch.similarity) {
        bestMatch = { label: stored.label, similarity, descriptor: result.descriptor, detection: result.detection };
      }
    }

    return bestMatch.similarity >= thresholds.singleMatchThreshold ? bestMatch : null;
  },

  async matchFaces(input: RecognitionInput, labeledDescriptors: { label: string, descriptor: Float32Array }[]): Promise<RecognitionMatch[]> {
    const detections = await this.getDescriptors(input);
    if (detections.length === 0 || labeledDescriptors.length === 0) return [];
    const thresholds = this.getMatchThresholds(input);

    const bestByLabel = new Map<string, RecognitionMatch>();

    for (const detection of detections) {
      const rankedCandidates = labeledDescriptors
        .map(stored => ({
          label: stored.label,
          similarity: this.calculateCosineSimilarity(detection.descriptor, stored.descriptor),
          distance: this.calculateEuclideanDistance(detection.descriptor, stored.descriptor)
        }))
        .filter(candidate => Number.isFinite(candidate.similarity) && Number.isFinite(candidate.distance))
        .sort((a, b) => {
          if (a.distance !== b.distance) return a.distance - b.distance;
          return b.similarity - a.similarity;
        });

      const [bestCandidate, secondCandidate] = rankedCandidates;
      if (!bestCandidate) continue;

      const hasStrongSimilarity = bestCandidate.similarity >= thresholds.cosineThreshold;
      const hasStrongDistance = bestCandidate.distance <= thresholds.distanceThreshold;
      const hasEnoughSeparation = !secondCandidate || (
        (secondCandidate.distance - bestCandidate.distance) >= thresholds.distanceMargin &&
        (bestCandidate.similarity - secondCandidate.similarity) >= thresholds.cosineMargin
      );

      if (hasStrongSimilarity && hasStrongDistance && hasEnoughSeparation) {
        const candidateMatch: RecognitionMatch = {
          label: bestCandidate.label,
          similarity: bestCandidate.similarity,
          descriptor: detection.descriptor,
          detection: detection.detection
        };
        const existing = bestByLabel.get(bestCandidate.label);
        if (!existing || candidateMatch.similarity > existing.similarity) {
          bestByLabel.set(bestCandidate.label, candidateMatch);
        }
      }
    }

    return Array.from(bestByLabel.values()).sort((a, b) => b.similarity - a.similarity);
  },

  serializeDescriptor(arr: Float32Array, _engine: RecognitionEngine = 'face-api'): string {
    const payload: SerializedDescriptorPayloadV2 = {
      version: 2,
      engine: 'face-api',
      vector: Array.from(arr)
    };
    return JSON.stringify(payload);
  },

  deserializeDescriptor(str: string): Float32Array {
    return this.describeStoredDescriptor(str).descriptor;
  }
};
