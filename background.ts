/**
 * Standalone background preview — renders the unified sky to a full canvas
 * with controls for all parameters and presets.
 */
import {
  BackgroundManager,
  UNIFIED_SKY_DEFAULTS,
  UNIFIED_SKY_PRESETS,
  type UnifiedSkyConfig,
} from "./core/background_manager";

// ─── State ───────────────────────────────────────────────────────────────────

const config: Record<string, number> = { ...UNIFIED_SKY_DEFAULTS, sunAzimuth: 0.14, sunElevation: 0.073 };
let paused = false;
let device: GPUDevice;
let bgManager: BackgroundManager;
let displayPipeline: GPURenderPipeline;
let displayBindGroup: GPUBindGroup;
let displaySampler: GPUSampler;
let canvas: HTMLCanvasElement;
let ctx: GPUCanvasContext;
let presentFormat: GPUTextureFormat;
let lastBgView: GPUTextureView | null = null;

// ─── Display shader (blit equirect texture to screen) ────────────────────────

const BLIT_WGSL = /* wgsl */ `
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0, 1);
  o.uv = p[vi] * 0.5 + 0.5;
  return o;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  let c = textureSample(tex, samp, in.uv).rgb;
  // Simple ACES tone map
  let a = c * (2.51 * c + 0.03);
  let b = c * (2.43 * c + 0.59) + 0.14;
  let mapped = clamp(a / b, vec3f(0), vec3f(1));
  return vec4f(mapped, 1);
}
`;

// ─── Control definitions ─────────────────────────────────────────────────────

interface ControlDef {
  key: string;
  label: string;
  type: "range" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
  group: string;
}

const CONTROL_DEFS: ControlDef[] = [
  { key: "preset", label: "Preset", type: "select", group: "Scene",
    options: Object.entries(UNIFIED_SKY_PRESETS).map(([_k, v], i) => ({ value: i, label: v.label })) },
  { key: "sunAzimuth", label: "Sun azimuth", type: "range", min: -3.14, max: 3.14, step: 0.01, group: "Scene" },
  { key: "sunElevation", label: "Sun elevation", type: "range", min: -0.1, max: 0.8, step: 0.001, group: "Scene" },
  { key: "sunIntensity", label: "Sun intensity", type: "range", min: 0.5, max: 2.0, step: 0.01, group: "Scene" },
  { key: "sunVisible", label: "Sun disk", type: "range", min: 0, max: 1, step: 1, group: "Scene" },

  { key: "horizonType", label: "Horizon", type: "select", group: "Scene",
    options: [{ value: 0, label: "None" }, { value: 1, label: "City skyline" }, { value: 2, label: "Low hills" }, { value: 3, label: "Tree line" }] },
  { key: "surfaceType", label: "Surface", type: "select", group: "Scene",
    options: [{ value: 0, label: "Sky only" }, { value: 1, label: "Water" }, { value: 2, label: "Grass" }, { value: 3, label: "Plaza / stone" }] },
  { key: "overlayType", label: "Overlay", type: "select", group: "Scene",
    options: [{ value: 0, label: "None" }, { value: 1, label: "Reeds" }, { value: 2, label: "Foreground grass" }, { value: 3, label: "Tree canopy" }] },

  { key: "cloudCoverage", label: "Cloud coverage", type: "range", min: 0, max: 1, step: 0.01, group: "Clouds" },
  { key: "cloudScale", label: "Cloud scale", type: "range", min: 0.01, max: 0.15, step: 0.001, group: "Clouds" },
  { key: "cloudSpeed", label: "Cloud speed", type: "range", min: 0, max: 0.1, step: 0.001, group: "Clouds" },
  { key: "cloudHeight", label: "Cloud height", type: "range", min: 4, max: 16, step: 0.1, group: "Clouds" },
  { key: "cloudThickness", label: "Thickness", type: "range", min: 0.1, max: 2.0, step: 0.01, group: "Clouds" },
  { key: "cloudEdge", label: "Edge softness", type: "range", min: 0.05, max: 0.3, step: 0.01, group: "Clouds" },
  { key: "cloudDetail", label: "Detail", type: "range", min: 0.3, max: 1.5, step: 0.01, group: "Clouds" },
  { key: "cloudShadowStrength", label: "Shadow strength", type: "range", min: 0, max: 1.5, step: 0.01, group: "Clouds" },
  { key: "cloudTintR", label: "Tint R", type: "range", min: 0.8, max: 1.2, step: 0.01, group: "Clouds" },
  { key: "cloudTintG", label: "Tint G", type: "range", min: 0.8, max: 1.2, step: 0.01, group: "Clouds" },
  { key: "cloudTintB", label: "Tint B", type: "range", min: 0.8, max: 1.2, step: 0.01, group: "Clouds" },

  { key: "rayleighStrength", label: "Rayleigh", type: "range", min: 0.2, max: 2.0, step: 0.01, group: "Atmosphere" },
  { key: "mieStrength", label: "Mie", type: "range", min: 0.2, max: 2.0, step: 0.01, group: "Atmosphere" },
  { key: "turbidity", label: "Turbidity", type: "range", min: 0.4, max: 5.5, step: 0.01, group: "Atmosphere" },
  { key: "hazeDensity", label: "Haze", type: "range", min: 0, max: 0.1, step: 0.001, group: "Atmosphere" },
  { key: "fogDensity", label: "Fog density", type: "range", min: 0, max: 0.05, step: 0.001, group: "Atmosphere" },

  { key: "horizonDistance", label: "Horizon dist", type: "range", min: 20, max: 160, step: 1, group: "Materials" },
  { key: "cityHeight", label: "City height", type: "range", min: 0.01, max: 0.16, step: 0.001, group: "Materials" },
  { key: "cityDensity", label: "City density", type: "range", min: 8, max: 140, step: 1, group: "Materials" },
  { key: "surfaceRoughness", label: "Surface roughness", type: "range", min: 0.05, max: 1.0, step: 0.01, group: "Materials" },
  { key: "vegetationDensity", label: "Vegetation", type: "range", min: 0.1, max: 1.5, step: 0.01, group: "Materials" },
  { key: "foamAmount", label: "Water foam", type: "range", min: 0, max: 1.2, step: 0.01, group: "Materials" },
];

