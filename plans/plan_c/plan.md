# Plan C: Worker-Based Modular System

## Overview

**Duration**: 6–8 hours
**Complexity**: High
**Risk**: Medium (Worker messaging complexity)

Plan C is the **most scalable and feature-rich** approach. It moves rendering into **dedicated workers** that communicate via message protocol, enabling:

- **Concurrent renders**: Render multiple algorithms simultaneously for A/B comparison
- **Timeline recording**: Capture progressive refinement across frames
- **Maximum isolation**: Algorithm failures don't crash the main thread
- **Flexible composition**: Mix-and-match effects, tone mapping, and output formats
- **Future extensibility**: Add volumetric rendering, neural upsampling, etc. without touching the main UI

---

## High-Level Strategy

### Core Architecture

```
┌─────────────────────────┐
│   Main Thread (UI)       │
│  ┌─────────────────────┐ │
│  │  Master Controller  │ │
│  │  - Algorithm picker │ │
│  │  - Config panel     │ │
│  │  - Stats display    │ │
│  │  - Output canvas    │ │
│  └──────┬──────────────┘ │
└─────────┼────────────────┘
          │ postMessage()
    ┌─────▼──────────────────────────┐
    │  Worker Pool (Algorithm)        │
    ├─────────────────────────────────┤
    │ Worker 1: V1 Refined            │
    │ Worker 2: V3 GLSL               │
    │ Worker 3: V6 WebGPU             │
    │ Worker N: Effect Pipeline       │
    └─────────────────────────────────┘
          │ sendMessage()
          │ Bitmap Rendering Results
    ┌─────▼──────────────────────────┐
    │  OffscreenCanvas (Compositing)  │
    │  - Tone mapping                 │
    │  - Color grading                │
    │  - Multi-output blending        │
    └─────────────────────────────────┘
          │ transferImageData()
    ┌─────▼──────────────────────────┐
    │  Canvas (Display)               │
    └─────────────────────────────────┘
```

### Key Differences from Plan B

| Aspect | Plan B | Plan C |
|--------|--------|--------|
| **Threading** | Single thread (main) | Multi-threaded (main + workers) |
| **Rendering** | Synchronous in render loop | Async in workers, results posted |
| **Error handling** | Try/catch on main | Worker errors don't crash main |
| **Concurrency** | Single algorithm per frame | Multiple algorithms per frame |
| **A/B Comparison** | Manual switching | Simultaneous side-by-side |
| **Recording** | Stats only | Full frame history + progressive refinement |
| **Extensibility** | Schema-driven configs | Message protocol + custom handlers |
| **Scalability** | Limited by single thread | Limited by CPU core count |

---

## Architecture Details

### Message Protocol

All communication is **stateless, serializable, and versioned**:

```typescript
// Main → Worker

type WorkerMessage =
  | InitMessage        // Initialize worker with device/canvas
  | ConfigMessage      // Update algorithm parameters
  | RenderMessage      // Request frame render
  | ResetMessage       // Reset algorithm state
  | QueryStatsMessage  // Get current stats
  | DisposeMessage;    // Cleanup and exit

// Worker → Main

type WorkerResult =
  | InitResult         // Worker ready
  | FrameResult        // Rendered frame data
  | StatsResult        // Performance/quality metrics
  | ErrorResult;       // Something went wrong
```

### Worker Interface

Each worker is a **thin script** that:

1. Receives init with device/canvas
2. Loads module (v1, v3, v6, etc.)
3. Enters a message loop
4. Renders on demand
5. Posts results back to main

```typescript
// worker.ts (template for all workers)

import { module as algorithmModule } from "./module.ts";

let renderer: AlgoRenderer | null = null;
let device: GPUDevice | null = null;
let canvas: HTMLCanvasElement | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  try {
    if (msg.type === "init") {
      device = msg.device;
      canvas = msg.canvas;
      renderer = await algorithmModule.create(device, canvas, msg.source);
      self.postMessage({ type: "init-result", success: true });
    } else if (msg.type === "config") {
      if (renderer) {
        await renderer.setConfig(msg.config);
      }
    } else if (msg.type === "render") {
      if (renderer) {
        await renderer.render(msg.timestamp);
        const imageData = getCanvasImage(canvas!);
        self.postMessage(
          {
            type: "frame",
            imageData,
            stats: renderer.getStats(),
          },
          [imageData.data.buffer] // Transfer ownership
        );
      }
    } else if (msg.type === "query-stats") {
      if (renderer) {
        self.postMessage({
          type: "stats",
          stats: renderer.getStats(),
        });
      }
    } else if (msg.type === "reset") {
      if (renderer) {
        await renderer.reset();
      }
    } else if (msg.type === "dispose") {
      if (renderer) {
        renderer.dispose();
      }
      self.close();
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error),
    });
  }
};
```

