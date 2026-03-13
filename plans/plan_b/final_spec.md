# Plan B: Final Spec - Module Architecture & Type Signatures

## Core Types

```ts
// ============================================================================
// Module Interface (Exported by each algorithm)
// ============================================================================

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
  effectPipeline?: EffectPipeline;
}

// ============================================================================
// Hyperparameter Definition
// ============================================================================

type HyperParamDef = {
  key: string; // Unique identifier
  label: string; // Display name
  type: "number" | "checkbox" | "select";

  // For "number" type
  min?: number;
  max?: number;
  step?: number;

  // For "select" type
  options?: string[];

  // Optional metadata
  description?: string;
  category?: string; // e.g., "Glass", "Atmosphere", "Rendering"
  defaultValue?: any;
};

// ============================================================================
// Runtime Config (User-set values)
// ============================================================================

type RuntimeConfig = {
  [key: string]: number | boolean | string;
};

// ============================================================================
// Statistics Definition
// ============================================================================

type StatCardDef = {
  id: string; // Unique stat identifier
  label: string; // Display label
  valueKey: string; // Which key in Stats to read
  unit?: string; // e.g., "Hz", "%", "ms"
  format?: (value: any) => string; // Custom formatting function
  precision?: number; // Decimal places (for auto-format)
  min?: number; // For progress bars, gauges
  max?: number;
  category?: string; // "Performance", "Quality", "Debug"
};

// ============================================================================
// Stats Emitted by Renderer
// ============================================================================

type Stats = {
  // Timing
  fps?: number;
  frameMs?: number;

  // Adaptive sampling (v1-specific, optional for others)
  spp?: number; // Samples per pixel (average)
  confident?: number; // Fraction of pixels confident (0-1)
  parked?: number; // Fraction at max spp
  adaptive?: number; // Fraction still sampling

  // Convergence quality
  brightUnresolved?: number; // High-noise pixel count
  darkUnresolved?: number; // Low-signal pixel count

  // Atmosphere (v6-specific)
  atmosphereDirty?: boolean;
  glassDirty?: boolean;

  // Generic catch-all
  [key: string]: any;
};

// ============================================================================
// Algorithm Renderer Interface
// ============================================================================

interface AlgoRenderer {
  // Identity
  name: string;
  config: HyperParamDef[];
  statCards: StatCardDef[];

  // Lifecycle
  compile(device: GPUDevice, source: string): Promise<void>;
  render(timestamp: number): Promise<void>;
  reset(): Promise<void>;
  dispose(): void;

  // State queries
  getStats(): Stats;
  getConfig(): RuntimeConfig;
  setConfig(config: RuntimeConfig): Promise<void>;
}

// ============================================================================
// Effect Pipeline
// ============================================================================

type Effect = (
  input: GPUTexture,
  output: GPUTexture,
  params: Record<string, number>
) => Promise<void>;

type EffectDef = {
  name: string;
  effect: Effect;
  params?: Record<string, number>;
};

interface EffectPipeline {
  effects: EffectDef[];
  add(effect: EffectDef): void;
  remove(name: string): void;
  apply(
    input: GPUTexture,
    output: GPUTexture,
    device: GPUDevice
  ): Promise<void>;
}

// ============================================================================
// Algorithm Selection
// ============================================================================

type AlgoName =
  | "v1_refined"
  | "v3_glsl"
  | "v4_webgl2"
  | "v6_webgpu";
```

---

## Core Functions

### Module Registry

```ts
// ============================================================================
// Module Registry - Dynamic algorithm management
// ============================================================================

class ModuleRegistry {
  private modules: Map<AlgoName, AlgoModule> = new Map();

  // Register a module
  async register(module: AlgoModule): Promise<void>;

  // Retrieve a registered module
  getModule(algo: AlgoName): AlgoModule;

  // List all available modules
  listModules(): AlgoModule[];

  // Check if a module is registered
  hasModule(algo: AlgoName): boolean;

  // Get modules filtered by required features
  getAvailableModules(device: GPUDevice): AlgoModule[];
}

// Usage:
const registry = new ModuleRegistry();
await registry.register(v1Module);
const mod = registry.getModule("v1_refined");
```

### Schema Utilities

```ts
// ============================================================================
// Schema Rendering - Auto-generate UI from schemas
// ============================================================================

class SchemaRenderer {
  // Render controls from hyperparameter schema
  static renderControls(
    container: HTMLElement,
    schema: HyperParamDef[],
    config: RuntimeConfig,
    onchange: (key: string, value: any) => void
  ): void;

  // Render stats from stat card definitions
  static renderStats(
    container: HTMLElement,
    statsSchema: StatCardDef[],
    stats: Stats
  ): void;

  // Create a single control element
  static createControl(
    def: HyperParamDef,
    value: any,
    onchange: (value: any) => void
  ): HTMLElement;

  // Create a stats card element
  static createStatCard(def: StatCardDef, value: any): HTMLElement;

  // Validate config against schema
  static validateConfig(
    schema: HyperParamDef[],
    config: RuntimeConfig
  ): { valid: boolean; errors: string[] };

  // Get default config from schema
  static getDefaultConfig(schema: HyperParamDef[]): RuntimeConfig;

  // Group schema items by category
  static groupByCategory(
    schema: HyperParamDef[]
  ): Map<string, HyperParamDef[]>;
}

// Usage:
SchemaRenderer.renderControls(
  document.getElementById("config"),
  module.configSchema,
  currentConfig,
  (key, value) => {
    currentConfig[key] = value;
    renderer.setConfig(currentConfig);
  }
);
```

### Stats Aggregation

