# Plan C: Technical Implementation Details

## Overview

Plan C implements a **worker-based system** where each algorithm runs in its own thread, communicating via message passing. This guide covers the complex coordination logic, worker lifecycle, and advanced features like timeline recording and A/B comparison.

---

## Implementation Sequence

### Phase 1: Message Protocol & Worker Harness (90 minutes)

#### 1a. Base Worker Template

**File**: `worker/base-worker.ts`

All algorithm workers inherit from this template:

```typescript
// worker/base-worker.ts

import type { WorkerMessage, WorkerResult } from "../core/message-protocol.ts";

type WorkerHandler = (msg: WorkerMessage) => Promise<WorkerResult>;

class BaseWorker {
  private handlers: Map<string, WorkerHandler> = new Map();

  constructor(
    private moduleName: string,
    handlers: Record<string, WorkerHandler>
  ) {
    this.handlers = new Map(Object.entries(handlers));

    self.onmessage = (event: MessageEvent<WorkerMessage>) => {
      this.handleMessage(event.data).catch((error) => {
        self.postMessage({
          type: "error",
          id: event.data.id,
          algo: event.data.algo,
          message: String(error),
          stack: error.stack,
        } as ErrorResult);
      });
    };

    self.onerror = (event: ErrorEvent) => {
      console.error(`Worker ${this.moduleName} error:`, event);
    };
  }

  private async handleMessage(msg: WorkerMessage): Promise<void> {
    const handler = this.handlers.get(msg.type);
    if (!handler) {
      throw new Error(`Unknown message type: ${msg.type}`);
    }

    const result = await handler(msg);
    self.postMessage(result);
  }
}

export function setupWorker(
  moduleName: string,
  handlers: Record<string, WorkerHandler>
): void {
  new BaseWorker(moduleName, handlers);
}
```

#### 1b. V1 Worker Implementation

**File**: `worker/v1-worker.ts`

```typescript
// worker/v1-worker.ts

import { setupWorker } from "./base-worker.ts";
import { module as v1Module } from "../v1_refined_webgpu/module.ts";
import type {
  InitMessage,
  ConfigMessage,
  RenderMessage,
  QueryStatsMessage,
  ResetMessage,
  DisposeMessage,
  WorkerResult,
} from "../core/message-protocol.ts";

let renderer: AlgoRenderer | null = null;
let device: GPUDevice | null = null;
let canvas: OffscreenCanvas | null = null;
let config: RuntimeConfig = {};
let frameCount = 0;
let lastRenderTime = performance.now();

setupWorker("v1_refined", {
  async init(msg: InitMessage): Promise<WorkerResult> {
    try {
      device = msg.device;
      canvas = msg.canvas;

      renderer = await v1Module.create(device, canvas, msg.source);
      config = SchemaRenderer.getDefaultConfig(v1Module.configSchema);

      return {
        type: "init-result",
        id: msg.id,
        algo: "v1_refined",
        success: true,
      };
    } catch (error) {
      return {
        type: "init-result",
        id: msg.id,
        algo: "v1_refined",
        success: false,
        error: String(error),
      };
    }
  },

  async config(msg: ConfigMessage): Promise<WorkerResult> {
    if (!renderer) throw new Error("Renderer not initialized");

    config = { ...msg.config };
    await renderer.setConfig(config);

    return {
      type: "stats",
      id: msg.id,
      algo: "v1_refined",
      stats: renderer.getStats(),
    };
  },

  async render(msg: RenderMessage): Promise<WorkerResult> {
    if (!renderer || !canvas) throw new Error("Renderer not initialized");

    const startTime = performance.now();
    await renderer.render(msg.timestamp);
    const renderTimeMs = performance.now() - startTime;

    // Capture canvas to ImageData
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    frameCount++;

    return {
      type: "frame",
      id: msg.id,
      algo: "v1_refined",
      imageData,
      stats: renderer.getStats(),
      timestamp: msg.timestamp,
      renderTimeMs,
    };
  },

  async "query-stats"(msg: QueryStatsMessage): Promise<WorkerResult> {
    if (!renderer) throw new Error("Renderer not initialized");

    return {
      type: "stats",
      id: msg.id,
      algo: "v1_refined",
      stats: renderer.getStats(),
    };
  },

  async reset(msg: ResetMessage): Promise<WorkerResult> {
    if (!renderer) throw new Error("Renderer not initialized");

    await renderer.reset();
    frameCount = 0;

    return {
      type: "stats",
      id: msg.id,
      algo: "v1_refined",
      stats: renderer.getStats(),
    };
  },

  async dispose(msg: DisposeMessage): Promise<WorkerResult> {
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }

    return {
      type: "stats",
      id: msg.id,
      algo: "v1_refined",
      stats: {},
    };
  },
});
```

