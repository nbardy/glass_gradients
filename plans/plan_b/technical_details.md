# Plan B: Technical Implementation Details

## Overview

Plan B implements a **proper module architecture** where each algorithm is a self-contained package. The key difference from Plan A is that configuration and stats are **declarative** (defined in schemas) rather than hard-coded, and UI is **generated** from those schemas rather than manually written.

This guide walks through implementation step by step, with emphasis on the abstraction layers and how they enable zero-modification algorithm addition.

---

## Implementation Sequence

### Phase 1: Module Infrastructure (90 minutes)

#### 1a. Create Module Registry

**File**: `core/module-registry.ts`

```typescript
class ModuleRegistry {
  private modules: Map<AlgoName, AlgoModule> = new Map();

  async register(module: AlgoModule): Promise<void> {
    // Validate module metadata
    if (!module.name || !module.configSchema || !module.statsSchema) {
      throw new Error(`Module missing required fields`);
    }

    // Check required features (optional validation)
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) {
      for (const feature of module.requiredFeatures || []) {
        if (!adapter.features.has(feature)) {
          console.warn(
            `Module ${module.name} requires unsupported feature: ${feature}`
          );
        }
      }
    }

    this.modules.set(module.name, module);
  }

  getModule(algo: AlgoName): AlgoModule {
    const module = this.modules.get(algo);
    if (!module) throw new Error(`Unknown algorithm: ${algo}`);
    return module;
  }

  listModules(): AlgoModule[] {
    return Array.from(this.modules.values());
  }

  hasModule(algo: AlgoName): boolean {
    return this.modules.has(algo);
  }

  getAvailableModules(device: GPUDevice): AlgoModule[] {
    // Filter by supported features (if needed)
    return this.listModules();
  }
}
```

**Testing**:

```typescript
test("ModuleRegistry.register stores module", async () => {
  const registry = new ModuleRegistry();
  const testModule: AlgoModule = {
    name: "test",
    displayName: "Test",
    version: "1.0.0",
    description: "Test module",
    requiredFeatures: [],
    configSchema: [],
    statsSchema: [],
    create: async () => new FakeRenderer(),
  };
  await registry.register(testModule);
  expect(registry.hasModule("test")).toBe(true);
});
```

#### 1b. Create Schema Renderer

**File**: `core/schema-renderer.ts`

