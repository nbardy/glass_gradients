# Plan B: Full Module Abstraction

## Overview

**Duration**: 4–6 hours
**Complexity**: Medium
**Risk**: Low–Medium

Plan B moves beyond simple wrapping to a **proper module architecture** where each algorithm is a self-contained package exporting a standardized interface. This approach prioritizes:

- **Extensibility**: Adding a new algorithm requires zero changes to core UI code
- **Isolation**: Algorithm modules have clear boundaries and responsibilities
- **Reusability**: Config schemas, stat collectors, and effect chains are composable
- **Testability**: Each module can be tested in isolation

---

## High-Level Strategy

### Core Idea

Each algorithm becomes a **module** that exports:

1. **Metadata**: Name, version, required WebGPU features
2. **Schema**: Hyperparameter definitions + stat card definitions (declarative, not hard-coded)
3. **Factory**: Async function to create a renderer instance
4. **Renderer**: Implementation of the `AlgoRenderer` interface
5. **Effects** (optional): Post-processing chains, tone mapping, overlays

The main UI is **schema-driven**: it reads module metadata and auto-generates controls, stats panels, and error handling.

### Key Differences from Plan A

| Aspect | Plan A | Plan B |
|--------|--------|--------|
| **Config Definition** | Hard-coded object in app.ts | Exported from each module |
| **Stats Schema** | Hard-coded array | Exported from module + dynamic aggregation |
| **UI Generation** | Fixed layout in HTML | Schema-driven, no HTML hard-coding |
| **Adding an Algorithm** | Modify app.ts + add wrapper | Just export a new module |
| **Effect Chains** | None | Post-render filters, tone mapping, overlays |
| **Testing** | Manual, per-renderer | Module + integration tests included |

---

## Architecture

### Module Structure

```
glass_gradients/
├── v1_refined_webgpu/
│   ├── module.ts          ← EXPORTS: AlgoModule interface
│   ├── renderer.ts        ← Implements AlgoRenderer
│   ├── schema.ts          ← Config + stats schemas
│   ├── effects/           ← Optional post-processing
│   └── renderer.wgsl
│
├── v3_glsl/
│   ├── module.ts
│   ├── renderer.ts
│   ├── schema.ts
│   └── shader.wgsl
│
├── v4_webgl2/
│   ├── module.ts
│   ├── renderer.ts
│   ├── schema.ts
│   └── shader.glsl
│
├── v6_webgpu/
│   ├── module.ts
│   ├── composite-renderer.ts
│   ├── precompute-atmosphere.ts
│   ├── precompute-glass.ts
│   ├── schema.ts
│   ├── effects/
│   └── shaders/
│
├── core/
│   ├── module-registry.ts  ← Dynamic module loading
│   ├── schema-renderer.ts  ← Schema-driven UI generation
│   ├── stats-aggregator.ts ← Multi-algorithm stats tracking
│   └── effect-pipeline.ts  ← Composable effects
│
└── app.ts                  ← Main app, very thin
```

### Module Interface

```typescript
// Exported from each algorithm's module.ts

interface AlgoModule {
  // Metadata
  name: AlgoName;
  displayName: string;
  version: string;
  description: string;
  requiredFeatures: GPUFeatureName[];

  // Declarative schemas
  configSchema: HyperParamDef[];
  statsSchema: StatCardDef[];

  // Factory
  create(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    shaderSource: string
  ): Promise<AlgoRenderer>;

  // Optional: effect chains
  effectPipeline?: EffectChain;
}

// Usage:
import { module as v1Module } from "./v1_refined_webgpu/module.ts";
const renderer = await v1Module.create(device, canvas, shaderSource);
```

### Schema-Driven UI

```typescript
// Schema generation (no HTML hard-coding)

function renderControlsFromSchema(
  container: HTMLElement,
  schema: HyperParamDef[],
  currentConfig: RuntimeConfig,
  onchange: (key: string, value: any) => void
): void {
  container.innerHTML = "";

  for (const def of schema) {
    const control = createControl(def, currentConfig[def.key]);
    control.addEventListener("change", (e) => {
      onchange(def.key, e.detail.value);
    });
    container.appendChild(control);
  }
}

function createControl(
  def: HyperParamDef,
  value: any
): HTMLElement {
  switch (def.type) {
    case "number":
      return createSlider(def, value);
    case "checkbox":
      return createCheckbox(def, value);
    case "select":
      return createDropdown(def, value);
    default:
      throw new Error(`Unknown control type: ${def.type}`);
  }
}
```

### Stats Aggregation

