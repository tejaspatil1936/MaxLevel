export interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface EligibleUser {
  prn: string;
  email: string; // lowercase
  name: string;
  claimedByUid: string | null;
}

export type UserRole = "student" | "admin";

export interface UserProfile {
  uid: string;
  prn: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export type SeriesStatus = "draft" | "active" | "archived";
export type DevtoolsOpenPolicy = "strike" | "submit";

export interface SeriesWindow {
  start: string; // "07:00"
  end: string;   // "15:00"
  tz: string;    // "Asia/Kolkata"
}

export interface Series {
  id: string;
  title: string;
  status: SeriesStatus;
  window: SeriesWindow;
  durationMin: number;
  maxStrikes: number;
  devtoolsOpenPolicy: DevtoolsOpenPolicy;
  cameraStrikes: boolean; // default true (Phase 3)
  secondaryCameraRequired?: boolean;
  resultsVisible: boolean;
  leaderboardVisible: boolean;
  createdAt: string;
  archivedAt: string | null;
}

export interface TestWindow {
  start: string;
  end: string;
}

export interface Test {
  id: string;
  seriesId: string;
  day: number;
  title: string;
  company: string;
  date: string; // "YYYY-MM-DD"
  window: TestWindow | null; // null inherits from series
  durationMin: number | null; // null inherits from series
  questionCount: number;
  resultsVisible: boolean | null; // null inherits from series
  secondaryCameraRequired?: boolean | null; // null inherits from series
  hasQuestions: boolean;
}

export type TestState = "upcoming" | "open" | "closed" | "submitted";

export interface StudentTestView extends Test {
  state: TestState;
  effectiveWindow: TestWindow;
  effectiveDurationMin: number;
  effectiveResultsVisible: boolean;
  effectiveSecondaryCameraRequired?: boolean;
  userAttempt?: {
    id: string;
    status: "awaiting_start" | "in_progress" | "submitted" | "auto_submitted" | "terminated_by_proctor";
  } | null;
}

export interface ProctorSession {
  id: string;
  testId: string;
  uid: string;
  token: string;
  status: "waiting" | "connected" | "disconnected";
  createdAt: number;
  lastPingPhone: number;
  offer?: { type: string; sdp: string } | null;
  answer?: { type: string; sdp: string } | null;
  candidatesLaptop?: Array<{ candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }>;
  candidatesPhone?: Array<{ candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }>;
  phoneState?: {
    inForeground: boolean;
    battery?: number | null;
    moved?: boolean;
    cameraOk: boolean;
    facingMode?: "user" | "environment";
    preview?: string | null;
    updatedAt: number;
  };
}

export interface Question {
  id: string;
  text: string;
  options: [string, string, string, string];
  topic?: string;
  source?: string;
}

export interface QuestionWithAnswer extends Question {
  correctIndex: number;
  explanation?: string;
}

export interface TestQuestionsDoc {
  questions: Question[];
}

export interface AnswerKeysDoc {
  answers: Record<string, number>;
  explanations?: Record<string, string>;
}

export interface AttemptEvent {
  type: string;
  at: string;
  meta?: Record<string, any>;
}

export type SubmitReason =
  | "manual"
  | "timeout"
  | "strikes"
  | "devtools"
  | "camera"
  | "expired"
  | "terminated_by_proctor"
  | null;

export interface AttemptPhoneState {
  paired?: boolean;
  pairedAt?: number;
  active?: boolean;
  monitoring?: boolean;
  startedAt?: number;
  lastBeatAt?: number;
  strikes?: number;
  pausedUntil?: number;
  pauseUsed?: boolean;
  last?: Record<string, number>;
  lastEvent?: { type: string; t: number; weight: number };
}

export interface Attempt {
  id: string; // `${testId}_${uid}`
  uid: string;
  seriesId: string;
  testId: string;
  status: "awaiting_start" | "in_progress" | "submitted" | "auto_submitted" | "terminated_by_proctor";
  submitReason: SubmitReason;
  submitReasonDetail?: string;
  startedAt: string;
  deadlineAt: string;
  answers: Record<string, number>;
  score: number;
  total: number;
  timeTakenSec: number;
  strikes: number;
  events: AttemptEvent[];
  submittedAt: string | null;
  phone?: AttemptPhoneState;
}

export type ViolationType =
  | "tab_switch"
  | "fullscreen_exit"
  | "copy"
  | "cut"
  | "paste"
  | "devtools_open"
  | "devtools_shortcut"
  | "reload"
  | "camera_no_face"
  | "camera_multiple_faces"
  | "camera_lost"
  | "camera_phone_detected"
  | "multiple_screens";

export interface StartTestResponse {
  attemptId: string;
  questions: Question[];
  deadlineAt: string;
  serverNow: string;
  answers?: Record<string, number>;
  isReconnect?: boolean;
  day?: number;
  testTitle?: string;
  company?: string;
}

export interface ViolationResponse {
  strikes: number;
  max: number;
  autoSubmit: boolean;
  submitReason?: SubmitReason;
  submitReasonDetail?: string;
}

export interface SubmitResponse {
  submitted: boolean;
}

export interface QuestionReviewItem {
  id: string;
  text: string;
  options: [string, string, string, string];
  userAnswer: number | null;
  correctAnswer: number;
  explanation?: string;
  topic?: string;
}

export interface AttemptResultResponse {
  score: number;
  total: number;
  timeTakenSec: number;
  submittedAt: string;
  submitReason: SubmitReason;
  submitReasonDetail?: string;
  questions: QuestionReviewItem[];
}

export interface LeaderboardRow {
  uid: string;
  name: string;
  prn: string;
  scores: Record<string, number>;
  total: number;
  timeSec: number;
  rank: number;
}

export interface LeaderboardDoc {
  generatedAt: string;
  rows: LeaderboardRow[];
  days?: number[];
}