#### 1c. Worker Pool

**File**: `core/worker-pool.ts`

```typescript
class WorkerPool {
  private workers: Map<AlgoName, WorkerInstance> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestIdCounter = 0;

  async addWorker(algo: AlgoName, scriptPath: string): Promise<void> {
    if (this.workers.has(algo)) {
      throw new Error(`Worker ${algo} already exists`);
    }

    const worker = new Worker(scriptPath, { type: "module" });

    worker.onerror = (event: ErrorEvent) => {
      console.error(`Worker ${algo} error:`, event);
      this.handleWorkerError(algo, event);
    };

    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      this.handleWorkerResult(algo, event.data);
    };

    this.workers.set(algo, {
      algo,
      worker,
      isReady: false,
      lastStats: null,
      lastRenderTime: 0,
    });
  }

  private generateRequestId(): string {
    return `req-${++this.requestIdCounter}`;
  }

  postMessage(algo: AlgoName, msg: WorkerMessage): Promise<WorkerResult> {
    const instance = this.workers.get(algo);
    if (!instance) throw new Error(`No worker for ${algo}`);

    const id = this.generateRequestId();
    const fullMsg = { ...msg, id, algo };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Worker ${algo} request timeout`));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        instance.worker.postMessage(fullMsg);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  private handleWorkerResult(algo: AlgoName, result: WorkerResult): void {
    const pending = this.pendingRequests.get(result.id);

    if (!pending) {
      console.warn(`Unexpected worker result for ${result.id}`);
      return;
    }

    this.pendingRequests.delete(result.id);

    const instance = this.workers.get(algo)!;

    if (result.type === "error") {
      pending.reject(new Error((result as ErrorResult).message));
    } else if (result.type === "frame") {
      const frameResult = result as FrameResult;
      instance.lastStats = frameResult.stats;
      instance.lastRenderTime = frameResult.renderTimeMs;
      pending.resolve(frameResult);
    } else if (result.type === "init-result") {
      const initResult = result as InitResult;
      instance.isReady = initResult.success;
      pending.resolve(initResult);
    } else {
      pending.resolve(result);
    }
  }

  private handleWorkerError(algo: AlgoName, event: ErrorEvent): void {
    // Auto-resurrect worker on error
    const instance = this.workers.get(algo);
    if (instance) {
      instance.isReady = false;
      // Log error; UI will handle resurrection
    }
  }

  async renderAll(
    algorithms: AlgoName[],
    timestamp: number
  ): Promise<Map<AlgoName, FrameResult>> {
    const promises = algorithms.map((algo) =>
      this.postMessage(algo, {
        type: "render",
        timestamp,
      } as RenderMessage).then((result) => {
        if (result.type !== "frame") {
          throw new Error(`Expected frame result, got ${result.type}`);
        }
        return [algo, result as FrameResult] as const;
      })
    );

    try {
      const results = await Promise.allSettled(promises);

      const frames = new Map<AlgoName, FrameResult>();

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const algo = algorithms[i];

        if (result.status === "fulfilled") {
          const [, frame] = result.value;
          frames.set(algo, frame);
        } else {
          console.error(`Render failed for ${algo}:`, result.reason);
          // Continue with other algorithms
        }
      }

      return frames;
    } catch (error) {
      console.error("renderAll failed:", error);
      throw error;
    }
  }

  async dispose(algo: AlgoName): Promise<void> {
    const instance = this.workers.get(algo);
    if (!instance) return;

    try {
      await this.postMessage(algo, {
        type: "dispose",
      } as DisposeMessage);
    } catch (error) {
      console.warn(`Dispose failed for ${algo}:`, error);
    }

    instance.worker.terminate();
    this.workers.delete(algo);
  }

  async disposeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.workers.keys()).map((algo) => this.dispose(algo))
    );
  }

  isAlive(algo: AlgoName): boolean {
    return this.workers.get(algo)?.isReady || false;
  }

  getPoolStats(): WorkerPoolStats {
    let totalRenderTime = 0;
    let renderCount = 0;

    for (const instance of this.workers.values()) {
      totalRenderTime += instance.lastRenderTime;
      renderCount++;
    }

    return {
      workerCount: this.workers.size,
      activeWorkers: Array.from(this.workers.keys()),
      pendingMessages: this.pendingRequests.size,
      totalFramesRendered: 0, // Track separately
      averageRenderTimeMs: renderCount > 0 ? totalRenderTime / renderCount : 0,
    };
  }
}
```

### Phase 2: Composition & Effects (90 minutes)

#### 2a. Composite Renderer

**File**: `core/composite-renderer.ts`

```typescript
class CompositeRenderer {
  private device: GPUDevice;
  private width: number;
  private height: number;