```typescript
// Unified stats tracking across algorithms

class MultiAlgoStatsAggregator {
  private stats: Record<AlgoName, Stats> = {};
  private frameTime: number = 0;

  register(algo: AlgoName, schema: StatCardDef[]): void {
    this.stats[algo] = {};
    // Initialize stat fields from schema
  }

  update(algo: AlgoName, newStats: Stats): void {
    this.stats[algo] = { ...newStats };
  }

  render(container: HTMLElement, algo: AlgoName): void {
    const schema = this.getSchemaFor(algo);
    const stats = this.stats[algo];

    const panel = document.createElement("div");
    panel.className = "stats-panel";

    for (const card of schema) {
      const value = stats[card.valueKey];
      const formatted = card.format ? card.format(value) : String(value);

      const cardEl = document.createElement("div");
      cardEl.className = "stat-card";
      cardEl.innerHTML = `
        <span class="label">${card.label}</span>
        <strong>${formatted} ${card.unit || ""}</strong>
      `;
      panel.appendChild(cardEl);
    }

    container.replaceChildren(panel);
  }

  private getSchemaFor(algo: AlgoName): StatCardDef[] {
    // Loaded from module
  }
}
```

---

## Implementation Phases

### Phase 1: Module Infrastructure (1.5 hours)

#### 1a. Create Module Registry

```typescript
// core/module-registry.ts

class ModuleRegistry {
  private modules: Map<AlgoName, AlgoModule> = new Map();

  async register(module: AlgoModule): Promise<void> {
    // Check requiredFeatures against device
    const adapter = await navigator.gpu.requestAdapter();
    const supported = adapter?.features || new GPUFeatureMask();

    for (const feature of module.requiredFeatures) {
      if (!supported.has(feature)) {
        console.warn(`Module ${module.name} requires ${feature}, not available`);
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
}
```

#### 1b. Create Schema Utilities

```typescript
// core/schema-renderer.ts

class SchemaRenderer {
  static renderControls(
    container: HTMLElement,
    schema: HyperParamDef[],
    config: RuntimeConfig,
    onchange: (key: string, value: any) => void
  ): void {
    // Implementation from earlier
  }

  static renderStats(
    container: HTMLElement,
    statsSchema: StatCardDef[],
    stats: Stats
  ): void {
    // Implementation
  }

  static createControl(def: HyperParamDef, value: any): HTMLElement {
    // Implementation
  }
}
```

### Phase 2: Module Refactoring (2 hours)

For each algorithm (v1, v3, v4, v6):

#### 2a. Create `schema.ts`

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
  },
  {
    key: "maxSamples",
    label: "Max Samples",
    type: "number",
    min: 1,
    max: 32,
    step: 1,
  },
  // ... more params
];

export const statsSchema: StatCardDef[] = [
  {
    id: "fps",
    label: "FPS",
    valueKey: "fps",
    unit: "Hz",
    format: (v) => v.toFixed(1),
  },
  {
    id: "confident",
    label: "Confident",
    valueKey: "confident",
    unit: "%",
    format: (v) => (v * 100).toFixed(1),
  },
  // ... more stats
];
```

#### 2b. Create `module.ts`

```typescript
// v1_refined_webgpu/module.ts

import { configSchema, statsSchema } from "./schema.ts";
import { V1Renderer } from "./renderer.ts";

export const module: AlgoModule = {
  name: "v1_refined",
  displayName: "V1 Refined (WebGPU Adaptive)",
  version: "1.0.0",
  description: "Original bathroom glass with adaptive sampling",
  requiredFeatures: ["shader-f16"], // Example; may be optional

  configSchema,
  statsSchema,

  async create(device, canvas, shaderSource) {
    return V1Renderer.create(device, canvas, shaderSource);
  },
};
```

#### 2c. Update Renderer Classes

Move implementation details from `renderer.ts` (mostly unchanged) but ensure it strictly implements `AlgoRenderer`.

### Phase 3: UI & Core App (1.5 hours)

#### 3a. Thin App Bootstrap

```typescript
// app.ts (very short!)

import { ModuleRegistry } from "./core/module-registry.ts";
import { SchemaRenderer } from "./core/schema-renderer.ts";
import { MultiAlgoStatsAggregator } from "./core/stats-aggregator.ts";

import { module as v1Module } from "./v1_refined_webgpu/module.ts";
import { module as v3Module } from "./v3_glsl/module.ts";
import { module as v6Module } from "./v6_webgpu/module.ts";

const registry = new ModuleRegistry();
const statsAggregator = new MultiAlgoStatsAggregator();

async function init() {
  // Register all modules
  await registry.register(v1Module);
  await registry.register(v3Module);
  await registry.register(v6Module);

  // Populate algorithm picker from registry
  const picker = document.getElementById("algo-picker") as HTMLSelectElement;
  for (const mod of registry.listModules()) {
    const option = document.createElement("option");
    option.value = mod.name;
    option.textContent = mod.displayName;
    picker.appendChild(option);
  }

  // Select first algorithm
  const device = await navigator.gpu.requestAdapter()?.requestDevice();
  await switchAlgorithm(registry.listModules()[0].name, device);
}