### Main Controller

The main thread manages a **pool of workers** and coordinates rendering:

```typescript
class WorkerPool {
  workers: Map<AlgoName, Worker> = new Map();
  results: Map<AlgoName, FrameResult> = new Map();

  async addWorker(algo: AlgoName, scriptPath: string): Promise<void> {
    const worker = new Worker(scriptPath);

    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.type === "frame") {
        this.results.set(algo, event.data);
      }
    };

    this.workers.set(algo, worker);
  }

  postMessage(algo: AlgoName, msg: WorkerMessage): void {
    const worker = this.workers.get(algo);
    if (worker) {
      worker.postMessage(msg);
    }
  }

  async renderAll(timestamp: number): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [algo, worker] of this.workers) {
      const promise = new Promise<void>((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.data.algo === algo && event.data.type === "frame") {
            worker.removeEventListener("message", handler);
            resolve();
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage({ type: "render", timestamp });
      });

      promises.push(promise);
    }

    await Promise.all(promises);
  }
}
```

### Output Composition

Results from workers are **composited** into the final canvas:

```typescript
class CompositeRenderer {
  private device: GPUDevice;
  private offscreenCanvas: OffscreenCanvas;
  private pipeline: GPUComputePipeline;

  async blend(
    results: Map<AlgoName, FrameResult>,
    mode: "sideBySide" | "blend" | "splitScreen"
  ): Promise<ImageData> {
    // Composite multiple algorithm outputs
    // - Side-by-side: two algorithms on left/right halves
    // - Blend: weighted average of N algorithms
    // - Split-screen: diagonal or other partition

    const output = new ImageData(this.width, this.height);
    const outputData = new Uint8ClampedArray(output.data);

    for (const [algo, result] of results) {
      const weight = this.getWeight(algo, mode);
      this.blendInto(outputData, result.imageData, weight);
    }

    return output;
  }
}
```

---

## Implementation Phases

### Phase 1: Worker Infrastructure (2 hours)

#### 1a. Message Protocol Types

**File**: `worker/message-protocol.ts`

```typescript
export type MessageType =
  | "init"
  | "config"
  | "render"
  | "query-stats"
  | "reset"
  | "dispose";

export type ResultType =
  | "init-result"
  | "frame"
  | "stats"
  | "error";

export interface InitMessage {
  type: "init";
  device: GPUDevice;
  canvas: OffscreenCanvas;
  source: string; // Shader source
}

export interface ConfigMessage {
  type: "config";
  config: RuntimeConfig;
}

export interface RenderMessage {
  type: "render";
  timestamp: number;
}

export interface QueryStatsMessage {
  type: "query-stats";
}

export interface ResetMessage {
  type: "reset";
}

export interface DisposeMessage {
  type: "dispose";
}

export type WorkerMessage =
  | InitMessage
  | ConfigMessage
  | RenderMessage
  | QueryStatsMessage
  | ResetMessage
  | DisposeMessage;

export interface FrameResult {
  type: "frame";
  imageData: ImageData;
  stats: Stats;
  algo: AlgoName;
  timestamp: number;
}

export interface StatsResult {
  type: "stats";
  stats: Stats;
}

export interface ErrorResult {
  type: "error";
  message: string;
  stack?: string;
}

export type WorkerResult = FrameResult | StatsResult | ErrorResult;
```

#### 1b. Worker Pool

**File**: `core/worker-pool.ts`

