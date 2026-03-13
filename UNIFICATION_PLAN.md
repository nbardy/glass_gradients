# Unified Glass Gradients UI - Final Plan

**Goal**: Single HTML page with algorithm picker dropdown. Reuse v1_refined's UI/stats. Swap algorithms without touching UI code.

**Timeline**: 2–3 hours

**Approach**: Minimal wrapping. Each algorithm becomes a `Renderer` class. Main app selects and calls.

---

## Architecture (Simple)

```
index.html
  ├─ Algorithm picker dropdown
  ├─ Canvas
  ├─ <form id="controls"> — semantic HTML (no styling)
  └─ <div id="stats-panel">

app.ts
  ├─ AlgoRenderer interface (compile, render, getStats, dispose)
  ├─ V1Renderer, V6Renderer wrappers
  ├─ DenseControls init (transforms HTML into UI)
  └─ Main loop + event handlers

algorithms/
  ├─ v1/
  │   └─ glass_pipeline.ts — function(device, canvas, config) → renderer
  ├─ v6/
  │   └─ composite_pipeline.ts — function(device, canvas, config) → renderer
  ├─ v3/ → STUB (follow-up)
  └─ v4/ → STUB (follow-up)
```

---

## Implementation Steps

### 1. Create Base Renderer Interface (10 min)

**File**: `core/renderer.ts`

```typescript
export interface AlgoRenderer {
  name: string;
  render(timestamp: number): Promise<void>;
  getStats(): Record<string, any>;
  dispose(): void;
}
```

That's it. All compile logic goes in the pipeline function.

---

### 2. Extract V1 Pipeline Function (30 min)

**File**: `algorithms/v1/glass_pipeline.ts`

Take existing v1_refined_webgpu logic and extract into a single exported function:

```typescript
export async function v1GlassPipeline(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  shaderSource: string,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  // All setup happens here
  const module = device.createShaderModule({ code: shaderSource });
  const pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module, entryPoint: "main_compute" },
  });

  // Create buffers, accumulators, etc.
  let stats: Record<string, any> = {};

  // Return renderer object with render() and getStats()
  return {
    name: "v1_refined",
    async render(timestamp: number) {
      // Existing v1 render logic
      // Accumulate stats as you go
      stats = { fps: ..., confident: ..., spp: ... };
    },
    getStats() {
      return stats;
    },
    dispose() {
      // Cleanup
    },
  };
}
```

**Benefits**:
- V1 owns all its memory (pipeline, buffers, etc.)
- Single entry point
- Easy to swap or replace

---

### 3. Extract V6 Pipeline Function (30 min)

**File**: `algorithms/v6/composite_pipeline.ts`

```typescript
export async function v6CompositePipeline(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  shaderSource: string,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  // Setup atmosphere precompute, glass precompute, etc.
  let stats: Record<string, any> = {};
  let skyviewDirty = true;

  return {
    name: "v6_webgpu",
    async render(timestamp: number) {
      if (skyviewDirty) {
        // Precompute atmosphere
        skyviewDirty = false;
      }
      // Run composite
      stats = { fps: ..., frameMs: ... };
    },
    getStats() {
      return stats;
    },
    dispose() {
      // Cleanup
    },
  };
}
```

---

### 4. Stub V3 & V4 as Follow-Ups

**File**: `algorithms/v3/glass_pipeline.ts` (STUB)

```typescript
export async function v3GlassPipeline(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  shaderSource: string,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  throw new Error("V3 not yet integrated — requires GLSL→WGSL transcription");
}
```

**Note**: V3 and V4 will need shader transcription (GLSL → WGSL) + WebGL2→WebGPU adapter work. **Leave for follow-up.**

---

### 5. Create Unified App (45 min)

**File**: `app.ts`

