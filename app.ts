import { DenseControls } from "./lib/dense-controls/dense-controls.js";
import { v1GlassPipeline } from "./algorithms/v1/glass_pipeline";
import { v6CompositePipeline } from "./algorithms/v6/composite_pipeline";
import { v3GlassPipeline } from "./algorithms/v3/glass_pipeline";
import { v4GlassPipeline } from "./algorithms/v4/glass_pipeline";
import { v7GlassPipeline } from "./algorithms/v7/glass_pipeline";
import type { AlgoRenderer } from "./core/renderer";

type AlgoName = "v1_refined" | "v6_webgpu" | "v3_glsl" | "v4_webgl2" | "v7_fast_analytical";

interface AlgoMeta {
  name: AlgoName;
  label: string;
  pipeline: (device: any, canvas: HTMLCanvasElement, source: string, config: Record<string, any>) => Promise<AlgoRenderer>;
  shaderPath: string;
  defaultConfig: Record<string, any>;
}

const ALGORITHMS: Record<AlgoName, AlgoMeta> = {
  v7_fast_analytical: {
    name: "v7_fast_analytical",
    label: "V7 Fast Analytical (Single Pass)",
    pipeline: (device, canvas, source, config) => v7GlassPipeline(device, canvas, config),
    shaderPath: "./algorithms/v7/renderer.wgsl",
    defaultConfig: {
      sunAzimuth: 0.58,
      sunElevation: 0.055,
      cameraZ: 1.65,
      cameraFocal: 1.85,
      glassThickness: 0.06,
      glassHeightAmpl: 0.01,
      glassBump: 0.19,
      glassPatternType: 0,
      glassIor: 1.52,
      glassDistortion: 1.0,
      showOutdoorOnly: false
    },
  },
  v1_refined: {
    name: "v1_refined",
    label: "V1 Refined (Adaptive)",
    pipeline: v1GlassPipeline,
    shaderPath: "./v1_refined_webgpu/renderer.wgsl",
    defaultConfig: {
      baseSamples: 2,
      maxSamples: 8,
      targetError: 0.06,
      varianceBoost: 1.2,
      outlierK: 3.0,
      exposure: 1.18,
      sunAzimuth: 0.58,
      sunElevation: 0.055,
      cameraZ: 1.65,
      cameraFocal: 1.85,
      glassThickness: 0.06,
      glassHeightAmpl: 0.01,
      glassBump: 0.19,
      glassRoughness: 0.085,
      glassPatternType: 0,
      glassIor: 1.52,
      cloudSteps: 8,
      sunShadowSteps: 3,
      adaptiveSampling: true,
      staticScene: true,
    },
  },
  v6_webgpu: {
    name: "v6_webgpu",
    label: "V6 WebGPU (Bruneton)",
    pipeline: v6CompositePipeline,
    shaderPath: "./v6/composite.wgsl",
    defaultConfig: {
      exposure: 1.0,
    },
  },
  v3_glsl: {
    name: "v3_glsl",
    label: "V3 WebGPU (Transcribed)",
    pipeline: v3GlassPipeline,
    shaderPath: "./v3/bathroom-glass-optical-simulator.wgsl",
    defaultConfig: {},
  },
  v4_webgl2: {
    name: "v4_webgl2",
    label: "V4 WebGPU (Transcribed)",
    pipeline: v4GlassPipeline,
    shaderPath: "./v3/bathroom-glass-optical-simulator.wgsl",
    defaultConfig: {},
  },
};

interface AppState {
  renderer: AlgoRenderer | null;
  device: any;
  canvas: HTMLCanvasElement;
  currentAlgo: AlgoName;
  config: Record<string, any>;
  controls: any | null;
}

let state: AppState = {
  renderer: null,
  device: null,
  canvas: null,
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

  // Recreate canvas to clear any existing WebGL/WebGPU context
  const oldCanvas = state.canvas;
  const newCanvas = document.createElement("canvas");
  newCanvas.id = "canvas";
  newCanvas.width = oldCanvas.width || 1440;
  newCanvas.height = oldCanvas.height || 720;
  oldCanvas.replaceWith(newCanvas);
  state.canvas = newCanvas;

  const meta = ALGORITHMS[algoName];

  try {
    // Load shader
    const response = await fetch(meta.shaderPath);
    if (!response.ok) throw new Error(`Failed to load shader: ${meta.shaderPath}`);
    const source = await response.text();

    // Initialize config
    state.config = { ...meta.defaultConfig };

    // Create renderer (handles all setup internally)
    state.renderer = await meta.pipeline(state.device, state.canvas, source, state.config);

    state.currentAlgo = algoName;

    // Setup controls using DenseControls
    const controlForm = document.querySelector("#controls") as HTMLFormElement;
    controlForm.innerHTML = ""; // Clear old controls

    // Build semantic HTML for this algo's controls
    const defaultConfig = meta.defaultConfig;
    for (const [key, defaultValue] of Object.entries(defaultConfig)) {
      const label = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = key;

      let input: HTMLInputElement;

      if (typeof defaultValue === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
        (input as any).checked = defaultValue;
      } else {
        input = document.createElement("input");
        input.type = "range";
        
        // Simple heuristic for ranges based on default value
        const val = Number(defaultValue);
        if (val <= 1.0) {
          input.min = "0";
          input.max = "1";
          input.step = "0.01";
        } else if (val <= 10.0) {
          input.min = "0";
          input.max = "10";
          input.step = "0.1";
        } else {
          input.min = "0";
          input.max = "100";
          input.step = "1";
        }
        
        input.value = String(defaultValue);
      }

      input.setAttribute("data-setting", key);

      label.appendChild(span);
      label.appendChild(input);
      controlForm.appendChild(label);
    }

    // Initialize DenseControls on the form
    state.controls = DenseControls.init(controlForm, {
      keyAttr: "setting",
    });

    // Listen for control changes (currently just updates state)
    state.controls.on("change", (key: string, value: any) => {
      state.config[key] = value;
      // Note: Hot-update would require renderer.setConfig()
      // For now, configs are read at init time only
    });

    // Clear error
    const errorDiv = document.querySelector("#error") as HTMLElement;
    if (errorDiv) {
      errorDiv.textContent = "";
    }
  } catch (error) {
    const errorDiv = document.querySelector("#error") as HTMLElement;
    if (errorDiv) {
      errorDiv.textContent = `Error: ${error}`;
    }
    console.error(error);
  }
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
          label.className = "stat-label";
          label.textContent = key;

          const valueEl = document.createElement("strong");
          valueEl.className = "stat-value";
          if (typeof value === "number") {
            valueEl.textContent = value.toFixed(value > 10 ? 1 : 2);
          } else {
            valueEl.textContent = String(value);
          }

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

init().catch(console.error);