```typescript
class SchemaRenderer {
  static renderControls(
    container: HTMLElement,
    schema: HyperParamDef[],
    config: RuntimeConfig,
    onchange: (key: string, value: any) => void
  ): void {
    container.innerHTML = "";

    // Group by category if provided
    const grouped = this.groupByCategory(schema);

    for (const [category, items] of grouped) {
      if (category) {
        const categoryEl = document.createElement("fieldset");
        categoryEl.innerHTML = `<legend>${category}</legend>`;
        for (const def of items) {
          categoryEl.appendChild(
            this.createControl(def, config[def.key], (value) => {
              onchange(def.key, value);
            })
          );
        }
        container.appendChild(categoryEl);
      } else {
        for (const def of items) {
          container.appendChild(
            this.createControl(def, config[def.key], (value) => {
              onchange(def.key, value);
            })
          );
        }
      }
    }
  }

  static createControl(
    def: HyperParamDef,
    value: any,
    onchange: (value: any) => void
  ): HTMLElement {
    if (def.type === "number") {
      return this.createSlider(def, value, onchange);
    } else if (def.type === "checkbox") {
      return this.createCheckbox(def, value, onchange);
    } else if (def.type === "select") {
      return this.createDropdown(def, value, onchange);
    }
    throw new Error(`Unknown control type: ${def.type}`);
  }

  private static createSlider(
    def: HyperParamDef,
    value: number,
    onchange: (v: number) => void
  ): HTMLElement {
    const label = document.createElement("label");
    label.className = "control-slider";

    const span = document.createElement("span");
    span.textContent = def.label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(def.min ?? 0);
    input.max = String(def.max ?? 1);
    input.step = String(def.step ?? 0.01);
    input.value = String(value);

    const valueDisplay = document.createElement("span");
    valueDisplay.className = "value";
    valueDisplay.textContent = this.formatValue(def, value);

    input.addEventListener("input", () => {
      const newValue = parseFloat(input.value);
      valueDisplay.textContent = this.formatValue(def, newValue);
      onchange(newValue);
    });

    label.appendChild(span);
    label.appendChild(input);
    label.appendChild(valueDisplay);

    if (def.description) {
      const desc = document.createElement("small");
      desc.textContent = def.description;
      label.appendChild(desc);
    }

    return label;
  }

  private static createCheckbox(
    def: HyperParamDef,
    value: boolean,
    onchange: (v: boolean) => void
  ): HTMLElement {
    const label = document.createElement("label");
    label.className = "control-checkbox";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;

    const span = document.createElement("span");
    span.textContent = def.label;

    input.addEventListener("change", () => {
      onchange(input.checked);
    });

    label.appendChild(input);
    label.appendChild(span);

    return label;
  }

  private static createDropdown(
    def: HyperParamDef,
    value: string,
    onchange: (v: string) => void
  ): HTMLElement {
    const label = document.createElement("label");
    label.className = "control-select";

    const span = document.createElement("span");
    span.textContent = def.label;

    const select = document.createElement("select");
    for (const option of def.options || []) {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      if (option === value) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener("change", () => {
      onchange(select.value);
    });

    label.appendChild(span);
    label.appendChild(select);

    return label;
  }

  static renderStats(
    container: HTMLElement,
    statsSchema: StatCardDef[],
    stats: Stats
  ): void {
    container.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "stats-panel";

    for (const def of statsSchema) {
      const value = stats[def.valueKey];
      const card = this.createStatCard(def, value);
      panel.appendChild(card);
    }

    container.appendChild(panel);
  }

  static createStatCard(def: StatCardDef, value: any): HTMLElement {
    const card = document.createElement("div");
    card.className = "stat-card";

    const label = document.createElement("span");
    label.className = "stat-label";
    label.textContent = def.label;

    const valueEl = document.createElement("strong");
    valueEl.className = "stat-value";

    if (def.format) {
      valueEl.textContent = def.format(value);
    } else if (def.precision !== undefined) {
      valueEl.textContent = value?.toFixed(def.precision) ?? "—";
    } else {
      valueEl.textContent = String(value ?? "—");
    }

    if (def.unit) {
      const unit = document.createElement("span");
      unit.className = "stat-unit";
      unit.textContent = def.unit;
      valueEl.appendChild(unit);
    }

    card.appendChild(label);
    card.appendChild(valueEl);

    return card;
  }

  static validateConfig(
    schema: HyperParamDef[],
    config: RuntimeConfig
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const def of schema) {
      const value = config[def.key];

      if (value === undefined) {
        if (!def.defaultValue) {
          errors.push(`Missing required parameter: ${def.key}`);
        }
        continue;
      }

      if (def.type === "number") {
        if (typeof value !== "number") {
          errors.push(`${def.key} must be a number`);
          continue;
        }
        if (def.min !== undefined && value < def.min) {
          errors.push(`${def.key} must be >= ${def.min}`);
        }
        if (def.max !== undefined && value > def.max) {
          errors.push(`${def.key} must be <= ${def.max}`);
        }
      } else if (def.type === "checkbox") {
        if (typeof value !== "boolean") {
          errors.push(`${def.key} must be a boolean`);
        }
      } else if (def.type === "select") {
        if (!def.options?.includes(value as string)) {
          errors.push(
            `${def.key} must be one of: ${def.options?.join(", ")}`
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static getDefaultConfig(schema: HyperParamDef[]): RuntimeConfig {
    const config: RuntimeConfig = {};

    for (const def of schema) {
      if (def.defaultValue !== undefined) {
        config[def.key] = def.defaultValue;
      } else if (def.type === "number") {
        config[def.key] = def.min ?? 0;
      } else if (def.type === "checkbox") {
        config[def.key] = false;
      } else if (def.type === "select") {
        config[def.key] = def.options?.[0] ?? "";
      }
    }

    return config;
  }

  static groupByCategory(
    schema: HyperParamDef[]
  ): Map<string, HyperParamDef[]> {
    const grouped = new Map<string, HyperParamDef[]>();

    for (const def of schema) {
      const category = def.category || "General";
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(def);
    }

    return grouped;
  }

  private static formatValue(def: HyperParamDef, value: number): string {
    if (def.precision !== undefined) {
      return value.toFixed(def.precision);
    }
    return String(value);
  }
}
```

**Testing**:

