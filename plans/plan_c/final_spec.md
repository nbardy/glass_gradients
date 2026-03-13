# Plan C: Final Spec - Worker Architecture & Message Protocol

## Core Message Types

```ts
// ============================================================================
// Worker Message Protocol (Main → Worker)
// ============================================================================

type WorkerMessageType =
  | "init"
  | "config"
  | "render"
  | "query-stats"
  | "reset"
  | "dispose";

interface BaseWorkerMessage {
  id: string; // For request/response matching
  algo: AlgoName;
  timestamp?: number;
}

interface InitMessage extends BaseWorkerMessage {
  type: "init";
  device: GPUDevice;
  canvas: OffscreenCanvas;
  source: string;
}

interface ConfigMessage extends BaseWorkerMessage {
  type: "config";
  config: RuntimeConfig;
}

interface RenderMessage extends BaseWorkerMessage {
  type: "render";
  timestamp: number;
}

interface QueryStatsMessage extends BaseWorkerMessage {
  type: "query-stats";
}

interface ResetMessage extends BaseWorkerMessage {
  type: "reset";
}

interface DisposeMessage extends BaseWorkerMessage {
  type: "dispose";
}

type WorkerMessage =
  | InitMessage
  | ConfigMessage
  | RenderMessage
  | QueryStatsMessage
  | ResetMessage
  | DisposeMessage;

// ============================================================================
// Worker Result Protocol (Worker → Main)
// ============================================================================

type ResultType = "init-result" | "frame" | "stats" | "error";

interface BaseWorkerResult {
  id: string; // Matches request
  algo: AlgoName;
}

interface InitResult extends BaseWorkerResult {
  type: "init-result";
  success: boolean;
  error?: string;
}

interface FrameResult extends BaseWorkerResult {
  type: "frame";
  imageData: ImageData;
  stats: Stats;
  timestamp: number;
  /** Time taken to render in milliseconds */
  renderTimeMs: number;
}

interface StatsResult extends BaseWorkerResult {
  type: "stats";
  stats: Stats;
}

interface ErrorResult extends BaseWorkerResult {
  type: "error";
  message: string;
  stack?: string;
}

type WorkerResult =
  | InitResult
  | FrameResult
  | StatsResult
  | ErrorResult;

// ============================================================================
// Timeline & Recording Types
// ============================================================================

interface TimelineFrame {
  timestamp: number;
  frameIndex: number;
  results: Map<AlgoName, FrameResult>;
  composited: ImageData;
  renderTimeMs: number;
}

type CompositeMode = "sideBySide" | "blend" | "grid" | "splitScreen";

interface CompositeConfig {
  mode: CompositeMode;
  weights?: Map<AlgoName, number>; // For blend mode
  partitions?: Map<AlgoName, { x: number; y: number; w: number; h: number }>;
}

// ============================================================================
// Worker Pool Interface
// ============================================================================

interface WorkerPoolStats {
  workerCount: number;
  activeWorkers: AlgoName[];
  pendingMessages: number;
  totalFramesRendered: number;
  averageRenderTimeMs: number;
}

interface WorkerInstance {
  algo: AlgoName;
  worker: Worker;
  isReady: boolean;
  lastStats: Stats | null;
  lastRenderTime: number;
}
```

## Core Classes & Functions

