import { GoogleGenAI } from "@google/genai";

export interface AttendanceStats {
  totalStudents: number;
  presentCount: number;
  absentCount: number;
  department: string;
  subject: string;
}

export const geminiService = {
  async generateAttendanceReport(stats: AttendanceStats) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return "AI Report unavailable: API Key not configured.";
    }

    const ai = new GoogleGenAI({ apiKey });
    const attendancePercentage = stats.totalStudents > 0
      ? ((stats.presentCount / stats.totalStudents) * 100).toFixed(1)
      : '0.0';
    
    const prompt = `
      As an academic administrator, analyze the following attendance data for a class session:
      - Subject: ${stats.subject}
      - Department: ${stats.department}
      - Total Students: ${stats.totalStudents}
      - Present: ${stats.presentCount}
      - Absent: ${stats.absentCount}
      - Attendance Percentage: ${attendancePercentage}%

      Provide a concise summary (max 3 sentences) including:
      1. An assessment of the attendance level.
      2. A potential reason for any significant absence (if applicable).
      3. A recommendation for the instructor.
      
      Keep the tone professional and helpful.
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      return response.text || "Unable to generate report at this time.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "The AI engine encountered an error while processing the report.";
    }
  }
};