```typescript
test("SchemaRenderer creates slider for number param", () => {
  const def: HyperParamDef = {
    key: "samples",
    label: "Samples",
    type: "number",
    min: 1,
    max: 32,
    step: 1,
  };

  const control = SchemaRenderer.createControl(def, 4, () => {});
  expect(control.querySelector("input[type=range]")).toBeTruthy();
});

test("SchemaRenderer validates config", () => {
  const schema: HyperParamDef[] = [
    { key: "samples", label: "Samples", type: "number", min: 1, max: 32 },
  ];

  const valid = SchemaRenderer.validateConfig(schema, { samples: 16 });
  expect(valid.valid).toBe(true);

  const invalid = SchemaRenderer.validateConfig(schema, { samples: 100 });
  expect(invalid.valid).toBe(false);
});
```

#### 1c. Create Stats Aggregator

**File**: `core/stats-aggregator.ts`

```typescript
class MultiAlgoStatsAggregator {
  private stats: Record<AlgoName, Stats> = {};
  private schemas: Record<AlgoName, StatCardDef[]> = {};
  private frameTimings: Record<AlgoName, number[]> = {};

  register(algo: AlgoName, schema: StatCardDef[]): void {
    this.schemas[algo] = schema;
    this.stats[algo] = {};
    this.frameTimings[algo] = [];
  }

  update(algo: AlgoName, newStats: Stats): void {
    this.stats[algo] = { ...newStats };

    // Track FPS over last 60 frames for smoothing
    if (newStats.fps) {
      this.frameTimings[algo].push(newStats.fps);
      if (this.frameTimings[algo].length > 60) {
        this.frameTimings[algo].shift();
      }
    }
  }

  getStats(algo: AlgoName): Stats {
    return this.stats[algo] ?? {};
  }

  getSmoothedFps(algo: AlgoName): number {
    const timings = this.frameTimings[algo] || [];
    if (timings.length === 0) return 0;
    return timings.reduce((a, b) => a + b, 0) / timings.length;
  }

  getSchema(algo: AlgoName): StatCardDef[] {
    return this.schemas[algo] ?? [];
  }

  render(container: HTMLElement, algo: AlgoName): void {
    const schema = this.getSchema(algo);
    const stats = this.getStats(algo);

    SchemaRenderer.renderStats(container, schema, stats);
  }
}
```

### Phase 2: Module Refactoring (120 minutes)

For each algorithm, create three files:

#### 2a. Schema File (per algorithm)

**File**: `v1_refined_webgpu/schema.ts`

```typescript
// v1_refined_webgpu/schema.ts

export const configSchema: HyperParamDef[] = [
  {
    key: "baseSamples",
    label: "Base Samples",
    type: "number",
    min: 1,
    max: 16,
    step: 1,
    category: "Adaptive Sampling",
    description: "Initial samples per pixel",
    defaultValue: 4,
  },
  {
    key: "maxSamples",
    label: "Max Samples",
    type: "number",
    min: 1,
    max: 64,
    step: 1,
    category: "Adaptive Sampling",
    description: "Maximum samples per pixel before parking",
    defaultValue: 32,
  },
  {
    key: "targetError",
    label: "Target Error",
    type: "number",
    min: 0.01,
    max: 0.5,
    step: 0.01,
    category: "Adaptive Sampling",
    defaultValue: 0.05,
  },
  {
    key: "adaptiveSampling",
    label: "Enable Adaptive Sampling",
    type: "checkbox",
    category: "Adaptive Sampling",
    defaultValue: true,
  },
  // ... more params
];

export const statsSchema: StatCardDef[] = [
  {
    id: "fps",
    label: "FPS",
    valueKey: "fps",
    unit: "Hz",
    precision: 1,
    category: "Performance",
  },
  {
    id: "frameMs",
    label: "Frame Time",
    valueKey: "frameMs",
    unit: "ms",
    precision: 2,
    category: "Performance",
  },
  {
    id: "spp",
    label: "Avg SPP",
    valueKey: "spp",
    unit: "samples",
    precision: 1,
    category: "Convergence",
  },
  {
    id: "confident",
    label: "Confident",
    valueKey: "confident",
    unit: "%",
    format: (v) => ((v || 0) * 100).toFixed(1),
    category: "Convergence",
  },
  // ... more stats
];
```

#### 2b. Module File (per algorithm)

**File**: `v1_refined_webgpu/module.ts`

```typescript
// v1_refined_webgpu/module.ts

import { configSchema, statsSchema } from "./schema.ts";
import { V1Renderer } from "./renderer.ts";

export const module: AlgoModule = {
  name: "v1_refined",
  displayName: "V1 Refined (WebGPU Adaptive)",
  version: "1.0.0",
  description:
    "Original bathroom glass with per-pixel adaptive sampling and convergence tracking",
  requiredFeatures: [],

  configSchema,
  statsSchema,

  async create(device, canvas, shaderSource) {
    return V1Renderer.create(device, canvas, shaderSource);
  },
};
```

