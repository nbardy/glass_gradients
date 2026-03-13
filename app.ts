import { DenseControls } from "./lib/dense-controls/dense-controls.js";
import { v1GlassPipeline } from "./algorithms/v1/glass_pipeline";
import { v6CompositePipeline } from "./algorithms/v6/composite_pipeline";
import { v3GlassPipeline } from "./algorithms/v3/glass_pipeline";
import { v4GlassPipeline } from "./algorithms/v4/glass_pipeline";
import { v7GlassPipeline } from "./algorithms/v7/glass_pipeline";
import { v8GlassPipeline } from "./algorithms/v8_stochastic_pbr/glass_pipeline";
import type { AlgoRenderer } from "./core/renderer";

import { BackgroundManager, UNIFIED_SKY_DEFAULTS, UNIFIED_SKY_PRESETS } from "./core/background_manager";

type AlgoName = "v1_refined" | "v6_webgpu" | "v3_glsl" | "v4_webgl2" | "v7_fast_analytical" | "v8_stochastic_pbr";

interface AlgoMeta {
  name: AlgoName;
  label: string;
  pipeline: (device: any, canvas: HTMLCanvasElement, source: string, config: Record<string, any>) => Promise<AlgoRenderer>;
  shaderPath: string;
  defaultConfig: Record<string, any>;
  uiGroups?: Record<string, string[]>;
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
      glassPatternType: 2, // Default to Pebbled
      glassScale: 1.0,
      glassFrontOffsetX: 0.1,
      glassFrontOffsetY: -0.07,
      glassBackOffsetX: -0.11,
      glassBackOffsetY: 0.06,
      glassDistortion: 1.0,
      glassIor: 1.52,
      showOutdoorOnly: false,
      bgType: 0,
      unifiedPreset: 0,
      ...UNIFIED_SKY_DEFAULTS,
    },
    uiGroups: {
      "Glass": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
      "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "showOutdoorOnly"],
      "Unified Sky": ["unifiedPreset", "sunIntensity", "cloudCoverage", "cloudScale", "cloudSpeed", "cloudHeight", "horizonType", "surfaceType", "overlayType", "turbidity", "fogDensity", "horizonDistance", "cityHeight", "cityDensity", "vegetationDensity", "foamAmount", "surfaceRoughness"]
    }
  },
  v8_stochastic_pbr: {
    name: "v8_stochastic_pbr",
    label: "V8 Stochastic PBR (Multi-Pass)",
    pipeline: v8GlassPipeline,
    shaderPath: "./algorithms/v8_stochastic_pbr/renderer.wgsl",
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
      glassPatternType: 2,
      glassScale: 1.0,
      glassFrontOffsetX: 0.1,
      glassFrontOffsetY: -0.07,
      glassBackOffsetX: -0.11,
      glassBackOffsetY: 0.06,
      glassDistortion: 1.0,
      glassIor: 1.52,
      cloudSteps: 8,
      sunShadowSteps: 3,
      adaptiveSampling: true,
      staticScene: true,
      milkyScattering: false,
      dispersion: false,
      birefringence: false,
      bgType: 0
    },
    uiGroups: {
      "Renderer": ["baseSamples", "maxSamples", "targetError", "varianceBoost", "outlierK", "exposure", "adaptiveSampling", "staticScene"],
      "Glass Physical": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassRoughness", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
      "Glass Optics": ["milkyScattering", "dispersion", "birefringence"],
      "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "cloudSteps", "sunShadowSteps"]
    }
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
      glassPatternType: 2,
      glassScale: 1.0,
      glassFrontOffsetX: 0.1,
      glassFrontOffsetY: -0.07,
      glassBackOffsetX: -0.11,
      glassBackOffsetY: 0.06,
      glassDistortion: 1.0,
      glassIor: 1.52,
      cloudSteps: 8,
      sunShadowSteps: 3,
      adaptiveSampling: true,
      staticScene: true,
      bgType: 0,
      unifiedPreset: 0,
      ...UNIFIED_SKY_DEFAULTS,
    },
    uiGroups: {
      "Renderer": ["baseSamples", "maxSamples", "targetError", "varianceBoost", "outlierK", "exposure", "adaptiveSampling", "staticScene"],
      "Glass": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassRoughness", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
      "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "cloudSteps", "sunShadowSteps"],
      "Unified Sky": ["unifiedPreset", "sunIntensity", "cloudCoverage", "cloudScale", "cloudSpeed", "cloudHeight", "horizonType", "surfaceType", "overlayType", "turbidity", "fogDensity", "horizonDistance", "cityHeight", "cityDensity", "vegetationDensity", "foamAmount", "surfaceRoughness"]
    }
  },
  v6_webgpu: {
    name: "v6_webgpu",
    label: "V6 WebGPU (Bruneton)",
    pipeline: v6CompositePipeline,
    shaderPath: "./v6/composite.wgsl",
    defaultConfig: {
      sunAzimuth: 0.58,
      sunElevation: 0.055,
      mieG: 0.8,
      cameraHeight: 0.1,
      cameraDist: 1.65,
      thickness: 0.06,
      frontLfAmp: 0.1,
      frontHfAmp: 0.05,
      backLfAmp: 0.1,
      backHfAmp: 0.05,
      etaGlass: 1.52,
      dispersionScale: 0.005,
      sigmaToLod: 512.0,
      bgType: 2,
    },
    uiGroups: {
      "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraHeight", "cameraDist", "mieG"],
      "Glass": ["thickness", "etaGlass", "dispersionScale", "sigmaToLod", "frontLfAmp", "frontHfAmp", "backLfAmp", "backHfAmp"]
    }
  },
  v3_glsl: {
    name: "v3_glsl",
    label: "V3 WebGPU (Transcribed)",
    pipeline: v3GlassPipeline,
    shaderPath: "./v3/bathroom-glass-optical-simulator.wgsl",
    defaultConfig: {
      samples: 32,
      microRoughness: 0.08,
      etaR: 1.48,
      etaG: 1.51,
      etaB: 1.54,
    },
  },
  v4_webgl2: {
    name: "v4_webgl2",
    label: "V4 WebGPU (Transcribed)",
    pipeline: v4GlassPipeline,
    shaderPath: "./v3/bathroom-glass-optical-simulator.wgsl",
    defaultConfig: {
      samples: 32,
      microRoughness: 0.08,
      etaR: 1.48,
      etaG: 1.51,
      etaB: 1.54,
    },
  },
};

