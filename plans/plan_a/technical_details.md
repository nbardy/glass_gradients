# Plan A: Technical Implementation Details

## Overview

This document provides step-by-step implementation guidance for Plan A's minimal UI unification approach. Plan A achieves algorithm swapping with minimal code changes by reusing the HTML structure from v1_refined and adding a simple dispatcher layer.

---

## Architecture Decision Record

### Why This Approach Works

1. **Reuses proven UI**: v1_refined's control panel and stats dashboard are production-tested
2. **Minimal coupling**: Each algorithm stays mostly unchanged—just wrapped in an interface
3. **Fast iteration**: No abstraction overhead; easy to debug and tweak
4. **Straightforward testing**: Each renderer wrapper can be tested independently

### Key Assumption

All algorithms can be represented as a `GPUDevice`-based renderer with:
- A shader source file (local or remote)
- A hyperparameter config schema
- A stats schema
- Compile, render, reset, and dispose methods

This assumption holds for v1_refined, v3 (via WebGL2→WebGPU adapter), v4 (via WebGL2→WebGPU adapter), and v6.

---

## Implementation Sequence

### Phase 1: Scaffold (30 min)

**Goal**: Set up the basic folder structure and type definitions.

#### 1a. Create index.html

Start with v1_refined's `index.html` as the base. Add:
- A dropdown menu for algorithm selection (id="algo-picker")
- A config section (id="config-container")
- A stats section (id="stats-container")
- A canvas (id="canvas")
- A hidden error panel (id="error-log")

```html
<div id="controls">
  <label>Algorithm:
    <select id="algo-picker">
      <option value="v1_refined">V1 Refined</option>
      <option value="v3_glsl">V3 GLSL</option>
      <option value="v4_webgl2">V4 WebGL2</option>
      <option value="v6_webgpu">V6 WebGPU</option>
    </select>
  </label>
</div>

<div id="config-container"></div>
<div id="stats-container"></div>
<canvas id="canvas"></canvas>
<div id="error-log" hidden></div>
```

#### 1b. Create app.ts

Define the config types and loader functions. Start with the signatures from `final_spec.md`:

```typescript
const ALGO_CONFIGS: AllConfigs = {
  v1_refined: { ... },
  v3_glsl: { ... },
  v4_webgl2: { ... },
  v6_webgpu: { ... },
};

const ALGO_STAT_CARDS: Record<AlgoName, StatCardDef[]> = {
  v1_refined: [ ... ],
  v3_glsl: [ ... ],
  v4_webgl2: [ ... ],
  v6_webgpu: [ ... ],
};
```

### Phase 2: Renderer Wrappers (1.5 hours)

**Goal**: Create one wrapper class per algorithm, all implementing `AlgoRenderer`.

#### 2a. V1Renderer

Location: `v1_refined_webgpu/renderer.ts` (new file)

Copy the render logic from `v1_refined_webgpu/app.js` into a class:

```typescript
class V1Renderer implements AlgoRenderer {
  name = "v1_refined";
  config = ALGO_CONFIGS.v1_refined;
  statCards = ALGO_STAT_CARDS.v1_refined;

  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;
  private pipeline: GPUComputePipeline;
  private stats: Stats = {};

  // Constructor and initialization
  private constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;
    this.canvas = canvas;
  }

  static async create(
    device: GPUDevice,
    source: string,
    canvas: HTMLCanvasElement
  ): Promise<V1Renderer> {
    const renderer = new V1Renderer(device, canvas);
    await renderer.compile(device, source);
    return renderer;
  }

  async compile(device: GPUDevice, source: string): Promise<void> {
    const shaderModule = device.createShaderModule({ code: source });
    this.pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main_compute" },
    });
  }

  async render(timestamp: number): Promise<void> {
    // Move render logic from v1_refined_webgpu/app.js here
    // Include per-pixel stats accumulation
    // Update this.stats with fps, frameMs, spp, confident, parked, etc.
  }

  getStats(): Stats {
    return this.stats;
  }

  reset(): Promise<void> {
    // Clear buffers, reset accumulators
  }

  dispose(): void {
    // Clean up GPU resources
  }
}
```

**Key Challenge**: V1's stats depend on internal buffer state (sample counts, variance, etc.). You'll need to:
1. Map GPU buffer readback logic to extract per-pixel stats
2. Aggregate into global counters (confident %, parked %, average SPP)
3. Cache stats in `this.stats` to avoid synchronous GPU stalls