Repeat for v3, v6 (v4 can be deferred).

#### 2c. Update Renderer Class

**File**: `v1_refined_webgpu/renderer.ts`

Ensure `V1Renderer` implements `AlgoRenderer`:

```typescript
class V1Renderer implements AlgoRenderer {
  name = "v1_refined";
  config = configSchema; // From schema.ts
  statCards = statsSchema; // From schema.ts

  private device: GPUDevice;
  private currentConfig: RuntimeConfig;

  // ... existing implementation ...

  async setConfig(config: RuntimeConfig): Promise<void> {
    this.currentConfig = config;
    // Update GPU uniforms
    await this.updateUniforms(config);
  }

  getConfig(): RuntimeConfig {
    return { ...this.currentConfig };
  }

  // ... rest of implementation ...
}
```

### Phase 3: App Infrastructure (90 minutes)

#### 3a. Config Management Utilities

**File**: `core/config.ts`

```typescript
export function getDefaultConfigFromSchema(
  schema: HyperParamDef[]
): RuntimeConfig {
  return SchemaRenderer.getDefaultConfig(schema);
}

export function validateConfig(
  schema: HyperParamDef[],
  config: RuntimeConfig
): boolean {
  return SchemaRenderer.validateConfig(schema, config).valid;
}

export function coerceConfig(
  schema: HyperParamDef[],
  config: Partial<RuntimeConfig>
): RuntimeConfig {
  const defaults = getDefaultConfigFromSchema(schema);
  return { ...defaults, ...config };
}

export function configEqual(a: RuntimeConfig, b: RuntimeConfig): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  if (keysA.some((k) => keysA[keysA.indexOf(k)] !== keysB[keysA.indexOf(k)])) {
    return false;
  }
  return keysA.every((k) => a[k] === b[k]);
}
```

#### 3b. Renderer Lifecycle

**File**: `core/renderer-lifecycle.ts`

```typescript
async function createRendererFromModule(
  module: AlgoModule,
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  shaderSource: string
): Promise<AlgoRenderer> {
  try {
    const renderer = await module.create(device, canvas, shaderSource);
    console.log(`Created renderer: ${module.name}`);
    return renderer;
  } catch (error) {
    console.error(`Failed to create renderer ${module.name}:`, error);
    throw error;
  }
}

async function switchRenderer(
  oldRenderer: AlgoRenderer | null,
  newModule: AlgoModule,
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  newShaderSource: string
): Promise<AlgoRenderer> {
  if (oldRenderer) {
    oldRenderer.dispose();
    console.log(`Disposed renderer: ${oldRenderer.name}`);
  }

  return createRendererFromModule(
    newModule,
    device,
    canvas,
    newShaderSource
  );
}

async function applyConfigToRenderer(
  renderer: AlgoRenderer,
  config: RuntimeConfig
): Promise<void> {
  const validation = SchemaRenderer.validateConfig(renderer.config, config);
  if (!validation.valid) {
    throw new Error(`Config validation failed: ${validation.errors.join("; ")}`);
  }
  await renderer.setConfig(config);
}

async function resetRenderer(renderer: AlgoRenderer): Promise<void> {
  await renderer.reset();
  console.log(`Reset renderer: ${renderer.name}`);
}
```

### Phase 4: Main App (60 minutes)

**File**: `app.ts`