```typescript
import { DenseControls } from "./lib/dense-controls/dense-controls.js";
import { v1GlassPipeline } from "./algorithms/v1/glass_pipeline.ts";
import { v6CompositePipeline } from "./algorithms/v6/composite_pipeline.ts";
import type { AlgoRenderer } from "./core/renderer.ts";

type AlgoName = "v1_refined" | "v6_webgpu";

interface AlgoMeta {
  name: AlgoName;
  label: string;
  pipeline: (device: GPUDevice, canvas: HTMLCanvasElement, source: string, config: Record<string, any>) => Promise<AlgoRenderer>;
  shaderPath: string;
  defaultConfig: Record<string, any>;
}

const ALGORITHMS: Record<AlgoName, AlgoMeta> = {
  v1_refined: {
    name: "v1_refined",
    label: "V1 Refined",
    pipeline: v1GlassPipeline,
    shaderPath: "./v1_refined_webgpu/renderer.wgsl",
    defaultConfig: {
      baseSamples: 4,
      maxSamples: 32,
      targetError: 0.05,
    },
  },
  v6_webgpu: {
    name: "v6_webgpu",
    label: "V6 WebGPU",
    pipeline: v6CompositePipeline,
    shaderPath: "./v6_webgpu/composite.wgsl",
    defaultConfig: {
      exposure: 1.0,
    },
  },
};

interface AppState {
  renderer: AlgoRenderer | null;
  device: GPUDevice;
  canvas: HTMLCanvasElement;
  currentAlgo: AlgoName;
  config: Record<string, any>;
  controls: DenseControls | null;
}

let state: AppState = {
  renderer: null,
  device: null!,
  canvas: null!,
  currentAlgo: "v1_refined",
  config: {},
  controls: null,
};

async function init() {
  const adapter = await navigator.gpu.requestAdapter();
  state.device = await adapter!.requestDevice();
  state.canvas = document.querySelector("canvas") as HTMLCanvasElement;

  // Populate algorithm picker
  const picker = document.querySelector("#algo-picker") as HTMLSelectElement;
  for (const [algoName, meta] of Object.entries(ALGORITHMS)) {
    const option = document.createElement("option");
    option.value = algoName;
    option.textContent = meta.label;
    picker.appendChild(option);
  }

  picker.addEventListener("change", async (e) => {
    await switchAlgorithm((e.target as HTMLSelectElement).value as AlgoName);
  });

  // Load first algorithm
  await switchAlgorithm("v1_refined");

  // Start render loop
  renderLoop();
}

async function switchAlgorithm(algoName: AlgoName) {
  // Cleanup old
  if (state.renderer) {
    state.renderer.dispose();
  }
  if (state.controls) {
    state.controls.destroy();
  }

  const meta = ALGORITHMS[algoName];

  // Load shader
  const source = await fetch(meta.shaderPath).then((r) => r.text());

  // Initialize config
  state.config = { ...meta.defaultConfig };

  // Create renderer (handles all setup internally)
  state.renderer = await meta.pipeline(
    state.device,
    state.canvas,
    source,
    state.config
  );

  state.currentAlgo = algoName;

  // Setup controls using DenseControls
  const controlForm = document.querySelector("#controls") as HTMLFormElement;
  controlForm.innerHTML = ""; // Clear old controls

  // Build semantic HTML for this algo's controls
  for (const [key, defaultValue] of Object.entries(meta.defaultConfig)) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = key;

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = String(defaultValue);
    input.setAttribute("setting", key);

    label.appendChild(span);
    label.appendChild(input);
    controlForm.appendChild(label);
  }

  // Initialize DenseControls on the form
  state.controls = DenseControls.init(controlForm, {
    keyAttr: "setting",
  });

  // Listen for control changes
  state.controls.on("change", (key: string, value: any) => {
    state.config[key] = value;
    // Note: Pushing config to renderer would require adding
    // a setConfig(config) method to AlgoRenderer
    // Deferring for now — renderer reads from state.config on init only
  });
}

function renderLoop() {
  requestAnimationFrame(async (ts) => {
    if (state.renderer) {
      try {
        await state.renderer.render(ts);

        // Update stats display
        const stats = state.renderer.getStats();
        const statsContainer = document.querySelector("#stats-panel") as HTMLElement;
        statsContainer.innerHTML = "";

        for (const [key, value] of Object.entries(stats)) {
          const card = document.createElement("div");
          card.className = "stat-card";

          const label = document.createElement("span");
          label.textContent = key;

          const valueEl = document.createElement("strong");
          valueEl.textContent =
            typeof value === "number" ? value.toFixed(2) : String(value);

          card.appendChild(label);
          card.appendChild(valueEl);
          statsContainer.appendChild(card);
        }
      } catch (error) {
        console.error("Render error:", error);
      }
    }

    renderLoop();
  });
}

init();
```

---

### 6. Create HTML & CSS (15 min)

**File**: `index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Glass Gradients</title>
    <link rel="stylesheet" href="../lib/dense-controls/dense-controls.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <h1>Glass Gradients</h1>
      <select id="algo-picker"></select>
    </header>

    <main>
      <canvas id="canvas" width="1440" height="720"></canvas>

      <aside>
        <!-- Controls form (DenseControls will transform at init) -->
        <form id="controls"></form>

        <!-- Stats display (populated by render loop) -->
        <div id="stats-panel"></div>
      </aside>
    </main>

    <script src="app.ts" type="module"></script>
  </body>
</html>
```

