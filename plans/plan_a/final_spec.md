# Plan A: Final Spec - Types & Function Signatures

## Core Types

```ts
// Hyperparameter definition
type HyperParamDef = {
  min: number
  max: number
  step: number
  label: string
  type: "number" | "checkbox" | "select"
  options?: string[]  // for select type
}

// Config for a single algorithm
type AlgoConfig = {
  [key: string]: HyperParamDef
}

// All algorithm configs
type AllConfigs = {
  v1_refined: AlgoConfig
  v3_glsl: AlgoConfig
  v4_webgl2: AlgoConfig
  v6_webgpu: AlgoConfig
}

// Runtime values (what user has set)
type RuntimeConfig = {
  [key: string]: number | boolean
}

// Stats emitted by renderer
type Stats = {
  fps?: number
  frameMs?: number
  spp?: number
  confident?: number
  parked?: number
  adaptive?: number
  brightUnresolved?: number
  darkUnresolved?: number
  // v6-specific:
  atmosphereDirty?: boolean
  glassDirty?: boolean
  [key: string]: any
}

// UI stat card definition
type StatCardDef = {
  id: string
  label: string
  valueKey: string  // which key in Stats to read
  format?: (value: any) => string  // custom formatting
  unit?: string
}

// Algorithm interface
interface AlgoRenderer {
  name: string
  config: AlgoConfig
  statCards: StatCardDef[]

  compile(device: GPUDevice, source: string): Promise<void>
  render(timestamp: number): Promise<void>
  reset(): Promise<void>
  dispose(): void
  getStats(): Stats
}

// Algo selection
type AlgoName = "v1_refined" | "v3_glsl" | "v4_webgl2" | "v6_webgpu"
```

---

## Core Functions

### Config System

```ts
// Load all algorithm configs
function loadAlgoConfigs(): AllConfigs {
  return {
    v1_refined: {
      baseSamples: { min: 1, max: 16, step: 1, label: "Base Samples", type: "number" },
      maxSamples: { min: 1, max: 32, step: 1, label: "Max Samples", type: "number" },
      targetError: { min: 0.01, max: 0.2, step: 0.01, label: "Target Error", type: "number" },
      varianceBoost: { min: 1.0, max: 3.0, step: 0.1, label: "Variance Boost", type: "number" },
      outlierK: { min: 1.0, max: 5.0, step: 0.1, label: "Outlier K", type: "number" },
      exposure: { min: 0.5, max: 2.0, step: 0.05, label: "Exposure", type: "number" },
      adaptiveSampling: { type: "checkbox", label: "Adaptive Sampling" },
      staticScene: { type: "checkbox", label: "Static Scene" },
    },
    v3_glsl: {
      SAMPLES: { min: 4, max: 128, step: 4, label: "Samples", type: "number" },
      etaR: { min: 0.6, max: 0.9, step: 0.01, label: "Eta R", type: "number" },
      etaG: { min: 0.6, max: 0.9, step: 0.01, label: "Eta G", type: "number" },
      etaB: { min: 0.6, max: 0.9, step: 0.01, label: "Eta B", type: "number" },
      microRoughness: { min: 0.01, max: 0.3, step: 0.01, label: "Roughness", type: "number" },
    },
    // ... v4, v6
  }
}

// Get default runtime config for an algo
function getDefaultConfig(algo: AlgoName): RuntimeConfig {
  const algoDef = ALGO_CONFIGS[algo]
  const runtime: RuntimeConfig = {}
  for (const key in algoDef) {
    const def = algoDef[key]
    if (def.type === "checkbox") {
      runtime[key] = true
    } else {
      runtime[key] = def.min
    }
  }
  return runtime
}

// Validate config against definition
function validateConfig(algo: AlgoName, config: RuntimeConfig): boolean {
  const algoDef = ALGO_CONFIGS[algo]
  for (const key in algoDef) {
    const def = algoDef[key]
    const value = config[key]
    if (def.type === "number") {
      if (typeof value !== "number" || value < def.min || value > def.max) {
        return false
      }
    }
  }
  return true
}
```

### UI Generation

```ts
// Render controls panel from config
function renderControlsPanel(
  container: HTMLElement,
  algo: AlgoName,
  config: RuntimeConfig,
  onConfigChange: (key: string, value: any) => void
): void {
  container.innerHTML = ""
  const algoDef = ALGO_CONFIGS[algo]

  for (const key in algoDef) {
    const def = algoDef[key]
    const value = config[key]

    if (def.type === "number") {
      const label = document.createElement("label")
      label.innerHTML = `
        <span>${def.label}</span>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}">
        <span class="value">${value}</span>
      `
      const input = label.querySelector("input") as HTMLInputElement
      input.addEventListener("input", (e) => {
        const newValue = parseFloat((e.target as HTMLInputElement).value)
        label.querySelector(".value")!.textContent = String(newValue)
        onConfigChange(key, newValue)
      })
      container.appendChild(label)
    } else if (def.type === "checkbox") {
      const label = document.createElement("label")
      label.innerHTML = `
        <input type="checkbox" ${value ? "checked" : ""}>
        <span>${def.label}</span>
      `
      const input = label.querySelector("input") as HTMLInputElement
      input.addEventListener("change", (e) => {
        onConfigChange(key, (e.target as HTMLInputElement).checked)
      })
      container.appendChild(label)
    }
  }
}

// Render stats cards
function renderStatsPanel(
  container: HTMLElement,
  algo: AlgoName,
  stats: Stats
): void {
  container.innerHTML = ""
  const statDefs = ALGO_STAT_CARDS[algo]

  for (const def of statDefs) {
    const value = stats[def.valueKey]
    const formatted = def.format ? def.format(value) : String(value)

    const card = document.createElement("div")
    card.className = "metric-card"
    card.innerHTML = `
      <span class="metric-label">${def.label}</span>
      <strong class="metric-value">${formatted} ${def.unit || ""}</strong>
    `
    container.appendChild(card)
  }
}
```