**Solution**: Create a `StatsAggregator` helper:

```typescript
class StatsAggregator {
  confident: number = 0;  // pixels > threshold
  parked: number = 0;     // pixels clamped at max spp
  adaptive: number = 0;   // pixels actively sampling
  darkUnresolved: number = 0;
  brightUnresolved: number = 0;
  averageSpp: number = 0;
  fps: number = 0;

  update(buffer: GPUBuffer, bufferSize: number): void {
    // Device.queue.copyExternalImageToTexture or buffer.getMappedRange() logic
    // Iterate over per-pixel data and count
  }
}
```

#### 2b. V3Renderer

Location: `v3/renderer.ts` (new file)

V3 is a pure GLSL fragment shader. To use it in a WebGPU context, you have two options:

**Option A (Recommended)**: Transcribe v3 GLSL to WGSL (fragment shader → compute shader)
- Pro: Native WebGPU, full control
- Con: GLSL→WGSL translation requires care (especially texture lookups, I/O)

**Option B (Fallback)**: Use WebGL2 context alongside WebGPU (dual-context)
- Pro: No transcription needed
- Con: Canvas contention, two GPU pipelines, increased memory
- Works but is messier for a unified UI

Recommend **Option A**. V3's math is deterministic; the shader is short (172 lines).

```typescript
class V3Renderer implements AlgoRenderer {
  name = "v3_glsl";
  config = ALGO_CONFIGS.v3_glsl;
  statCards = ALGO_STAT_CARDS.v3_glsl;

  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private pipeline: GPURenderPipeline;
  private stats: Stats = { fps: 60 }; // No per-pixel adaptive stats; flat constant

  static async create(
    device: GPUDevice,
    source: string, // WGSL-transcribed V3 shader
    canvas: HTMLCanvasElement
  ): Promise<V3Renderer> {
    const renderer = new V3Renderer(device, canvas);
    await renderer.compile(device, source);
    return renderer;
  }

  async compile(device: GPUDevice, source: string): Promise<void> {
    // V3 is a single-pass deterministic renderer; no accumulation
    // Compile as render pipeline
  }

  async render(timestamp: number): Promise<void> {
    // Single quad pass; no stats accumulation
    // Frame time ~ 0.3ms (constant)
  }

  getStats(): Stats {
    return this.stats;
  }

  reset(): Promise<void> {
    // No state to reset (stateless single-pass)
  }

  dispose(): void {}
}
```

**Challenge**: V3's hyperparams (SAMPLES, etaR, etaG, etaB, etc.) are shader constants. To support runtime control:

1. Use uniform buffers instead of `#define` in the shader
2. Create a uniform binding in the render pipeline
3. Update the buffer on config change

```wgsl
// v3.wgsl (top level)
struct Params {
  samples: u32,
  etaR: f32,
  etaG: f32,
  etaB: f32,
  microRoughness: f32,
};

@group(0) @binding(0) var<uniform> P: Params;

@fragment
fn main(...) -> @location(0) vec4f {
  // Use P.samples, P.etaR, etc. in the shader
}
```

Then in the renderer:

```typescript
async setUniform(key: string, value: number | boolean): Promise<void> {
  const offset = this.paramOffsets[key];
  const view = new Float32Array(this.uniformBuffer.getMappedRange());
  if (typeof value === "number") {
    view[offset] = value;
  }
  // ...
}
```

#### 2c. V4Renderer

V4 is WebGL2. To integrate:

**Recommended Approach**: Create a lightweight WebGL2→WebGPU adapter.

```typescript
class V4Renderer implements AlgoRenderer {
  name = "v4_webgl2";
  config = ALGO_CONFIGS.v4_webgl2;
  statCards = ALGO_STAT_CARDS.v4_webgl2;

  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private stats: Stats = {};

  static async create(
    device: GPUDevice, // ignored; V4 uses WebGL2
    source: string,
    canvas: HTMLCanvasElement
  ): Promise<V4Renderer> {
    const gl = canvas.getContext("webgl2")!;
    const renderer = new V4Renderer(gl);
    await renderer.compile(gl, source);
    return renderer;
  }

  async compile(gl: WebGL2RenderingContext, source: string): Promise<void> {
    // Compile fragment shader + fullscreen quad
  }

  async render(timestamp: number): Promise<void> {
    // Draw fullscreen quad; measure frame time
  }

  getStats(): Stats {
    return { fps: 60, frameMs: 0.3 };
  }

  reset(): Promise<void> {}

  dispose(): void {}
}
```