// ─── UI ──────────────────────────────────────────────────────────────────────

const controlRefs = new Map<string, { input: HTMLInputElement | HTMLSelectElement; valueEl: HTMLSpanElement; def: ControlDef }>();

function buildControls() {
  const form = document.getElementById("controls") as HTMLFormElement;
  const groups = new Map<string, HTMLElement>();

  for (const def of CONTROL_DEFS) {
    if (!groups.has(def.group)) {
      const details = document.createElement("details");
      details.className = "control-group";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = def.group;
      details.appendChild(summary);
      form.appendChild(details);
      groups.set(def.group, details);
    }

    const label = document.createElement("label");
    label.style.display = "flex";
    label.style.justifyContent = "space-between";
    label.style.alignItems = "center";
    label.style.gap = "8px";
    label.style.marginBottom = "6px";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = def.label;
    nameSpan.style.flexShrink = "0";
    nameSpan.style.fontSize = "0.85em";
    nameSpan.style.color = "#bbb";

    const valueSpan = document.createElement("span");
    valueSpan.style.fontSize = "0.8em";
    valueSpan.style.color = "#8cf";
    valueSpan.style.fontFamily = "monospace";
    valueSpan.style.minWidth = "40px";
    valueSpan.style.textAlign = "right";

    let input: HTMLInputElement | HTMLSelectElement;

    if (def.type === "select") {
      input = document.createElement("select");
      input.style.flex = "1";
      input.style.maxWidth = "140px";
      for (const opt of def.options!) {
        const el = document.createElement("option");
        el.value = String(opt.value);
        el.textContent = opt.label;
        input.appendChild(el);
      }
      if (def.key !== "preset") {
        input.value = String(config[def.key] ?? 0);
      }
      input.addEventListener("change", () => {
        if (def.key === "preset") {
          applyPreset(Number(input.value));
        } else {
          config[def.key] = Number(input.value);
        }
        syncDisplay(def.key);
      });
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.style.flex = "1";
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.value = String(config[def.key] ?? 0);
      input.addEventListener("input", () => {
        config[def.key] = Number(input.value);
        syncDisplay(def.key);
      });
    }

    label.appendChild(nameSpan);
    label.appendChild(input);
    label.appendChild(valueSpan);
    groups.get(def.group)!.appendChild(label);
    controlRefs.set(def.key, { input, valueEl: valueSpan, def });
    syncDisplay(def.key);
  }
}