```typescript
class WorkerPool {
  private workers: Map<AlgoName, Worker> = new Map();
  private pendingResults: Map<
    string,
    { resolve: Function; reject: Function }
  > = new Map();

  async addWorker(algo: AlgoName, scriptPath: string): Promise<void> {
    const worker = new Worker(scriptPath, { type: "module" });

    worker.onerror = (event: ErrorEvent) => {
      console.error(`Worker ${algo} error:`, event);
    };

    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const { data } = event;
      const resultId = `${algo}-${data.type}`;

      if (data.type === "error") {
        const pending = this.pendingResults.get(resultId);
        if (pending) {
          pending.reject(new Error(data.message));
          this.pendingResults.delete(resultId);
        }
      } else {
        const pending = this.pendingResults.get(resultId);
        if (pending) {
          pending.resolve(data);
          this.pendingResults.delete(resultId);
        }
      }
    };

    this.workers.set(algo, worker);
  }

  postMessage(algo: AlgoName, msg: WorkerMessage): Promise<WorkerResult> {
    const worker = this.workers.get(algo);
    if (!worker) throw new Error(`No worker for ${algo}`);

    const resultId = `${algo}-${msg.type}`;

    return new Promise((resolve, reject) => {
      this.pendingResults.set(resultId, { resolve, reject });

      try {
        worker.postMessage(msg);
      } catch (error) {
        this.pendingResults.delete(resultId);
        reject(error);
      }
    });
  }

  async renderAll(
    algorithms: AlgoName[],
    timestamp: number
  ): Promise<Map<AlgoName, FrameResult>> {
    const promises = algorithms.map((algo) =>
      this.postMessage(algo, { type: "render", timestamp }).then(
        (result) => [algo, result as FrameResult] as const
      )
    );

    const results = await Promise.all(promises);
    return new Map(results);
  }

  dispose(algo: AlgoName): Promise<void> {
    return this.postMessage(algo, { type: "dispose" }).then(() =>
      this.workers.delete(algo)
    );
  }

  disposeAll(): Promise<void[]> {
    return Promise.all(
      Array.from(this.workers.keys()).map((algo) => this.dispose(algo))
    );
  }
}
```

### Phase 2: Composition & Output (1.5 hours)

#### 2a. Composite Renderer

**File**: `core/composite-renderer.ts`