**Challenge**: V4 and V6 will contend for the same canvas context. You can't have both WebGL2 and WebGPU on the same canvas. **Solution**: Dynamically acquire/release contexts based on which algorithm is selected.

```typescript
async switchRenderer(
  oldRenderer: AlgoRenderer | null,
  newAlgo: AlgoName,
  canvas: HTMLCanvasElement
): Promise<AlgoRenderer> {
  if (oldRenderer) {
    oldRenderer.dispose();
  }

  // If switching from WebGLx to WebGPU or vice versa, re-request context
  const device = await navigator.gpu.requestAdapter()?.requestDevice()!;

  switch (newAlgo) {
    case "v1_refined":
    case "v6_webgpu":
      return createRenderer(newAlgo, device, canvas);
    case "v3_glsl":
    case "v4_webgl2":
      // These currently only have WebGL2 implementations
      // Either skip them or provide WebGL2-context versions
      throw new Error(
        `${newAlgo} requires WebGL2 context; not yet integrated.`
      );
  }
}
```

#### 2d. V6Renderer

Location: `v6/renderer.ts` (new file)

V6 is the most complex. It has precompute steps:

```typescript
class V6Renderer implements AlgoRenderer {
  name = "v6_webgpu";
  config = ALGO_CONFIGS.v6_webgpu;
  statCards = ALGO_STAT_CARDS.v6_webgpu;

  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private compositePipeline: GPUComputePipeline;
  private stats: Stats = {};
  private atmosphereDirty = true;
  private glassDirty = true;

  static async create(
    device: GPUDevice,
    source: string,
    canvas: HTMLCanvasElement
  ): Promise<V6Renderer> {
    const renderer = new V6Renderer(device, canvas);
    await renderer.compileComposite(device, source);
    return renderer;
  }

  async compile(device: GPUDevice, source: string): Promise<void> {
    // Compile composite.wgsl (hot path)
    // NOTE: skyview.wgsl and glass-precompute.wgsl are precompute—defer
  }

  async render(timestamp: number): Promise<void> {
    if (this.atmosphereDirty) {
      await this.precomputeAtmosphere();
      this.atmosphereDirty = false;
    }

    if (this.glassDirty) {
      await this.precomputeGlass();
      this.glassDirty = false;
    }

    // Run composite pass
    await this.runComposite();
  }

  private async precomputeAtmosphere(): Promise<void> {
    // Compile + run skyview.wgsl
    // Generate mip chain
  }

  private async precomputeGlass(): Promise<void> {
    // Compile + run glass-precompute.wgsl
  }

  private async runComposite(): Promise<void> {
    // Execute composite pipeline every frame
  }

  getStats(): Stats {
    return this.stats;
  }

  reset(): Promise<void> {
    this.atmosphereDirty = true;
    this.glassDirty = true;
  }

  dispose(): void {}
}
```

**Critical Note**: V6's glass precompute has a **coordinate-space bug** (documented in `v6/CORRECTIONS.md`). The current implementation outputs window-space shifts but the composite expects sky-domain UV offsets. **This must be fixed before v6 can render correctly.**

### Phase 3: UI Layer (30 min)

**Goal**: Wire the renderer selection and config updates.

#### 3a. Config Manager

```typescript
function renderControlsPanel(
  container: HTMLElement,
  algo: AlgoName,
  config: RuntimeConfig,
  onConfigChange: (key: string, value: any) => void
): void {
  container.innerHTML = "";
  const algoDef = ALGO_CONFIGS[algo];

  for (const key in algoDef) {
    const def = algoDef[key];
    const value = config[key];

    if (def.type === "number") {
      const label = document.createElement("label");
      label.innerHTML = `
        <span>${def.label}</span>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}">
        <span class="value">${value}</span>
      `;
      const input = label.querySelector("input") as HTMLInputElement;
      input.addEventListener("input", (e) => {
        const newValue = parseFloat((e.target as HTMLInputElement).value);
        label.querySelector(".value")!.textContent = String(newValue);
        onConfigChange(key, newValue);
      });
      container.appendChild(label);
    } else if (def.type === "checkbox") {
      const label = document.createElement("label");
      label.innerHTML = `
        <input type="checkbox" ${value ? "checked" : ""}>
        <span>${def.label}</span>
      `;
      const input = label.querySelector("input") as HTMLInputElement;
      input.addEventListener("change", (e) => {
        onConfigChange(key, (e.target as HTMLInputElement).checked);
      });
      container.appendChild(label);
    }
  }
}
```