  constructor(device: GPUDevice, width: number, height: number) {
    this.device = device;
    this.width = width;
    this.height = height;
  }

  async composite(
    results: Map<AlgoName, FrameResult>,
    config: CompositeConfig
  ): Promise<ImageData> {
    const algos = Array.from(results.keys());

    if (algos.length === 0) {
      return new ImageData(this.width, this.height);
    }

    if (algos.length === 1) {
      return results.get(algos[0])!.imageData;
    }

    switch (config.mode) {
      case "sideBySide":
        return this.compositeSideBySide(results, algos);
      case "blend":
        return this.compositeBlend(
          results,
          algos,
          config.weights || new Map()
        );
      case "grid":
        return this.compositeGrid(results, algos);
      case "splitScreen":
        return this.compositeSplitScreen(results, algos);
      default:
        throw new Error(`Unknown composite mode: ${config.mode}`);
    }
  }

  private compositeSideBySide(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData {
    const output = new ImageData(this.width, this.height);
    const outputData = output.data;

    const cellWidth = Math.floor(this.width / algos.length);

    for (let i = 0; i < algos.length; i++) {
      const algo = algos[i];
      const sourceImage = results.get(algo)!.imageData;
      const sourceData = sourceImage.data;

      const offsetX = i * cellWidth;
      const srcWidth = sourceImage.width;
      const srcHeight = sourceImage.height;

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < cellWidth; x++) {
          // Scale coordinates from output to source
          const srcX = Math.floor((x / cellWidth) * srcWidth);
          const srcY = Math.floor((y / this.height) * srcHeight);

          const srcIdx = (srcY * srcWidth + srcX) * 4;
          const outIdx = (y * this.width + (offsetX + x)) * 4;

          outputData[outIdx] = sourceData[srcIdx];
          outputData[outIdx + 1] = sourceData[srcIdx + 1];
          outputData[outIdx + 2] = sourceData[srcIdx + 2];
          outputData[outIdx + 3] = sourceData[srcIdx + 3];
        }
      }
    }