```typescript
// Very thin app layer

import { ModuleRegistry } from "./core/module-registry.ts";
import { SchemaRenderer } from "./core/schema-renderer.ts";
import { MultiAlgoStatsAggregator } from "./core/stats-aggregator.ts";
import { switchRenderer, applyConfigToRenderer, resetRenderer } from "./core/renderer-lifecycle.ts";

import { module as v1Module } from "./v1_refined_webgpu/module.ts";
import { module as v3Module } from "./v3_glsl/module.ts";
import { module as v6Module } from "./v6_webgpu/module.ts";

type AppState = {
  renderer: AlgoRenderer | null;
  module: AlgoModule | null;
  config: RuntimeConfig;
  device: GPUDevice;
  canvas: HTMLCanvasElement;
  statsAggregator: MultiAlgoStatsAggregator;
  registry: ModuleRegistry;
  frameCount: number;
  isRunning: boolean;
};

let state: AppState;

async function initApp(): Promise<void> {
  // Get canvas and device
  const canvas = document.querySelector("canvas")!;
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();

  // Create registry
  const registry = new ModuleRegistry();
  await registry.register(v1Module);
  await registry.register(v3Module);
  await registry.register(v6Module);

  // Create state
  state = {
    renderer: null,
    module: null,
    config: {},
    device,
    canvas,
    statsAggregator: new MultiAlgoStatsAggregator(),
    registry,
    frameCount: 0,
    isRunning: true,
  };

  // Populate picker
  const picker = document.querySelector("#algo-picker") as HTMLSelectElement;
  for (const module of registry.listModules()) {
    const option = document.createElement("option");
    option.value = module.name;
    option.textContent = module.displayName;
    picker.appendChild(option);
  }

  // Select first algorithm
  await switchAlgorithm(state, registry.listModules()[0].name);

  // Start render loop
  renderLoop(state);

  // Event handlers
  picker.addEventListener("change", async (e) => {
    const algoName = (e.target as HTMLSelectElement).value as AlgoName;
    await switchAlgorithm(state, algoName);
  });

  document.querySelector("#reset-btn")?.addEventListener("click", async () => {
    if (state.renderer) {
      await resetRenderer(state.renderer);
    }
  });

  document.querySelector("#pause-btn")?.addEventListener("click", () => {
    state.isRunning = !state.isRunning;
    const btn = document.querySelector("#pause-btn") as HTMLButtonElement;
    btn.textContent = state.isRunning ? "Pause" : "Resume";
  });
}

async function switchAlgorithm(state: AppState, algoName: AlgoName): Promise<void> {
  const module = state.registry.getModule(algoName);
  const shaderSource = await fetch(`./shaders/${algoName}.wgsl`).then((r) =>
    r.text()
  );

  state.renderer = await switchRenderer(
    state.renderer,
    module,
    state.device,
    state.canvas,
    shaderSource
  );

  state.module = module;
  state.config = SchemaRenderer.getDefaultConfig(module.configSchema);

  // Update UI
  const configContainer = document.querySelector("#config-container")!;
  SchemaRenderer.renderControls(
    configContainer,
    module.configSchema,
    state.config,
    async (key, value) => {
      state.config[key] = value;
      if (state.renderer) {
        try {
          await applyConfigToRenderer(state.renderer, state.config);
        } catch (error) {
          console.error("Config update failed:", error);
        }
      }
    }
  );

  // Register stats
  state.statsAggregator.register(algoName, module.statsSchema);
}

function renderLoop(state: AppState): void {
  requestAnimationFrame(async (ts) => {
    if (state.isRunning && state.renderer) {
      try {
        await state.renderer.render(ts);
        state.frameCount++;

        const stats = state.renderer.getStats();
        state.statsAggregator.update(
          state.module!.name as AlgoName,
          stats
        );

        state.statsAggregator.render(
          document.querySelector("#stats-container")!,
          state.module!.name as AlgoName
        );
      } catch (error) {
        console.error("Render error:", error);
        document.querySelector("#error-log")!.textContent = String(error);
      }
    }

    renderLoop(state);
  });
}

initApp().catch(console.error);
```

### Phase 5: CSS & HTML (30 minutes)

**File**: `index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Glass Gradients - Unified Renderer</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="app">
      <header>
        <h1>Glass Gradients</h1>
        <div id="controls">
          <select id="algo-picker"></select>
          <button id="reset-btn">Reset</button>
          <button id="pause-btn">Pause</button>
        </div>
      </header>

      <main>
        <canvas id="canvas"></canvas>

        <aside id="sidebar">
          <div id="config-container"></div>
          <div id="stats-container"></div>
          <div id="error-log" hidden></div>
        </aside>
      </main>
    </div>

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
  background: #1a1a1a;
  color: #fff;
}

#app {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto 1fr;
  height: 100vh;
  gap: 12px;
  padding: 12px;
}

header {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #222;
  padding: 12px;
  border-radius: 8px;
}

main {
  display: flex;
  gap: 12px;
}

canvas {
  flex: 1;
  border-radius: 8px;
  background: #000;
}

#sidebar {
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

#config-container,
#stats-container {
  background: #222;
  border-radius: 8px;
  padding: 12px;
}

fieldset {
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
}

legend {
  font-weight: 600;
  font-size: 0.9em;
  color: #aaa;
}

label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.9em;
}

label span {
  flex: 1;
}

label input[type="range"] {
  flex: 2;
}

label .value {
  min-width: 50px;
  text-align: right;
  font-family: monospace;
  font-size: 0.85em;
  color: #aaa;
}

.stat-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px solid #333;
  font-size: 0.9em;
}

.stat-label {
  color: #aaa;
}

.stat-value {
  font-family: monospace;
  color: #0f0;
}

.stat-unit {
  font-size: 0.75em;
  margin-left: 4px;
  color: #666;
}

#error-log {
  background: #8b0000;
  color: #fff;
  padding: 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.85em;
  max-height: 200px;
  overflow-y: auto;
}

button {
  padding: 6px 12px;
  background: #0066cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
}

button:hover {
  background: #0052a3;
}
```