#### 3b. Algorithm Switcher

```typescript
async function switchAlgorithm(
  newAlgo: AlgoName,
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  currentRenderer: AlgoRenderer | null
): Promise<AlgoRenderer> {
  // Fetch shader source
  const source = await loadShaderSource(newAlgo);

  // Dispose old renderer
  if (currentRenderer) {
    currentRenderer.dispose();
  }

  // Create new renderer
  const renderer = await createRenderer(newAlgo, device, canvas);

  // Reset UI
  const defaultConfig = getDefaultConfig(newAlgo);
  document.getElementById("config-container")!.innerHTML = "";
  renderControlsPanel(
    document.getElementById("config-container")!,
    newAlgo,
    defaultConfig,
    (key, value) => {
      defaultConfig[key] = value;
      applyConfig(renderer, defaultConfig);
    }
  );

  return renderer;
}
```

#### 3c. Event Wiring

```typescript
const algoPicker = document.getElementById("algo-picker") as HTMLSelectElement;
algoPicker.addEventListener("change", async (e) => {
  const newAlgo = (e.target as HTMLSelectElement).value as AlgoName;
  renderer = await switchAlgorithm(newAlgo, device, canvas, renderer);
});
```

### Phase 4: Main Loop (15 min)

**Goal**: Frame loop with stats rendering.

```typescript
function renderLoop(
  renderer: AlgoRenderer,
  statsContainer: HTMLElement
): void {
  requestAnimationFrame((ts) => {
    renderer.render(ts).then(() => {
      const stats = renderer.getStats();
      const algo = (document.getElementById("algo-picker") as HTMLSelectElement)
        .value as AlgoName;

      renderStatsPanel(statsContainer, algo, stats);
    });

    renderLoop(renderer, statsContainer);
  });
}
```

---

## Key Challenges & Solutions

### Challenge 1: Stats Aggregation from GPU

**Problem**: Per-pixel stats are stored in GPU buffers. Reading them back synchronously stalls the frame.

**Solution A (Recommended)**: Maintain a shadow CPU copy.
- During compute, write stats to a storage buffer
- Every N frames, async-copy to staging buffer and read
- Aggregate into global stats

```typescript
async captureStats(): Promise<void> {
  const stagingBuffer = this.device.createBuffer({
    size: this.statsBuffer.size,
    mappedAtCreation: false,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const commandEncoder = this.device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(
    this.statsBuffer,
    0,
    stagingBuffer,
    0,
    this.statsBuffer.size
  );
  this.device.queue.submit([commandEncoder.finish()]);

  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const view = new Uint32Array(stagingBuffer.getMappedRange());
  // Parse and aggregate
  stagingBuffer.unmap();
}
```

**Solution B**: Only capture stats on manual "snapshot" request (not every frame).

### Challenge 2: Shader Source Loading

**Problem**: Each algorithm has shaders in different directories with different formats.

**Solution**: Implement a manifest of shader paths.

```typescript
const SHADER_PATHS: Record<AlgoName, string> = {
  v1_refined: "./v1_refined_webgpu/renderer.wgsl",
  v3_glsl: "./v3/renderer.wgsl", // transcribed from GLSL
  v4_webgl2: "./v4/shader.glsl",
  v6_webgpu: "./v6/composite.wgsl",
};

async function loadShaderSource(algo: AlgoName): Promise<string> {
  const path = SHADER_PATHS[algo];
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load shader: ${path}`);
  }
  return response.text();
}
```

### Challenge 3: Context Contention (WebGL2 vs WebGPU)

**Problem**: Can't have both WebGL2 and WebGPU active on the same canvas.

**Solution**: Dynamically switch contexts.

```typescript
function getContext(
  canvas: HTMLCanvasElement,
  type: "webgpu" | "webgl2"
): GPUDevice | WebGL2RenderingContext {
  if (type === "webgpu") {
    // This is async, must be awaited
    return navigator.gpu.requestAdapter()?.requestDevice();
  } else {
    return canvas.getContext("webgl2")!;
  }
}
```

On algorithm switch, destroy the old context and acquire the new one. **This requires canvas recreation in some browsers.**

### Challenge 4: Uniform Buffer Management

**Problem**: Each algorithm has different hyperparameters and uniform layouts.

**Solution**: Create a per-renderer uniform buffer with a layout map.

```typescript
type UniformLayout = {
  [key: string]: { offset: number; size: "f32" | "u32" | "i32" };
};