```typescript
type CompositeMode = "sideBySide" | "blend" | "grid" | "splitScreen";

class CompositeRenderer {
  private device: GPUDevice;
  private offscreenCanvas: OffscreenCanvas;
  private context: GPUCanvasContext;
  private width: number;
  private height: number;

  constructor(device: GPUDevice, width: number, height: number) {
    this.device = device;
    this.width = width;
    this.height = height;

    this.offscreenCanvas = new OffscreenCanvas(width, height);
    this.context = this.offscreenCanvas.getContext("webgpu")!;
  }

  async composite(
    results: Map<AlgoName, FrameResult>,
    mode: CompositeMode
  ): Promise<ImageData> {
    const algos = Array.from(results.keys());

    if (algos.length === 1) {
      return results.get(algos[0])!.imageData;
    }

    if (mode === "sideBySide") {
      return this.compositeSideBySide(results, algos);
    } else if (mode === "blend") {
      return this.compositeBlend(results, algos);
    } else if (mode === "grid") {
      return this.compositeGrid(results, algos);
    } else if (mode === "splitScreen") {
      return this.compositeSplitScreen(results, algos);
    }

    throw new Error(`Unknown composite mode: ${mode}`);
  }

  private compositeSideBySide(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData {
    const output = new ImageData(this.width, this.height);
    const outputData = new Uint8ClampedArray(output.data);

    const halfWidth = Math.floor(this.width / algos.length);

    for (let i = 0; i < algos.length; i++) {
      const algo = algos[i];
      const result = results.get(algo)!;
      const inputData = result.imageData.data;

      const offsetX = i * halfWidth;

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < halfWidth; x++) {
          const inputIdx = ((y * this.width + x) % this.width) * 4;
          const outputIdx = (y * this.width + (offsetX + x)) * 4;

          outputData[outputIdx] = inputData[inputIdx];
          outputData[outputIdx + 1] = inputData[inputIdx + 1];
          outputData[outputIdx + 2] = inputData[inputIdx + 2];
          outputData[outputIdx + 3] = inputData[inputIdx + 3];
        }
      }
    }

    return output;
  }

  private compositeBlend(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData {
    const output = new ImageData(this.width, this.height);
    const outputData = new Float32Array(output.data.buffer);

    const weight = 1.0 / algos.length;

    for (const algo of algos) {
      const result = results.get(algo)!;
      const inputData = result.imageData.data;

      for (let i = 0; i < inputData.length; i++) {
        outputData[i] += (inputData[i] / 255.0) * weight;
      }
    }

    // Convert back to uint8
    for (let i = 0; i < outputData.length; i++) {
      outputData[i] = Math.min(outputData[i] * 255, 255);
    }

    return output;
  }

  private compositeGrid(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData {
    // N-way grid (2x2, 3x2, etc.)
    const cols = Math.ceil(Math.sqrt(algos.length));
    const rows = Math.ceil(algos.length / cols);

    const cellWidth = Math.floor(this.width / cols);
    const cellHeight = Math.floor(this.height / rows);

    const output = new ImageData(this.width, this.height);
    const outputData = new Uint8ClampedArray(output.data);

    for (let i = 0; i < algos.length; i++) {
      const algo = algos[i];
      const result = results.get(algo)!;
      const inputData = result.imageData.data;

      const row = Math.floor(i / cols);
      const col = i % cols;

      const offsetX = col * cellWidth;
      const offsetY = row * cellHeight;

      for (let y = 0; y < cellHeight; y++) {
        for (let x = 0; x < cellWidth; x++) {
          const inputIdx = ((y * this.width + x) % this.width) * 4;
          const outputIdx =
            ((offsetY + y) * this.width + (offsetX + x)) * 4;

          outputData[outputIdx] = inputData[inputIdx];
          outputData[outputIdx + 1] = inputData[inputIdx + 1];
          outputData[outputIdx + 2] = inputData[inputIdx + 2];
          outputData[outputIdx + 3] = inputData[inputIdx + 3];
        }
      }
    }

    return output;
  }

  private compositeSplitScreen(
    results: Map<AlgoName, FrameResult>,
    algos: AlgoName[]
  ): ImageData {
    // Diagonal split
    const output = new ImageData(this.width, this.height);
    const outputData = new Uint8ClampedArray(output.data);

    const algo0 = results.get(algos[0])!.imageData.data;
    const algo1 = results.get(algos[1])!.imageData.data;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const isBelowDiagonal = y > (x * this.height) / this.width;
        const inputData = isBelowDiagonal ? algo1 : algo0;

        const inputIdx = (y * this.width + x) * 4;
        const outputIdx = (y * this.width + x) * 4;

        outputData[outputIdx] = inputData[inputIdx];
        outputData[outputIdx + 1] = inputData[inputIdx + 1];
        outputData[outputIdx + 2] = inputData[inputIdx + 2];
        outputData[outputIdx + 3] = inputData[inputIdx + 3];
      }
    }

    return output;
  }
}
```

### Phase 3: Timeline Recorder (1.5 hours)

**File**: `core/timeline-recorder.ts`

```typescript
interface TimelineFrame {
  timestamp: number;
  frameIndex: number;
  results: Map<AlgoName, FrameResult>;
  composited: ImageData;
}

class TimelineRecorder {
  private frames: TimelineFrame[] = [];
  private maxFrames: number = 3600; // 1 minute at 60 FPS
  private isRecording: boolean = false;
  private frameIndex: number = 0;

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
    composited: ImageData
  ): void {
    if (!this.isRecording) return;

    const frame: TimelineFrame = {
      timestamp,
      frameIndex: this.frameIndex++,
      results,
      composited,
    };

    this.frames.push(frame);

    // Ring buffer: remove oldest if exceeded max
    if (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }

  getFrame(index: number): TimelineFrame | null {
    return this.frames[index] || null;
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  // Export timeline as video-like data (for playback or WebCodecs)
  async exportAsVideo(codec: "vp9" | "av1" = "vp9"): Promise<Blob> {
    // Use MediaRecorder or WebCodecs API
    // This is a stub; full implementation depends on browser support
    throw new Error("exportAsVideo not yet implemented");
  }

  // Export individual frames
  exportFrame(index: number): Blob | null {
    const frame = this.frames[index];
    if (!frame) return null;

    const canvas = document.createElement("canvas");
    canvas.width = frame.composited.width;
    canvas.height = frame.composited.height;

    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(frame.composited, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
  }
}
```

### Phase 4: Main App (1.5 hours)

**File**: `app.ts`