    return output;
  }

  private compositeBlend(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[],
    weights: Map<AlgoName, number>
  ): ImageData {
    const output = new ImageData(this.width, this.height);
    const outputData = output.data;

    // Initialize to zero
    for (let i = 0; i < outputData.length; i++) {
      outputData[i] = 0;
    }

    let totalWeight = 0;

    for (const algo of algos) {
      const weight = weights.get(algo) ?? 1.0 / algos.length;
      totalWeight += weight;

      const sourceImage = results.get(algo)!.imageData;
      const sourceData = sourceImage.data;

      for (let i = 0; i < Math.min(sourceData.length, outputData.length); i += 4) {
        outputData[i] += sourceData[i] * weight; // R
        outputData[i + 1] += sourceData[i + 1] * weight; // G
        outputData[i + 2] += sourceData[i + 2] * weight; // B
        outputData[i + 3] = 255; // A
      }
    }

    // Normalize
    if (totalWeight > 0) {
      for (let i = 0; i < outputData.length; i += 4) {
        outputData[i] = Math.min(outputData[i] / totalWeight, 255);
        outputData[i + 1] = Math.min(outputData[i + 1] / totalWeight, 255);
        outputData[i + 2] = Math.min(outputData[i + 2] / totalWeight, 255);
      }
    }

    return output;
  }

  private compositeGrid(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData {
    const cols = Math.ceil(Math.sqrt(algos.length));
    const rows = Math.ceil(algos.length / cols);

    const cellWidth = Math.floor(this.width / cols);
    const cellHeight = Math.floor(this.height / rows);

    const output = new ImageData(this.width, this.height);
    const outputData = output.data;

    for (let i = 0; i < algos.length; i++) {
      const algo = algos[i];
      const sourceImage = results.get(algo)!.imageData;
      const sourceData = sourceImage.data;

      const row = Math.floor(i / cols);
      const col = i % cols;

      const offsetX = col * cellWidth;
      const offsetY = row * cellHeight;

      const srcWidth = sourceImage.width;
      const srcHeight = sourceImage.height;

      for (let y = 0; y < cellHeight; y++) {
        for (let x = 0; x < cellWidth; x++) {
          const srcX = Math.floor((x / cellWidth) * srcWidth);
          const srcY = Math.floor((y / cellHeight) * srcHeight);

          const srcIdx = (srcY * srcWidth + srcX) * 4;
          const outIdx = ((offsetY + y) * this.width + (offsetX + x)) * 4;

          outputData[outIdx] = sourceData[srcIdx];
          outputData[outIdx + 1] = sourceData[srcIdx + 1];
          outputData[outIdx + 2] = sourceData[srcIdx + 2];
          outputData[outIdx + 3] = sourceData[srcIdx + 3];
        }
      }
    }

    return output;
  }

  private compositeSplitScreen(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData {
    if (algos.length < 2) {
      return results.get(algos[0])!.imageData;
    }

    const output = new ImageData(this.width, this.height);
    const outputData = output.data;

    const image0 = results.get(algos[0])!.imageData.data;
    const image1 = results.get(algos[1])!.imageData.data;

    // Diagonal split: top-left is algo0, bottom-right is algo1
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const outIdx = (y * this.width + x) * 4;

        // Determine which side of diagonal
        const threshold = (x / this.width) * this.height;
        const isBelowDiag = y > threshold;

        const sourceData = isBelowDiag ? image1 : image0;

        outputData[outIdx] = sourceData[outIdx];
        outputData[outIdx + 1] = sourceData[outIdx + 1];
        outputData[outIdx + 2] = sourceData[outIdx + 2];
        outputData[outIdx + 3] = sourceData[outIdx + 3];
      }
    }

    return output;
  }

  setResolution(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
}
```

### Phase 3: Timeline Recording (60 minutes)

**File**: `core/timeline-recorder.ts`

```typescript
class TimelineRecorder {
  private frames: TimelineFrame[] = [];
  private maxFrames: number;
  private isRecording: boolean = false;
  private frameIndex: number = 0;

  constructor(maxFrames: number = 3600) {
    this.maxFrames = maxFrames;
  }

  startRecording(): void {
    this.isRecording = true;
    this.frames = [];
    this.frameIndex = 0;
  }

  stopRecording(): void {
    this.isRecording = false;
  }

  addFrame(
    timestamp: number,
    results: Map<AlgoName, FrameResult>,
    composited: ImageData,
    renderTimeMs: number
  ): void {
    if (!this.isRecording) return;

    const frame: TimelineFrame = {
      timestamp,
      frameIndex: this.frameIndex++,
      results: new Map(results), // Copy to avoid mutation
      composited: new ImageData(
        new Uint8ClampedArray(composited.data),
        composited.width,
        composited.height
      ),
      renderTimeMs,
    };

    this.frames.push(frame);

    // Ring buffer management
    if (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }

  getFrame(index: number): TimelineFrame | null {
    return this.frames[index] || null;
  }

  getFrames(start: number, end: number): TimelineFrame[] {
    return this.frames.slice(start, end);
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  getDuration(): number {
    if (this.frames.length === 0) return 0;
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    return last.timestamp - first.timestamp;
  }

  exportAsJSON(): string {
    // Export metadata + compressed frame data
    const metadata = {
      frameCount: this.frames.length,
      duration: this.getDuration(),
      startTime: this.frames[0]?.timestamp || 0,
      endTime: this.frames[this.frames.length - 1]?.timestamp || 0,
    };

    const frameData = this.frames.map((frame) => ({
      timestamp: frame.timestamp,
      frameIndex: frame.frameIndex,
      renderTimeMs: frame.renderTimeMs,
      stats: Object.fromEntries(
        Array.from(frame.results.values()).map((r) => [r.algo, r.stats])
      ),
    }));

    return JSON.stringify({ metadata, frames: frameData });
  }

  async exportFrame(index: number): Promise<Blob> {
    const frame = this.frames[index];
    if (!frame) throw new Error(`Frame ${index} not found`);

    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      canvas.width = frame.composited.width;
      canvas.height = frame.composited.height;

      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(frame.composited, 0, 0);

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
      }, "image/png");
    });
  }

  clear(): void {
    this.frames = [];
    this.frameIndex = 0;
    this.isRecording = false;
  }
}
```

### Phase 4: Main Application (90 minutes)

**File**: `app.ts`

```typescript
import { ModuleRegistry } from "./core/module-registry.ts";
import { SchemaRenderer } from "./core/schema-renderer.ts";
import { WorkerPool } from "./core/worker-pool.ts";
import { CompositeRenderer } from "./core/composite-renderer.ts";
import { TimelineRecorder } from "./core/timeline-recorder.ts";
import { ConvergenceTracker } from "./core/convergence-tracker.ts";