async function switchAlgorithm(algoName: AlgoName, device: GPUDevice) {
  const mod = registry.getModule(algoName);
  const canvas = document.querySelector("canvas") as HTMLCanvasElement;
  const source = await fetch(`./shaders/${algoName}.wgsl`).then((r) =>
    r.text()
  );

  const renderer = await mod.create(device, canvas, source);
  const config = getDefaultConfig(mod.configSchema);

  // Render UI from schema
  SchemaRenderer.renderControls(
    document.getElementById("config-container")!,
    mod.configSchema,
    config,
    (key, value) => {
      config[key] = value;
      applyConfig(renderer, config);
    }
  );

  // Register stats aggregator
  statsAggregator.register(algoName, mod.statsSchema);

  // Frame loop
  (function loop() {
    requestAnimationFrame(async (ts) => {
      await renderer.render(ts);
      statsAggregator.update(algoName, renderer.getStats());
      statsAggregator.render(
        document.getElementById("stats-container")!,
        algoName
      );
      loop();
    });
  })();
}

document
  .getElementById("algo-picker")
  ?.addEventListener("change", async (e) => {
    const algoName = (e.target as HTMLSelectElement).value as AlgoName;
    const device = await navigator.gpu.requestAdapter()?.requestDevice();
    await switchAlgorithm(algoName, device);
  });

init();
```

#### 3b. HTML (Minimal)

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Glass Gradients - Unified Renderer</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="header">
      <h1>Glass Gradients</h1>
      <label>
        Algorithm:
        <select id="algo-picker"></select>
      </label>
    </div>

    <div id="main">
      <canvas id="canvas"></canvas>

      <div id="sidebar">
        <div id="config-container"></div>
        <div id="stats-container"></div>
        <div id="error-log" hidden></div>
      </div>
    </div>

    <script src="app.ts" type="module"></script>
  </body>
</html>
```

### Phase 4: Effect Pipeline (Optional, 1 hour)

```typescript
// core/effect-pipeline.ts

type Effect = (input: GPUTexture, output: GPUTexture) => Promise<void>;

class EffectPipeline {
  effects: Effect[] = [];

  add(effect: Effect): void {
    this.effects.push(effect);
  }

  async apply(
    input: GPUTexture,
    output: GPUTexture,
    device: GPUDevice
  ): Promise<void> {
    let current = input;

    for (const effect of this.effects) {
      const next =
        effect === this.effects[this.effects.length - 1]
          ? output
          : device.createTexture({ /* temp */ });

      await effect(current, next);

      if (current !== input) {
        current.destroy();
      }
      current = next;
    }
  }
}
```

---

## Key Design Decisions

### Decision 1: Schema-Driven vs. Code-Generated

**Chosen**: Schema-driven.
- Schemas are declarative, easy to audit
- UI generation is automatic, no copy-paste
- Schemas can be versioned independently

### Decision 2: Module vs. Factory Pattern

**Chosen**: Module object.
- Single point of export per algorithm
- Metadata + factory + optional effects all co-located
- Easy to query available modules at runtime

### Decision 3: Synchronous Stats or Async GPU Readback?

**Chosen**: Hybrid.
- Renderer.getStats() is synchronous (uses cached value)
- Every 10 frames, async GPU readback updates cache
- No frame-blocking stalls

---

## Testing Strategy

### Unit Tests per Module

```typescript
// v1_refined_webgpu/__tests__/module.test.ts

describe("V1 Module", () => {
  it("exports valid schema", () => {
    expect(module.configSchema).toBeDefined();
    expect(module.statsSchema).toBeDefined();
  });

  it("creates a renderer", async () => {
    const renderer = await module.create(device, canvas, shaderSource);
    expect(renderer.name).toBe("v1_refined");
    renderer.dispose();
  });

  it("validates config against schema", () => {
    const valid = validateConfig(module.configSchema, { baseSamples: 4 });
    expect(valid).toBe(true);
  });
});
```

### Integration Tests

```typescript
// __tests__/integration.test.ts

describe("Schema-Driven UI", () => {
  it("renders controls for all algorithms", async () => {
    for (const mod of registry.listModules()) {
      const container = document.createElement("div");
      SchemaRenderer.renderControls(
        container,
        mod.configSchema,
        {},
        () => {}
      );
      expect(container.children.length).toBeGreaterThan(0);
    }
  });

  it("switches between algorithms without crashing", async () => {
    await switchAlgorithm("v1_refined", device);
    await switchAlgorithm("v6_webgpu", device);
    // No exceptions
  });
});
```

---

## Success Criteria

- ✅ All modules are schema-driven (no hard-coded config in app.ts)
- ✅ Adding a new algorithm requires only a new module folder
- ✅ UI is automatically generated from schemas
- ✅ Stats aggregator unifies output format
- ✅ Effect pipeline is composable
- ✅ Module tests pass
- ✅ Integration tests pass
- ✅ Frame rate remains > 30 FPS

---

## Migration Path from Plan A

If Plan A is already implemented:

1. Extract configSchema and statsSchema from ALGO_CONFIGS
2. Create module.ts in each algorithm folder
3. Move schema definitions to schema.ts
4. Replace hard-coded UI generation with SchemaRenderer calls
5. Update app.ts to use ModuleRegistry

This is **incremental** and doesn't require scrapping Plan A's work.