**File**: `styles.css`

```css
* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
  padding: 0;
  background: #1a1a1a;
  color: #fff;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #222;
  border-bottom: 1px solid #333;
}

header h1 {
  margin: 0;
  font-size: 1.2em;
}

#algo-picker {
  padding: 6px 12px;
  background: #333;
  color: #fff;
  border: 1px solid #555;
  border-radius: 4px;
  font-size: 0.9em;
  cursor: pointer;
}

main {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 12px;
  padding: 12px;
  height: calc(100vh - 60px);
}

canvas {
  border-radius: 8px;
  background: #000;
  display: block;
}

aside {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

#controls {
  background: #222;
  padding: 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* DenseControls will add .dc-bar, .dc-toggle, etc. classes */
/* Keep semantic HTML structure — library handles all styling */

#stats-panel {
  background: #222;
  padding: 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.9em;
}

.stat-card {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #333;
}

.stat-card:last-child {
  border-bottom: none;
}

.stat-card span {
  color: #aaa;
}

.stat-card strong {
  font-family: "Courier New", monospace;
  color: #0f0;
}
```

---

## Checklist

- [ ] **Create `core/renderer.ts`** – Minimal interface (just render, getStats, dispose)
- [ ] **Extract `algorithms/v1/glass_pipeline.ts`** – Move v1_refined logic into pipeline function
- [ ] **Extract `algorithms/v6/composite_pipeline.ts`** – Move v6 logic into pipeline function
- [ ] **Stub `algorithms/v3/glass_pipeline.ts`** – Throw "not yet integrated"
- [ ] **Stub `algorithms/v4/glass_pipeline.ts`** – Throw "not yet integrated"
- [ ] **Create `app.ts`** – Use DenseControls library, switch via pipeline functions
- [ ] **Create `index.html`** – Link dense-controls.css, semantic form HTML
- [ ] **Create `styles.css`** – Layout only (dense-controls handles control styling)
- [ ] **Test v1 render** – No crashes, see stats update
- [ ] **Test v6 render** – No crashes, see stats update
- [ ] **Test switching** – v1 → v6 → v1 without crash, controls regenerate
- [ ] **Test DenseControls** – Sliders appear as filled bars, checkboxes as toggles

---

## Known Limitations (Acceptable)

1. **Config changes don't re-render**: Sliders update but don't push to running renderer
   - Workaround: Restart algorithm to pick up new config
   - Can add hot-update later if needed

2. **V3 & V4 not integrated**: Stubbed; requires GLSL→WGSL + WebGL2→WebGPU adapter
   - Leave as **follow-up task**

3. **No timeline recording or A/B modes**: MVP is single-algo at a time
   - Add later if needed

4. **Basic error handling**: try/catch only; can improve

---

## Success Criteria

✅ Single HTML page loads without errors
✅ Algorithm picker dropdown populates and changes algo
✅ V1 and V6 both render and show stats
✅ Switching v1 ↔ v6 doesn't crash
✅ DenseControls transforms ranges into filled bars
✅ Controls panel regenerates when algo changes
✅ Stats panel updates every frame
✅ Frame rate >30 FPS on both algos
✅ No GPU validation errors

---

## V3 & V4 Status

**V3 (GLSL)**: Single-pass gradient renderer
- Requires: GLSL shader → WGSL transcription (172 lines, should be straightforward)
- Requires: Hyperparams (SAMPLES, etaR, etaG, etaB) → uniform buffer layout
- **Effort**: ~1 hour if shader transcription is straightforward
- **Status**: Not critical for MVP; leave as follow-up

**V4 (WebGL2)**: Multi-pass renderer
- Requires: WebGL2 context (can't share canvas with WebGPU)
- Requires: Either keep separate canvas OR use WebGL2→WebGPU adapter
- **Effort**: ~2 hours to set up dual-context or adapter
- **Status**: Lower priority; leave as follow-up

**Recommendation**: **Finish v1 + v6 MVP first. Then tackle V3 (easier), then V4 (harder).**

---

## Future Enhancements (Don't Do Now)

1. Hot-update config (without restarting renderer)
2. V3 GLSL integration
3. V4 WebGL2 integration
4. Shared effect pipeline (tone mapping, color grading)
5. Timeline recording (frame capture for comparison)
6. A/B comparison modes (side-by-side rendering)

**Focus on MVP first.** Everything else is optional.