let state: AppState;

async function initApp(): Promise<void> {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  const canvas = document.querySelector("canvas") as HTMLCanvasElement;

  const registry = new ModuleRegistry();
  // Register modules...

  state = {
    workerPool: new WorkerPool(),
    compositeRenderer: new CompositeRenderer(device, canvas.width, canvas.height),
    convergenceTracker: new ConvergenceTracker(),
    timelineRecorder: new TimelineRecorder(),

    isRecording: false,
    activeAlgos: [],
    compositeMode: "sideBySide",
    configs: new Map(),

    canvas,
    device,

    isRunning: true,
    frameCount: 0,
  };

  // Setup UI
  setupUI();

  // Start render loop
  renderLoop();
}

async function renderFrame(timestamp: number): Promise<ImageData> {
  // Render all active algorithms concurrently
  const results = await state.workerPool.renderAll(state.activeAlgos, timestamp);

  // Composite results
  const composited = await state.compositeRenderer.composite(results, {
    mode: state.compositeMode,
  });

  // Track convergence
  for (const [algo, result] of results) {
    state.convergenceTracker.record(algo, result.stats);
  }

  // Record if needed
  const totalRenderTime = Array.from(results.values()).reduce(
    (sum, r) => sum + r.renderTimeMs,
    0
  );

  state.timelineRecorder.addFrame(timestamp, results, composited, totalRenderTime);

  return composited;
}

function renderLoop(): void {
  requestAnimationFrame(async (timestamp) => {
    if (state.isRunning && state.activeAlgos.length > 0) {
      try {
        const composited = await renderFrame(timestamp);

        const ctx = state.canvas.getContext("2d")!;
        ctx.putImageData(composited, 0, 0);

        state.frameCount++;
      } catch (error) {
        console.error("Render error:", error);
      }
    }

    renderLoop();
  });
}