interface AppState {
  renderer: AlgoRenderer | null;
  device: any;
  canvas: HTMLCanvasElement;
  currentAlgo: AlgoName;
  config: Record<string, any>;
  controls: any | null;
  bgManager: BackgroundManager | null;
}

let state: AppState = {
  renderer: null,
  device: null,
  canvas: null as any,
  currentAlgo: "v1_refined",
  config: {},
  controls: null,
  bgManager: null,
};

async function init() {
  const adapter = await navigator.gpu.requestAdapter();
  state.device = await adapter!.requestDevice();
  state.canvas = document.querySelector("#canvas") as HTMLCanvasElement;
  state.bgManager = new BackgroundManager(state.device);

  const viewModePicker = document.querySelector("#view-mode") as HTMLSelectElement;
  const bgPicker = document.querySelector("#bg-picker") as HTMLSelectElement;
  const debugLeft = document.getElementById("debug-left");
  const debugRight = document.getElementById("debug-right");
  const debugMainTitle = document.getElementById("debug-main-title");
  
  viewModePicker.addEventListener("change", (e) => {
    const isSplit = (e.target as HTMLSelectElement).value === "split";
    state.config.splitView = isSplit;
    if (debugLeft) debugLeft.style.display = isSplit ? "flex" : "none";
    if (debugRight) debugRight.style.display = isSplit ? "flex" : "none";
    if (debugMainTitle) debugMainTitle.style.display = isSplit ? "block" : "none";
  });

  bgPicker.addEventListener("change", (e) => {
    state.config.bgType = (e.target as HTMLSelectElement).value;
    // We don't need to rebuild the whole pipeline, just the config.
    // However, if the shader needs it statically, we might need to pass it into a uniform buffer.
    // For now, it will be picked up on the next render if the pipeline supports hot-reloading it.
  });

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
    state.renderer = null;
  }
  if (state.controls) {
    state.controls.destroy();
    state.controls = null;
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
    const response = await fetch(`${meta.shaderPath}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`Failed to load shader: ${meta.shaderPath}`);
    const source = await response.text();

    // Preserve view mode state and bgType
    const currentSplitView = state.config.splitView ?? false;
    const currentBgType = state.config.bgType ?? "math";

    // Initialize config
    state.config = { 
      ...meta.defaultConfig, 
      splitView: currentSplitView, 
      bgType: currentBgType,
      bgManager: state.bgManager 
    };

    const debugLeft = document.getElementById("debug-left");
    const debugRight = document.getElementById("debug-right");
    const debugMainTitle = document.getElementById("debug-main-title");

    if (debugLeft) debugLeft.style.display = currentSplitView ? "flex" : "none";
    if (debugRight) debugRight.style.display = currentSplitView ? "flex" : "none";
    if (debugMainTitle) debugMainTitle.style.display = currentSplitView ? "block" : "none";

    // Create renderer (handles all setup internally)
    state.renderer = await meta.pipeline(state.device, state.canvas, source, state.config);

    state.currentAlgo = algoName;

    // Setup controls using DenseControls
    const controlForm = document.querySelector("#controls") as HTMLFormElement;
    controlForm.innerHTML = ""; // Clear old controls

    // Build semantic HTML for this algo's controls
    const defaultConfig = meta.defaultConfig;
    const groups = meta.uiGroups || { "Settings": Object.keys(defaultConfig) };

    for (const [groupName, keys] of Object.entries(groups)) {
      const details = document.createElement("details");
      details.className = "control-group";
      details.open = true;

      const summary = document.createElement("summary");
      summary.textContent = groupName;
      details.appendChild(summary);

      for (const key of keys) {
        if (!(key in defaultConfig)) continue;
        const defaultValue = defaultConfig[key];

        const label = document.createElement("label");
        const span = document.createElement("span");
        span.textContent = key;

        let input: HTMLInputElement | HTMLSelectElement;

        if (typeof defaultValue === "boolean") {
          input = document.createElement("input") as HTMLInputElement;
          input.type = "checkbox";
          (input as any).checked = defaultValue;
        } else if (key === "glassPatternType" || key === "bgType" || key === "horizonType" || key === "surfaceType" || key === "overlayType" || key === "unifiedPreset") {
          input = document.createElement("select") as HTMLSelectElement;
          let options: {value: number, label: string}[] = [];
          if (key === "glassPatternType") {
            options = [
              { value: 2, label: "Pebbled with slight frost" },
              { value: 0, label: "FBM Wavy" },
              { value: 1, label: "Frosted Flat" },
              { value: 3, label: "Ribbed/Fluted" }
            ];
          } else if (key === "bgType") {
            options = [
              { value: 0, label: "City Skyline" },
              { value: 1, label: "Beach Sunset" },
              { value: 2, label: "Bruneton Physical Atmosphere" },
              { value: 3, label: "Unified Sun (Scattering + Clouds)" }
            ];
          } else if (key === "horizonType") {
            options = [
              { value: 0, label: "None / flat sky" },
              { value: 1, label: "City skyline" },
              { value: 2, label: "Low hills" },
              { value: 3, label: "Tree line" }
            ];
          } else if (key === "surfaceType") {
            options = [
              { value: 0, label: "Sky only" },
              { value: 1, label: "Water plane" },
              { value: 2, label: "Grass / meadow" },
              { value: 3, label: "Plaza / stone" }
            ];
          } else if (key === "overlayType") {
            options = [
              { value: 0, label: "None" },
              { value: 1, label: "Reeds silhouette" },
              { value: 2, label: "Foreground grass" },
              { value: 3, label: "Tree canopy" }
            ];
          } else if (key === "unifiedPreset") {
            options = Object.entries(UNIFIED_SKY_PRESETS).map(([_k, v], i) => ({ value: i, label: (v as any).label }));
          }
          options.forEach(optData => {
            const opt = document.createElement("option");
            opt.value = String(optData.value);
            opt.textContent = optData.label;
            if (optData.value === Number(defaultValue)) opt.selected = true;
            input.appendChild(opt);
          });
        } else {
          input = document.createElement("input") as HTMLInputElement;
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
        details.appendChild(label);
      }
      controlForm.appendChild(details);
    }

    // Initialize DenseControls on the form
    state.controls = DenseControls.init(controlForm, {
      keyAttr: "setting",
    });

    // Listen for control changes (currently just updates state)
    state.controls.on("change", (key: string, value: any) => {
      state.config[key] = value;
      
      if (key === "glassPatternType") {
        const type = Number(value);
        let updates: Record<string, number> = {};
        
        if (type === 0) { // FBM Wavy
          updates = { glassHeightAmpl: 0.05, glassBump: 0.2, glassScale: 1.0, glassDistortion: 1.0 };
        } else if (type === 1) { // Frosted Flat
          updates = { glassHeightAmpl: 0.0, glassBump: 0.0, glassScale: 1.0, glassDistortion: 0.1, glassRoughness: 0.8 };
        } else if (type === 2) { // Pebbled
          updates = { glassHeightAmpl: 0.01, glassBump: 0.19, glassScale: 1.0, glassDistortion: 1.0 };
        } else if (type === 3) { // Ribbed
          updates = { glassHeightAmpl: 0.03, glassBump: 0.1, glassScale: 2.0, glassDistortion: 1.0 };
        }
        
        for (const [k, v] of Object.entries(updates)) {
          if (k in state.config) {
            state.config[k] = v;
            state.controls.set(k, v);
          }
        }
      }
      
      if (key === "unifiedPreset") {
        const presetKeys = Object.keys(UNIFIED_SKY_PRESETS);
        const presetKey = presetKeys[Number(value)];
        if (presetKey) {
          const preset = UNIFIED_SKY_PRESETS[presetKey];
          for (const [pk, pv] of Object.entries(preset)) {
            if (pk === "label") continue;
            if (pk in state.config) {
              state.config[pk] = pv;
              state.controls.set(pk, pv);
            }
          }
        }
      }

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