---

## Key Implementation Challenges

### Challenge 1: Per-Module Imports

**Problem**: Importing all modules at once creates circular dependencies and makes v4 optional.

**Solution**: Use dynamic imports.

```typescript
async function loadModule(name: AlgoName): Promise<AlgoModule> {
  const modules: Record<AlgoName, () => Promise<any>> = {
    v1_refined: () => import("./v1_refined_webgpu/module.ts"),
    v3_glsl: () => import("./v3_glsl/module.ts"),
    v4_webgl2: () => import("./v4_webgl2/module.ts"),
    v6_webgpu: () => import("./v6_webgpu/module.ts"),
  };

  const mod = await modules[name]?.();
  return mod.module;
}
```

### Challenge 2: Context Switching (WebGL2 vs WebGPU)

**Problem**: Can't have both WebGL2 and WebGPU contexts on the same canvas.

**Solution**: Recreate canvas on context switch, or document limitation upfront.

```typescript
async function switchAlgorithm(...) {
  // If switching between WebGL2 and WebGPU, recreate canvas
  if (needsContextSwitch(state.module?.name, newModule.name)) {
    const newCanvas = state.canvas.cloneNode(true) as HTMLCanvasElement;
    state.canvas.parentNode!.replaceChild(newCanvas, state.canvas);
    state.canvas = newCanvas;
  }
  // ...
}
```

### Challenge 3: Shader Path Resolution

**Problem**: Shaders are in different directories; the app needs to know where to find them.

**Solution**: Use a manifest or convention.

```typescript
const SHADER_MANIFEST: Record<AlgoName, string> = {
  v1_refined: "./v1_refined_webgpu/renderer.wgsl",
  v3_glsl: "./v3_glsl/shader.wgsl",
  v4_webgl2: "./v4_webgl2/shader.glsl",
  v6_webgpu: "./v6_webgpu/composite.wgsl",
};

async function loadShaderSource(algo: AlgoName): Promise<string> {
  const path = SHADER_MANIFEST[algo];
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load shader: ${path}`);
  return response.text();
}
```

### Challenge 4: Stats GPU Readback Without Stalls

**Problem**: Reading GPU stats every frame causes GPU stalls.

**Solution**: Readback every N frames asynchronously.

```typescript
class AsyncStatsReader {
  private readbackInterval = 10; // frames
  private framesSinceReadback = 0;

  async read(buffer: GPUBuffer): Promise<Stats> {
    this.framesSinceReadback++;

    if (this.framesSinceReadback < this.readbackInterval) {
      return this.lastStats; // Return cached value
    }

    // Async readback
    const staging = this.device.createBuffer({
      size: buffer.size,
      mappedAtCreation: false,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const cmd = this.device.createCommandEncoder();
    cmd.copyBufferToBuffer(buffer, 0, staging, 0, buffer.size);
    this.device.queue.submit([cmd.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange());
    this.lastStats = this.parseStats(data);
    staging.unmap();
    staging.destroy();

    this.framesSinceReadback = 0;
    return this.lastStats;
  }
}
```

---

## Testing Checklist

- [ ] Module registry loads and registers all modules
- [ ] Schema renderer creates correct HTML for each parameter type
- [ ] Schema validation catches out-of-range values
- [ ] Config changes propagate to renderer
- [ ] Stats aggregator tracks per-algorithm stats
- [ ] Algorithm switching disposes old renderer and creates new one
- [ ] No GPU validation errors
- [ ] Frame rate stays above 30 FPS

---

## Success Criteria

- ✅ Minimal main app (< 200 lines)
- ✅ All algorithms use schema-driven UI
- ✅ Adding new algorithm requires only module.ts + schema.ts
- ✅ No hard-coded config or stats in app.ts
- ✅ All renderers are stateless (same behavior regardless of creation order)
- ✅ Stats are accurate and update every frame
- ✅ Error messages are user-friendly