```typescript
import { ModuleRegistry } from "./core/module-registry.ts";
import { SchemaRenderer } from "./core/schema-renderer.ts";
import { WorkerPool } from "./core/worker-pool.ts";
import { CompositeRenderer } from "./core/composite-renderer.ts";
import { TimelineRecorder } from "./core/timeline-recorder.ts";

type AppState = {
  registry: ModuleRegistry;
  workerPool: WorkerPool;
  compositeRenderer: CompositeRenderer;
  timelineRecorder: TimelineRecorder;

  activeAlgos: AlgoName[];
  compositeMode: CompositeMode;
  configs: Map<AlgoName, RuntimeConfig>;

  canvas: HTMLCanvasElement;
  device: GPUDevice;

  isRunning: boolean;
  frameCount: number;
};

let state: AppState;

async function initApp(): Promise<void> {
  // Setup WebGPU
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();

  const canvas = document.querySelector("canvas")!;

  // Setup worker pool
  const workerPool = new WorkerPool();
  await workerPool.addWorker("v1_refined", "./workers/v1-worker.ts");
  await workerPool.addWorker("v6_webgpu", "./workers/v6-worker.ts");

  // Setup state
  state = {
    registry: new ModuleRegistry(),
    workerPool,
    compositeRenderer: new CompositeRenderer(device, 1440, 720),
    timelineRecorder: new TimelineRecorder(),

    activeAlgos: ["v1_refined"],
    compositeMode: "sideBySide",
    configs: new Map(),

    canvas,
    device,

    isRunning: true,
    frameCount: 0,
  };

  // Initialize configs
  for (const algo of state.activeAlgos) {
    const module = state.registry.getModule(algo);
    state.configs.set(
      algo,
      SchemaRenderer.getDefaultConfig(module.configSchema)
    );
  }

  // Start render loop
  renderLoop();

  // UI handlers
  document.querySelector("#algo-selector")?.addEventListener("change", (e) => {
    const algo = (e.target as HTMLSelectElement).value as AlgoName;
    toggleAlgorithm(algo);
  });

  document.querySelector("#composite-mode")?.addEventListener("change", (e) => {
    state.compositeMode = (e.target as HTMLSelectElement)
      .value as CompositeMode;
  });

  document
    .querySelector("#record-btn")
    ?.addEventListener("click", () => {
      state.timelineRecorder.startRecording();
    });

  document
    .querySelector("#stop-record-btn")
    ?.addEventListener("click", () => {
      state.timelineRecorder.stopRecording();
    });
}

async function toggleAlgorithm(algo: AlgoName): Promise<void> {
  const index = state.activeAlgos.indexOf(algo);

  if (index >= 0) {
    // Remove
    state.activeAlgos.splice(index, 1);
    await state.workerPool.dispose(algo);
  } else {
    // Add
    state.activeAlgos.push(algo);

    const module = state.registry.getModule(algo);
    const source = await fetch(
      `./shaders/${algo}.wgsl`
    ).then((r) => r.text());

    const offscreenCanvas = new OffscreenCanvas(1440, 720);
    await state.workerPool.addWorker(algo, `./workers/${algo}-worker.ts`);

    state.configs.set(algo, SchemaRenderer.getDefaultConfig(module.configSchema));
  }
}

async function renderLoop(): Promise<void> {
  const timestamp = performance.now();

  if (state.isRunning) {
    try {
      // Render all active algorithms concurrently
      const results = await state.workerPool.renderAll(
        state.activeAlgos,
        timestamp
      );

      // Composite results
      const composited = await state.compositeRenderer.composite(
        results,
        state.compositeMode
      );

      // Record frame (if recording)
      state.timelineRecorder.addFrame(timestamp, results, composited);

      // Display on canvas
      const ctx = state.canvas.getContext("2d")!;
      ctx.putImageData(composited, 0, 0);

      state.frameCount++;
    } catch (error) {
      console.error("Render error:", error);
    }
  }

  requestAnimationFrame(renderLoop);
}

initApp().catch(console.error);
```

### Phase 5: HTML & Styling (30 minutes)

