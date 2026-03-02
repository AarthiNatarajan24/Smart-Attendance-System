/**
 * face-api.js service for local biometric processing.
 * Optimized for speed and utilizes Cosine Similarity for matching.
 */

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

export interface RecognitionMatch {
  label: string;
  similarity: number; // 0 to 1 scale
  descriptor: Float32Array;
  detection: any;
}

export interface DetectionResult {
  descriptor: Float32Array;
  detection: any;
}

export const faceRecognitionService = {
  isLoaded: false,

  async loadModels() {
    if (this.isLoaded) return;
    
    // Safety check: wait for faceapi to be available on window if script is still loading
    const getFaceApi = () => (window as any).faceapi;
    let faceapi = getFaceApi();
    
    if (!faceapi) {
      console.warn("face-api.js script not immediately found. Retrying in 500ms...");
      await new Promise(resolve => setTimeout(resolve, 500));
      faceapi = getFaceApi();
    }

    if (!faceapi) {
      throw new Error("face-api.js not loaded. Check script tag in index.html.");
    }

    // Load models in parallel
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      this.isLoaded = true;
      console.log("Neural models initialized for biometric extraction.");
    } catch (err) {
      console.error("Failed to load neural models from CDN:", err);
      throw err;
    }
  },

  /**
   * Extract face descriptor and detection box with optimized settings.
   */
  async getDescriptor(video: HTMLVideoElement): Promise<DetectionResult | null> {
    const faceapi = (window as any).faceapi;
    if (!faceapi || !this.isLoaded) return null;

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const detection = await faceapi.detectSingleFace(video, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      return detection ? { descriptor: detection.descriptor, detection: detection.detection } : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Extract descriptors for all faces in frame.
   * Used by live monitoring to handle high-capacity classrooms.
   */
  async getDescriptors(video: HTMLVideoElement): Promise<DetectionResult[]> {
    const faceapi = (window as any).faceapi;
    if (!faceapi || !this.isLoaded) return [];

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
      const detections = await faceapi.detectAllFaces(video, options)
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

  /**
   * Manual Cosine Similarity implementation.
   */
  calculateCosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
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
    return dotProduct / (mA * mB || 1); // Avoid division by zero
  },

  /**
   * Matches a current face against a database using Cosine Similarity.
   */
  async matchFace(video: HTMLVideoElement, labeledDescriptors: { label: string, descriptor: Float32Array }[]): Promise<RecognitionMatch | null> {
    const result = await this.getDescriptor(video);
    if (!result || labeledDescriptors.length === 0) return null;

    let bestMatch = { label: 'unknown', similarity: 0, descriptor: result.descriptor, detection: result.detection };

    for (const stored of labeledDescriptors) {
      const similarity = this.calculateCosineSimilarity(result.descriptor, stored.descriptor);
      if (similarity > bestMatch.similarity) {
        bestMatch = { label: stored.label, similarity, descriptor: result.descriptor, detection: result.detection };
      }
    }

    return bestMatch.similarity > 0.82 ? bestMatch : null;
  },

  /**
   * Matches all detected faces in the frame against a descriptor database.
   */
  async matchFaces(video: HTMLVideoElement, labeledDescriptors: { label: string, descriptor: Float32Array }[]): Promise<RecognitionMatch[]> {
    const detections = await this.getDescriptors(video);
    if (detections.length === 0 || labeledDescriptors.length === 0) return [];

    const threshold = 0.82;
    const bestByLabel = new Map<string, RecognitionMatch>();

    for (const detection of detections) {
      let bestLabel = 'unknown';
      let bestSimilarity = 0;

      for (const stored of labeledDescriptors) {
        const similarity = this.calculateCosineSimilarity(detection.descriptor, stored.descriptor);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestLabel = stored.label;
        }
      }

      if (bestSimilarity >= threshold && bestLabel !== 'unknown') {
        const candidateMatch: RecognitionMatch = {
          label: bestLabel,
          similarity: bestSimilarity,
          descriptor: detection.descriptor,
          detection: detection.detection
        };
        const existing = bestByLabel.get(bestLabel);
        if (!existing || candidateMatch.similarity > existing.similarity) {
          bestByLabel.set(bestLabel, candidateMatch);
        }
      }
    }

    return Array.from(bestByLabel.values()).sort((a, b) => b.similarity - a.similarity);
  },

  serializeDescriptor(arr: Float32Array): string {
    return JSON.stringify(Array.from(arr));
  },

  deserializeDescriptor(str: string): Float32Array {
    try {
      return new Float32Array(JSON.parse(str));
    } catch {
      return new Float32Array(128);
    }
  }
};