function syncDisplay(key: string) {
  const ref = controlRefs.get(key);
  if (!ref) return;
  const val = key === "preset" ? ref.input.value : config[key];
  if (ref.def.type === "select") {
    const opt = ref.def.options?.find(o => String(o.value) === String(val));
    ref.valueEl.textContent = opt?.label ?? String(val);
  } else {
    const n = Number(val);
    ref.valueEl.textContent = Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3);
  }
}

function syncAllControls() {
  for (const [key, ref] of controlRefs) {
    if (key === "preset") continue;
    if (ref.input instanceof HTMLSelectElement) {
      ref.input.value = String(config[key] ?? 0);
    } else {
      ref.input.value = String(config[key] ?? 0);
    }
    syncDisplay(key);
  }
}

function applyPreset(index: number) {
  const keys = Object.keys(UNIFIED_SKY_PRESETS);
  const key = keys[index];
  if (!key) return;
  const preset = UNIFIED_SKY_PRESETS[key];
  for (const [pk, pv] of Object.entries(preset)) {
    if (pk === "label") continue;
    config[pk] = pv as number;
  }
  syncAllControls();
}

// ─── WebGPU init ─────────────────────────────────────────────────────────────

async function initGPU() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter");
  device = await adapter.requestDevice();

  canvas = document.getElementById("canvas") as HTMLCanvasElement;
  ctx = canvas.getContext("webgpu")!;
  presentFormat = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: presentFormat, alphaMode: "opaque" });

  bgManager = new BackgroundManager(device);

  displaySampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const module = device.createShaderModule({ code: BLIT_WGSL });
  displayPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentFormat }] },
    primitive: { topology: "triangle-list" },
  });
}

function rebuildBindGroup(bgTexView: GPUTextureView) {
  displayBindGroup = device.createBindGroup({
    layout: displayPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: displaySampler },
      { binding: 1, resource: bgTexView },
    ],
  });
  lastBgView = bgTexView;
}

// ─── Render loop ─────────────────────────────────────────────────────────────

let frameCount = 0;
let fpsAccum = 0;
let fps = 0;
let lastTime = 0;

async function frame(now: number) {
  requestAnimationFrame(frame);
  if (paused) return;

  const dt = lastTime ? (now - lastTime) * 0.001 : 0.016;
  lastTime = now;
  fpsAccum += dt;
  frameCount++;
  if (fpsAccum >= 0.5) {
    fps = frameCount / fpsAccum;
    fpsAccum = 0;
    frameCount = 0;
  }

  const sunDir = [config.sunAzimuth ?? 0.14, config.sunElevation ?? 0.073];
  const unifiedCfg: Partial<UnifiedSkyConfig> = {};
  for (const key of Object.keys(UNIFIED_SKY_DEFAULTS) as (keyof UnifiedSkyConfig)[]) {
    if (key in config) unifiedCfg[key] = config[key];
  }

  const bgTex = await bgManager.getBackground("unified", sunDir, 1024, unifiedCfg);
  const bgView = bgTex.createView();

  // Rebuild bind group when texture view changes
  if (bgView !== lastBgView) {
    rebuildBindGroup(bgView);
  }

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  pass.setPipeline(displayPipeline);
  pass.setBindGroup(0, displayBindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);

  // Stats
  const statsEl = document.getElementById("stats-panel")!;
  statsEl.innerHTML = `<div class="stat-card"><span class="stat-label">FPS</span><strong class="stat-value">${fps.toFixed(1)}</strong></div>`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function main() {
  buildControls();

  const pauseBtn = document.getElementById("pause-btn")!;
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
  });

  try {
    await initGPU();
  } catch (e: any) {
    const err = document.getElementById("error")!;
    err.textContent = e?.message ?? String(e);
    return;
  }

  requestAnimationFrame(frame);
}

main().catch(console.error);