function setupUI(): void {
  const algoSelector = document.querySelector(
    "#algo-selector"
  ) as HTMLSelectElement;
  algoSelector.addEventListener("change", async (e) => {
    const algo = (e.target as HTMLSelectElement).value as AlgoName;
    await toggleAlgorithm(state, algo);
  });

  const recordBtn = document.querySelector("#record-btn") as HTMLButtonElement;
  recordBtn.addEventListener("click", () => {
    state.timelineRecorder.startRecording();
    state.isRecording = true;
    recordBtn.textContent = "Recording...";
  });

  const stopBtn = document.querySelector("#stop-record-btn") as HTMLButtonElement;
  stopBtn.addEventListener("click", () => {
    state.timelineRecorder.stopRecording();
    state.isRecording = false;
    recordBtn.textContent = "Record";
  });

  const exportBtn = document.querySelector("#export-btn") as HTMLButtonElement;
  exportBtn.addEventListener("click", async () => {
    const json = state.timelineRecorder.exportAsJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function toggleAlgorithm(state: AppState, algo: AlgoName): Promise<void> {
  const index = state.activeAlgos.indexOf(algo);

  if (index >= 0) {
    state.activeAlgos.splice(index, 1);
    await state.workerPool.dispose(algo);
  } else {
    state.activeAlgos.push(algo);

    // Create offscreen canvas for worker
    const offscreenCanvas = new OffscreenCanvas(
      state.canvas.width,
      state.canvas.height
    );

    // Load and setup worker
    const source = await fetch(`./shaders/${algo}.wgsl`).then((r) => r.text());
    await state.workerPool.addWorker(algo, `./worker/${algo}-worker.ts`);
    await state.workerPool.postMessage(algo, {
      type: "init",
      device: state.device,
      canvas: offscreenCanvas,
      source,
    } as InitMessage);

    // Store config
    const registry = new ModuleRegistry();
    const module = registry.getModule(algo);
    state.configs.set(
      algo,
      SchemaRenderer.getDefaultConfig(module.configSchema)
    );
  }
}

initApp().catch(console.error);
```

---

## Advanced Features

### Convergence Comparison

**File**: `core/convergence-tracker.ts`

```typescript
class ConvergenceTracker {
  private metrics: Map<AlgoName, ConvergenceMetrics> = new Map();

  record(algo: AlgoName, stats: Stats): void {
    if (!this.metrics.has(algo)) {
      this.metrics.set(algo, {
        confidence: [],
        spp: [],
        darkUnresolved: [],
      });
    }

    const m = this.metrics.get(algo)!;
    m.confidence.push(stats.confident || 0);
    m.spp.push(stats.spp || 0);
    m.darkUnresolved.push(stats.darkUnresolved || 0);
  }

  compareAlgorithms(algos: AlgoName[]): {
    fastestToConfidence: Map<AlgoName, number>;
    finalConfidence: Map<AlgoName, number>;
    convergedFrames: Map<AlgoName, number>;
  } {
    const results = {
      fastestToConfidence: new Map<AlgoName, number>(),
      finalConfidence: new Map<AlgoName, number>(),
      convergedFrames: new Map<AlgoName, number>(),
    };

    const confidenceThreshold = 0.95;

    for (const algo of algos) {
      const m = this.metrics.get(algo);
      if (!m || m.confidence.length === 0) continue;

      // Time to 95% confidence
      const convergedFrame = m.confidence.findIndex(
        (c) => c >= confidenceThreshold
      );
      results.convergedFrames.set(algo, convergedFrame >= 0 ? convergedFrame : -1);

      // Final confidence
      results.finalConfidence.set(algo, m.confidence[m.confidence.length - 1]);

      // Fastest to 95% (frame count)
      results.fastestToConfidence.set(algo, convergedFrame >= 0 ? convergedFrame : Infinity);
    }

    return results;
  }
}
```

---

## Error Handling Strategy

### Worker Resurrection

If a worker crashes, the main thread can resurrect it:

```typescript
async function resurrectWorker(state: AppState, algo: AlgoName): Promise<void> {
  try {
    await state.workerPool.dispose(algo);
  } catch {
    // Worker already dead
  }

  // Reinitialize
  await toggleAlgorithm(state, algo);
}
```

### Graceful Degradation

If some workers fail, composite what's available:

```typescript
async function renderFrameFallback(timestamp: number): Promise<ImageData> {
  const results = new Map<AlgoName, FrameResult>();

  for (const algo of state.activeAlgos) {
    try {
      const result = await state.workerPool.postMessage(algo, {
        type: "render",
        timestamp,
      });

      if (result.type === "frame") {
        results.set(algo, result as FrameResult);
      }
    } catch (error) {
      console.warn(`Render failed for ${algo}, skipping`, error);
      // Continue with other algorithms
    }
  }

  return state.compositeRenderer.composite(results, {
    mode: state.compositeMode,
  });
}
```

---

## Testing Checklist

- [ ] Worker pool creates workers without leaks
- [ ] Message protocol roundtrip works for all message types
- [ ] Concurrent renders complete without race conditions
- [ ] Composite modes produce correct output (pixel-perfect tests)
- [ ] Timeline recording captures frames correctly
- [ ] Convergence tracker computes metrics accurately
- [ ] Worker error doesn't crash main thread
- [ ] Memory usage stays bounded during long recordings
- [ ] A/B comparison mode works (side-by-side, blend, grid)
- [ ] Export timeline as JSON and playback works

---

## Success Criteria

- ✅ 3–4 algorithms render concurrently at 60 FPS
- ✅ Timeline records 3600+ frames without OOM
- ✅ A/B comparison modes work (all 4: side-by-side, blend, grid, split-screen)
- ✅ Worker errors don't crash main thread
- ✅ Convergence metrics enable comparative analysis
- ✅ Export timeline as JSON and PNG frames
- ✅ Main thread stays <5% busy
- ✅ Worker pool scales to 8+ workers (if CPU allows)