**File**: `index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Glass Gradients - Worker System</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <h1>Glass Gradients</h1>
      <div id="controls">
        <label>
          View Mode:
          <select id="composite-mode">
            <option value="sideBySide">Side by Side</option>
            <option value="blend">Blend</option>
            <option value="grid">Grid</option>
            <option value="splitScreen">Split Screen</option>
          </select>
        </label>

        <label>
          Algorithms:
          <select id="algo-selector" multiple>
            <option value="v1_refined">V1 Refined</option>
            <option value="v3_glsl">V3 GLSL</option>
            <option value="v6_webgpu">V6 WebGPU</option>
          </select>
        </label>

        <button id="record-btn">Record</button>
        <button id="stop-record-btn">Stop</button>
        <button id="export-btn">Export Timeline</button>
      </div>
    </header>

    <main>
      <canvas id="canvas" width="1440" height="720"></canvas>
      <aside id="sidebar">
        <div id="config-container"></div>
        <div id="stats-container"></div>
      </aside>
    </main>

    <script src="app.ts" type="module"></script>
  </body>
</html>
```

---

## Key Design Decisions

### Decision 1: Workers vs. Shared Memory

**Chosen**: Workers with message passing.
- Simplicity and debugging
- Better error isolation
- No SharedArrayBuffer complexity

**Alternative**: Use SharedArrayBuffer for zero-copy rendering (faster but harder to debug).

### Decision 2: Composition in GPU vs. CPU

**Chosen**: CPU (ImageData manipulation).
- Flexibility (any composite mode)
- Easier debugging
- Good enough for UI feedback

**Future**: Move to GPU compute if performance becomes an issue.

### Decision 3: Timeline Recording

**Chosen**: In-memory ring buffer with manual export.
- Flexible (can choose format at export time)
- Simple memory management
- No hidden disk writes

**Alternative**: Stream to disk or use MediaRecorder (more complex).

---

## Advanced Features (Optional)

### A/B Comparison

Enable side-by-side rendering of two algorithms with synchronized controls:

```typescript
function enableABComparison(algoA: AlgoName, algoB: AlgoName): void {
  state.activeAlgos = [algoA, algoB];
  state.compositeMode = "splitScreen";

  // Sync config changes across both
  document.querySelector("#config-container")?.addEventListener("input", (e) => {
    const key = (e.target as HTMLInputElement).name;
    const value = (e.target as HTMLInputElement).value;

    state.configs.get(algoA)![key] = value;
    state.configs.get(algoB)![key] = value;

    // Post updates to workers
  });
}
```

### Progressive Refinement Visualization

Display convergence over time:

```typescript
class ProgressiveRenderer {
  private convergenceHistory: Map<AlgoName, number[]> = new Map();

  recordConvergence(algo: AlgoName, frameIndex: number, stats: Stats): void {
    if (!this.convergenceHistory.has(algo)) {
      this.convergenceHistory.set(algo, []);
    }

    this.convergenceHistory.get(algo)!.push(stats.confident || 0);
  }

  plotConvergence(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    for (const [algo, history] of this.convergenceHistory) {
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = (i / history.length) * canvas.width;
        const y = canvas.height * (1 - history[i]);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    return canvas;
  }
}
```

---

## Testing Strategy

### Unit Tests

- Worker message protocol serialization
- Composite renderer pixel-perfect accuracy
- Timeline recorder memory management
- Worker pool error handling

### Integration Tests

- Concurrent render of 3+ algorithms
- Timeline recording 1000+ frames without OOM
- Algorithm switching during recording
- Export/import timeline data

### Load Tests

- 60 FPS on 4K with 4 algorithms
- Memory growth over 10 minutes of recording
- Worker spawn/destroy overhead

---

## Success Criteria

- ✅ Multiple algorithms render concurrently without interference
- ✅ A/B comparison works (split-screen, blend modes)
- ✅ Timeline records 3600+ frames without OOM
- ✅ Worker errors don't crash main thread
- ✅ Frame rate stays above 30 FPS (target: 60 FPS)
- ✅ Composite modes are pixel-perfect
- ✅ Export timeline as video or frames
- ✅ Main thread 99% idle (all work in workers)

---

## Migration Path

If Plan B is already implemented:

1. Extract algorithm rendering into `v{N}-worker.ts` files
2. Create `WorkerPool` and post/receive messages
3. Replace synchronous render loop with async worker coordination
4. Add `CompositeRenderer` and `TimelineRecorder`

This is a **significant refactor** but leverages all of Plan B's schemas and config structure.