```ts
// ============================================================================
// Worker Pool Management
// ============================================================================

class WorkerPool {
  private workers: Map<AlgoName, WorkerInstance> = new Map();
  private pendingResults: Map<string, PendingRequest> = new Map();
  private stats: WorkerPoolStats = {};

  /** Register and initialize a new worker */
  async addWorker(algo: AlgoName, scriptPath: string): Promise<void>;

  /** Send message to worker and await response */
  postMessage(
    algo: AlgoName,
    msg: WorkerMessage
  ): Promise<WorkerResult>;

  /** Render all active workers concurrently */
  async renderAll(
    algorithms: AlgoName[],
    timestamp: number
  ): Promise<Map<AlgoName, FrameResult>>;

  /** Get stats for a specific worker */
  getWorkerStats(algo: AlgoName): Stats | null;

  /** Get pool-wide statistics */
  getPoolStats(): WorkerPoolStats;

  /** Clean up worker resources */
  async dispose(algo: AlgoName): Promise<void>;

  /** Dispose all workers */
  async disposeAll(): Promise<void>;

  /** Check if worker is alive */
  isAlive(algo: AlgoName): boolean;

  /** Restart a dead worker */
  async resurrect(algo: AlgoName): Promise<void>;
}

// ============================================================================
// Timeline Recording
// ============================================================================

class TimelineRecorder {
  private frames: TimelineFrame[] = [];
  private maxFrames: number;
  private isRecording: boolean = false;

  constructor(maxFrames?: number);

  /** Start recording frames */
  startRecording(): void;

  /** Stop recording */
  stopRecording(): void;

  /** Add a rendered frame to timeline */
  addFrame(
    timestamp: number,
    results: Map<AlgoName, FrameResult>,
    composited: ImageData
  ): void;

  /** Get frame by index */
  getFrame(index: number): TimelineFrame | null;

  /** Get total frame count */
  getFrameCount(): number;

  /** Get frame range */
  getFrames(start: number, end: number): TimelineFrame[];

  /** Export timeline as JSON */
  exportAsJSON(): string;

  /** Export individual frame as PNG blob */
  exportFrame(index: number): Promise<Blob>;

  /** Export all frames as WebM video */
  exportAsWebM(codec: "vp9" | "av1"): Promise<Blob>;

  /** Clear all frames */
  clear(): void;

  /** Get recording duration in milliseconds */
  getDuration(): number;
}

// ============================================================================
// Composite Rendering
// ============================================================================

class CompositeRenderer {
  constructor(device: GPUDevice, width: number, height: number);

  /** Composite multiple algorithm outputs */
  async composite(
    results: Map<AlgoName, FrameResult>,
    config: CompositeConfig
  ): Promise<ImageData>;

  /** Composite side-by-side */
  private compositeSideBySide(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData;

  /** Composite with blending */
  private compositeBlend(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[],
    weights: Map<AlgoName, number>
  ): ImageData;

  /** Composite grid layout */
  private compositeGrid(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData;

  /** Composite with diagonal split */
  private compositeSplitScreen(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData;

  /** Set output resolution */
  setResolution(width: number, height: number): void;
}

// ============================================================================
// Progressive Convergence Tracking
// ============================================================================

interface ConvergenceMetrics {
  confidence: number[]; // Per frame
  spp: number[]; // Per frame
  darkUnresolved: number[]; // Per frame
}

class ConvergenceTracker {
  private metrics: Map<AlgoName, ConvergenceMetrics> = new Map();

  /** Record convergence for an algorithm */
  record(algo: AlgoName, stats: Stats): void;

  /** Get convergence metrics */
  getMetrics(algo: AlgoName): ConvergenceMetrics | null;

  /** Plot convergence as canvas */
  plotConvergence(algo: AlgoName): HTMLCanvasElement;

  /** Compare convergence between algorithms */
  compareAlgorithms(algos: AlgoName[]): {
    fastestToConfidence: Map<AlgoName, number>;
    finalConfidence: Map<AlgoName, number>;
    convergedFrames: Map<AlgoName, number>;
  };
}

// ============================================================================
// Application State Management
// ============================================================================

interface AppState {
  // Worker & rendering
  workerPool: WorkerPool;
  compositeRenderer: CompositeRenderer;
  convergenceTracker: ConvergenceTracker;

  // Recording
  timelineRecorder: TimelineRecorder;
  isRecording: boolean;

  // Configuration
  activeAlgos: AlgoName[];
  compositeMode: CompositeMode;
  configs: Map<AlgoName, RuntimeConfig>;

  // UI state
  canvas: HTMLCanvasElement;
  device: GPUDevice;

  // Playback
  isRunning: boolean;
  frameCount: number;
  timelinePlayback?: {
    isPlaying: boolean;
    currentFrame: number;
  };
}

// ============================================================================
// Main Application Functions
// ============================================================================

/** Initialize application */
async function initApp(): Promise<AppState>;

/** Toggle algorithm visibility/rendering */
async function toggleAlgorithm(
  state: AppState,
  algo: AlgoName
): Promise<void>;

/** Update configuration for algorithm */
async function updateConfig(
  state: AppState,
  algo: AlgoName,
  config: RuntimeConfig
): Promise<void>;

/** Start recording timeline */
function startRecording(state: AppState): void;

/** Stop recording timeline */
function stopRecording(state: AppState): void;

/** Change composite mode */
function setCompositeMode(state: AppState, mode: CompositeMode): void;

/** Set blend weights for algorithms */
function setBlendWeights(
  state: AppState,
  weights: Map<AlgoName, number>
): void;

/** Render one frame with all active algorithms */
async function renderFrame(
  state: AppState,
  timestamp: number
): Promise<ImageData>;

/** Main render loop */
function renderLoop(state: AppState): void;

/** Export recording */
async function exportRecording(
  state: AppState,
  format: "json" | "webm"
): Promise<Blob>;

/** Load and playback timeline */
async function playbackTimeline(
  state: AppState,
  timeline: TimelineFrame[]
): Promise<void>;

// ============================================================================
// Error Handling
// ============================================================================

interface WorkerError {
  algo: AlgoName;
  message: string;
  stack?: string;
  recoverable: boolean;
}

/** Handle worker error (recover or fallback) */
async function handleWorkerError(
  state: AppState,
  error: WorkerError
): Promise<void>;

/** Display error to user */
function displayError(error: WorkerError): void;

/** Log error with context */
function logError(error: WorkerError): void;
```

## Summary

**Total Type Definitions**: 15+
**Total Class Methods**: 50+
**Total Functions**: 15+

**Key Innovations**:
- Message-based worker communication (no shared state)
- Concurrent multi-algorithm rendering
- Timeline recording with full frame capture
- Composite modes: side-by-side, blend, grid, split-screen
- Convergence metrics and comparative analysis
- Worker lifecycle management with resurrection

**Error Handling**:
- Worker isolation (errors don't crash main thread)
- Recoverable vs. fatal errors
- Fallback to previous results on error
- Detailed error logging with worker context