### Renderer Selection & Compilation

```ts
// Load shader source
async function loadShaderSource(algo: AlgoName): Promise<string> {
  const paths: Record<AlgoName, string> = {
    v1_refined: "./v1_refined_webgpu/renderer.wgsl",
    v3_glsl: "./v3/shader.glsl",
    v4_webgl2: "./v4/shader.glsl",
    v6_webgpu: "./v6/composite.wgsl",  // simplified
  }
  const response = await fetch(paths[algo])
  return response.text()
}

// Create renderer for algo
async function createRenderer(
  algo: AlgoName,
  device: GPUDevice | WebGLRenderingContext,
  canvas: HTMLCanvasElement
): Promise<AlgoRenderer> {
  const source = await loadShaderSource(algo)

  switch (algo) {
    case "v1_refined":
      return V1Renderer.create(device as GPUDevice, source, canvas)
    case "v3_glsl":
      return V3Renderer.create(device as WebGLRenderingContext, source, canvas)
    case "v4_webgl2":
      return V4Renderer.create(device as WebGLRenderingContext, source, canvas)
    case "v6_webgpu":
      return V6Renderer.create(device as GPUDevice, source, canvas)
  }
}

// Switch renderer
async function switchRenderer(
  oldRenderer: AlgoRenderer | null,
  newAlgo: AlgoName,
  device: GPUDevice | WebGLRenderingContext,
  canvas: HTMLCanvasElement
): Promise<AlgoRenderer> {
  if (oldRenderer) {
    oldRenderer.dispose()
  }
  return createRenderer(newAlgo, device, canvas)
}
```

### Main App Loop

```ts
// Main render loop
function renderLoop(
  renderer: AlgoRenderer,
  statsContainer: HTMLElement,
  timestamp: number
): void {
  requestAnimationFrame((ts) => {
    renderer.render(ts).then(() => {
      const stats = renderer.getStats()
      const algo = getCurrentAlgo()  // from UI state
      renderStatsPanel(statsContainer, algo, stats)
    })
    renderLoop(renderer, statsContainer, ts)
  })
}
```

---

## Renderer Wrapper Classes

Each algo gets a lightweight wrapper implementing `AlgoRenderer`:

```ts
class V1Renderer implements AlgoRenderer {
  name = "v1_refined"
  config = ALGO_CONFIGS.v1_refined
  statCards = ALGO_STAT_CARDS.v1_refined

  private device: GPUDevice
  private pipeline: GPUComputePipeline
  private stats: Stats = {}

  static async create(device: GPUDevice, source: string, canvas: HTMLCanvasElement): Promise<V1Renderer> {
    const renderer = new V1Renderer(device)
    await renderer.compile(device, source)
    return renderer
  }

  async compile(device: GPUDevice, source: string): Promise<void> {
    const shaderModule = device.createShaderModule({ code: source })
    this.pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main_compute" },
    })
  }

  async render(timestamp: number): Promise<void> {
    // v1-specific render code
  }

  getStats(): Stats {
    return this.stats
  }

  reset(): Promise<void> {
    // v1-specific reset
  }

  dispose(): void {
    // cleanup
  }
}
```

---

## Config Application

```ts
// Apply runtime config to shader uniforms
function applyConfig(renderer: AlgoRenderer, config: RuntimeConfig): void {
  // V1-specific:
  if (renderer.name === "v1_refined") {
    const v1 = renderer as V1Renderer
    v1.setUniform("baseSamples", config.baseSamples as number)
    v1.setUniform("maxSamples", config.maxSamples as number)
    v1.setUniform("targetError", config.targetError as number)
  }
  // V3-specific:
  else if (renderer.name === "v3_glsl") {
    const v3 = renderer as V3Renderer
    v3.setUniform("SAMPLES", config.SAMPLES as number)
    v3.setUniform("etaR", config.etaR as number)
    // ...
  }
}
```

---

## Error Handling

```ts
type CompileError = {
  algo: AlgoName
  shader: string
  error: string
  line?: number
}

function handleCompileError(err: CompileError): void {
  const errorLog = document.querySelector("#error-log")!
  errorLog.textContent = `${err.algo}: ${err.error}`
  if (err.line) {
    errorLog.textContent += ` (line ${err.line})`
  }
  errorLog.hidden = false
}
```

---

## Summary

**62 core function signatures across:**
- Config management (5)
- UI generation (3)
- Renderer lifecycle (5)
- Stats mapping (2)
- Wrappers per algo (4 × 6 = 24)
- Error handling (2)
- Main loop (2)