```ts
// ============================================================================
// Multi-Algorithm Stats Tracking
// ============================================================================

class MultiAlgoStatsAggregator {
  private stats: Record<AlgoName, Stats> = {};
  private schemas: Record<AlgoName, StatCardDef[]> = {};

  // Register stats schema for an algorithm
  register(algo: AlgoName, schema: StatCardDef[]): void;

  // Update stats for an algorithm
  update(algo: AlgoName, newStats: Stats): void;

  // Get current stats for an algorithm
  getStats(algo: AlgoName): Stats;

  // Render stats panel
  render(container: HTMLElement, algo: AlgoName): void;

  // Get schema for an algorithm
  getSchema(algo: AlgoName): StatCardDef[];
}

// Usage:
const aggregator = new MultiAlgoStatsAggregator();
aggregator.register("v1_refined", v1Module.statsSchema);
aggregator.update("v1_refined", renderer.getStats());
aggregator.render(document.getElementById("stats"), "v1_refined");
```

### Config Management

```ts
// ============================================================================
// Config Validation & Defaults
// ============================================================================

// Get default config from schema
function getDefaultConfigFromSchema(
  schema: HyperParamDef[]
): RuntimeConfig;

// Validate config against schema
function validateConfig(
  schema: HyperParamDef[],
  config: RuntimeConfig
): boolean;

// Coerce config values to proper types
function coerceConfig(
  schema: HyperParamDef[],
  config: Partial<RuntimeConfig>
): RuntimeConfig;

// Deep compare two configs
function configEqual(a: RuntimeConfig, b: RuntimeConfig): boolean;

// Merge two configs (second overrides first)
function mergeConfigs(
  base: RuntimeConfig,
  override: Partial<RuntimeConfig>
): RuntimeConfig;
```

### Effect Pipeline

```ts
// ============================================================================
// Effect Pipeline - Composable post-render effects
// ============================================================================

class EffectPipelineImpl implements EffectPipeline {
  effects: EffectDef[] = [];

  // Add an effect
  add(effect: EffectDef): void;

  // Remove an effect by name
  remove(name: string): void;

  // Get effect by name
  get(name: string): EffectDef | undefined;

  // Clear all effects
  clear(): void;

  // Apply pipeline to textures
  async apply(
    input: GPUTexture,
    output: GPUTexture,
    device: GPUDevice
  ): Promise<void>;

  // Enable/disable an effect
  setEnabled(name: string, enabled: boolean): void;

  // Set effect parameters
  setParams(name: string, params: Record<string, number>): void;
}

// Built-in effects:

// ACES tone mapping
const toneMapACES: Effect;

// Gamma correction
const gammaCorrect: Effect;

// Bloom / glow
const bloom: Effect;

// Exposure adjustment
const exposure: Effect;
```

### Renderer Selection & Creation

```ts
// ============================================================================
// Renderer Lifecycle
// ============================================================================

// Create a renderer from a module
async function createRendererFromModule(
  module: AlgoModule,
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  shaderSource: string
): Promise<AlgoRenderer>;

// Switch to a different algorithm
async function switchRenderer(
  oldRenderer: AlgoRenderer | null,
  newModule: AlgoModule,
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  newShaderSource: string
): Promise<AlgoRenderer>;

// Load shader source for an algorithm
async function loadShaderSource(algo: AlgoName): Promise<string>;

// Apply config changes to renderer
async function applyConfigToRenderer(
  renderer: AlgoRenderer,
  config: RuntimeConfig
): Promise<void>;

// Reset renderer to initial state
async function resetRenderer(renderer: AlgoRenderer): Promise<void>;
```

### Main App Loop

```ts
// ============================================================================
// Application Main Loop
// ============================================================================

type AppState = {
  renderer: AlgoRenderer | null;
  config: RuntimeConfig;
  device: GPUDevice;
  canvas: HTMLCanvasElement;
  statsAggregator: MultiAlgoStatsAggregator;
  registry: ModuleRegistry;
  isPaused: boolean;
};

// Initialize app
async function initApp(): Promise<AppState>;

// Main render loop
function renderLoop(state: AppState): void;

// Handle algorithm switch
async function handleAlgorithmSwitch(
  state: AppState,
  newAlgo: AlgoName
): Promise<void>;

// Handle config change
async function handleConfigChange(
  state: AppState,
  key: string,
  value: any
): Promise<void>;

// Pause/resume rendering
function setPaused(state: AppState, paused: boolean): void;

// Take a screenshot
async function takeScreenshot(
  renderer: AlgoRenderer
): Promise<ImageData>;

// Export stats as JSON
function exportStats(state: AppState): string;
```

### Error Handling

```ts
// ============================================================================
// Error Types & Handling
// ============================================================================

type CompileError = {
  algo: AlgoName;
  shader: string;
  error: string;
  line?: number;
};

type RuntimeError = {
  algo: AlgoName;
  error: string;
  timestamp: number;
};

// Display error in UI
function displayError(error: CompileError | RuntimeError): void;

// Clear error display
function clearError(): void;

// Log error with context
function logError(error: CompileError | RuntimeError): void;
```

---

## Summary

**Total Function Signatures**: 80+ across:

- **Module Registry**: 4 methods
- **Schema Renderer**: 7 static methods
- **Stats Aggregation**: 4 methods
- **Config Management**: 5 functions
- **Effect Pipeline**: 5 methods + built-in effects
- **Renderer Lifecycle**: 5 functions
- **App Loop**: 6 functions
- **Error Handling**: 3 functions

---

## Type Safety Notes

- All config keys are unquoted strings (no Map<string,*> if avoidable)
- Stats objects use spread (`[key: string]: any`) for extensibility
- AlgoModule is sealed at registration time
- SchemaRenderer is pure (no side effects beyond DOM mutation)
- All async functions are properly typed with Promise<T>