class UniformManager {
  buffer: GPUBuffer;
  layout: UniformLayout;
  stagingBuffer: Float32Array;

  constructor(device: GPUDevice, layout: UniformLayout) {
    const bufferSize = Math.ceil(Object.values(layout).reduce(...) / 16) * 16;
    this.buffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    this.stagingBuffer = new Float32Array(this.buffer.getMappedRange());
    this.buffer.unmap();
  }

  set(key: string, value: number | boolean): void {
    const { offset } = this.layout[key];
    this.stagingBuffer[offset] = value ? 1 : 0;
  }

  flush(device: GPUDevice): void {
    device.queue.writeBuffer(this.buffer, 0, this.stagingBuffer);
  }
}
```

---

## Testing Strategy

### Unit Tests

1. **Config Validation**: Test `validateConfig()` with valid/invalid ranges.
   ```typescript
   const valid = validateConfig("v1_refined", { baseSamples: 4 });
   expect(valid).toBe(true);

   const invalid = validateConfig("v1_refined", { baseSamples: 100 });
   expect(invalid).toBe(false);
   ```

2. **Renderer Creation**: Test that each renderer initializes without crashing.
   ```typescript
   for (const algo of ALGO_NAMES) {
     const renderer = await createRenderer(algo, device, canvas);
     expect(renderer.name).toBe(algo);
     renderer.dispose();
   }
   ```

3. **Stats Output**: Verify stats have expected keys.
   ```typescript
   const stats = renderer.getStats();
   expect(stats.fps).toBeGreaterThan(0);
   expect(stats.confident).toBeDefined();
   ```

### Integration Tests

1. **Algorithm Switching**: Start with one algo, switch to another, verify no crashes.
2. **Parameter Updates**: Change a hyperparameter, verify the frame updates.
3. **Stats Consistency**: Run each algo for 100 frames, verify stats are plausible.

### Manual Testing Checklist

- [ ] All four algorithms load without error
- [ ] Controls update on slider/checkbox change
- [ ] Switching algorithms preserves canvas and re-renders
- [ ] Stats panel updates every frame
- [ ] No GPU validation errors in console
- [ ] Frame rate stays above 30 FPS on target hardware

---

## Build & Deployment

### Development

```bash
# Install dependencies (if using TS)
npm install

# TypeScript build
npx tsc app.ts

# Serve locally
python -m http.server 8000
# Or
npx http-server
```

### Production

- Minify all TypeScript/JavaScript
- Use tree-shaking to remove unused renderers (if they're optional)
- Serve shaders as static assets (no inline)
- Enable HTTP/2 Server Push for shader files

---

## Open Decisions

1. **Transcribe V3 GLSL to WGSL or keep dual WebGL2 context?**
   - Recommendation: Transcribe. Cleaner, no context contention.

2. **V4 integration: Dual context or skip for now?**
   - Recommendation: Skip in Phase 1. Add V4 in a follow-up if needed.
   - V4 is a near-duplicate of V3 anyway (both are single-pass analyticscanners).

3. **Stats granularity: Every frame or sampled every N frames?**
   - Recommendation: Sample every 10 frames to avoid GPU readback stalls.

4. **Error handling: Throw or graceful fallback?**
   - Recommendation: Throw on shader compile error; catch at top level and display in UI.

---

## Success Criteria

- ✅ User can select algorithm from dropdown
- ✅ Config panel updates per algorithm
- ✅ Stats panel refreshes every frame
- ✅ All four algorithms render without crashes
- ✅ Frame time is reasonable (>30 FPS on 1440p)
- ✅ Shader compile errors display user-friendly messages
- ✅ Switching algorithms cleans up old GPU resources

