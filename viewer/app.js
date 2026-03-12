const ROOT_PATH = "../";
const DEFAULT_RENDER_SIZE = 512;

const FALLBACK_PACK = {
  id: "v1/bathroom_window_shader",
  label: "v1 / bathroom_window_shader",
  basePath: "../v1/bathroom_window_shader",
  hasCommon: true,
  hasBufferA: true,
  hasReadme: true,
};

const FLOAT_SETTINGS = [
  { key: "sunAzimuth", define: "SUN_AZIMUTH", uniform: "uSunAzimuth", digits: 2 },
  { key: "sunElevation", define: "SUN_ELEVATION", uniform: "uSunElevation", digits: 3 },
  { key: "glassThickness", define: "GLASS_THICKNESS", uniform: "uGlassThickness", digits: 3 },
  { key: "glassBump", define: "GLASS_BUMP", uniform: "uGlassBump", digits: 3 },
  { key: "glassRoughness", define: "GLASS_ROUGHNESS", uniform: "uGlassRoughness", digits: 3 },
  { key: "glassHeightAmpl", define: "GLASS_HEIGHT_AMPL", uniform: "uGlassHeightAmpl", digits: 4 },
  { key: "glassIor", define: "GLASS_IOR", uniform: "uGlassIor", digits: 2 },
  { key: "cameraZ", define: "CAMERA_Z", uniform: "uCameraZ", digits: 2 },
  { key: "cameraFocal", define: "CAMERA_FOCAL", uniform: "uCameraFocal", digits: 2 },
];

const COMPILE_SETTINGS = [
  { key: "samplesPerFrame", token: "SAMPLES_PER_FRAME" },
  { key: "cloudSteps", token: "CLOUD_STEPS" },
  { key: "sunShadowSteps", token: "SUN_SHADOW_STEPS" },
];

const DEFAULT_CONFIG = {
  sceneStatic: true,
  samplesPerFrame: 2,
  cloudSteps: 8,
  sunShadowSteps: 3,
  sunAzimuth: 0.58,
  sunElevation: 0.055,
  glassThickness: 0.06,
  glassBump: 0.19,
  glassRoughness: 0.085,
  glassHeightAmpl: 0.01,
  glassIor: 1.52,
  cameraZ: 1.65,
  cameraFocal: 1.85,
};

const app = {
  canvas: document.querySelector("#shader-canvas"),
  errorLog: document.querySelector("#error-log"),
  statusFormat: document.querySelector("#status-format"),
  statusResolution: document.querySelector("#status-resolution"),
  statusFrame: document.querySelector("#status-frame"),
  reloadButton: document.querySelector("#reload-shaders"),
  resetButton: document.querySelector("#reset-accumulation"),
  packSelect: document.querySelector("#shader-pack"),
  packDetails: document.querySelector("#pack-details"),
  packSummary: document.querySelector("#pack-summary"),
  config: { ...DEFAULT_CONFIG },
  packs: [],
  activePack: null,
  frame: 0,
  startedAt: performance.now(),
  shaderSources: null,
  programs: null,
  rafId: 0,
  size: { width: 0, height: 0 },
};

const gl = app.canvas.getContext("webgl2", {
  antialias: false,
  alpha: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
});

if (!gl) {
  failHard("WebGL2 is required for this viewer.");
}

gl.getExtension("EXT_color_buffer_float");

const quadVao = gl.createVertexArray();
gl.bindVertexArray(quadVao);

const renderTargets = createRenderTargets(gl);

bindControls();
updateDisplayedValues();

void boot();

async function boot() {
  try {
    await refreshPackList();
    await activatePack(getRequestedPackId() || FALLBACK_PACK.id, { reloadSources: true });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }

  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !app.rafId) {
      app.rafId = requestAnimationFrame(renderFrame);
    }
  });

  resizeCanvas();
  app.rafId = requestAnimationFrame(renderFrame);
}

function failHard(message) {
  showError(message);
  throw new Error(message);
}

function bindControls() {
  const form = document.querySelector("#controls-form");

  form.querySelectorAll("[data-setting]").forEach((input) => {
    const setting = input.dataset.setting;
    const kind = input.dataset.kind;

    const handler = () => {
      app.config[setting] = readControlValue(input);
      updateDisplayedValues();

      if (kind === "uniform") {
        resetAccumulation();
      } else {
        void rebuildPrograms({ reloadSources: false });
      }
    };

    input.addEventListener(kind === "uniform" ? "input" : "change", handler);
  });

  app.packSelect.addEventListener("change", () => {
    void activatePack(app.packSelect.value, { reloadSources: true });
  });

  app.reloadButton.addEventListener("click", () => {
    void reloadCurrentPack();
  });

  app.resetButton.addEventListener("click", () => {
    resetAccumulation();
  });
}

function readControlValue(input) {
  if (input.type === "checkbox") {
    return input.checked;
  }

  if (input.tagName === "SELECT") {
    return Number(input.value);
  }

  return Number(input.value);
}

function updateDisplayedValues() {
  FLOAT_SETTINGS.forEach(({ key, digits }) => {
    const output = document.querySelector(`[data-output="${key}"]`);
    if (output) {
      output.value = Number(app.config[key]).toFixed(digits);
      output.textContent = output.value;
    }
  });
}

function resizeCanvas() {
  const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.min(DEFAULT_RENDER_SIZE, Math.floor(app.canvas.clientWidth * maxDpr)));
  const height = Math.max(1, Math.min(DEFAULT_RENDER_SIZE, Math.floor(app.canvas.clientHeight * maxDpr)));

  if (width === app.size.width && height === app.size.height) {
    return;
  }

  app.size.width = width;
  app.size.height = height;
  app.canvas.width = width;
  app.canvas.height = height;
  renderTargets.resize(width, height);
  resetAccumulation();
}

async function reloadCurrentPack() {
  await refreshPackList();
  await activatePack(app.activePack?.id || app.packSelect.value || FALLBACK_PACK.id, { reloadSources: true });
}

async function refreshPackList() {
  const discovered = await discoverShaderPacks();
  app.packs = dedupePacks(discovered);
  populatePackSelect();
}

function populatePackSelect() {
  app.packSelect.replaceChildren();

  app.packs.forEach((pack) => {
    const option = document.createElement("option");
    option.value = pack.id;
    option.textContent = pack.label;
    app.packSelect.append(option);
  });
}

async function activatePack(packId, { reloadSources }) {
  const nextPack = app.packs.find((pack) => pack.id === packId) || app.packs[0] || FALLBACK_PACK;
  const previousPack = app.activePack;

  try {
    const [shaderSources, readme] = await Promise.all([
      loadShaderSources(nextPack, reloadSources || !app.activePack || app.activePack.id !== nextPack.id),
      loadPackReadme(nextPack),
    ]);

    const compiled = compileAllPrograms(gl, shaderSources, app.config, nextPack);
    if (!compiled.ok) {
      showError(compiled.error);
      app.packSelect.value = previousPack?.id || nextPack.id;
      return;
    }

    clearError();
    destroyPrograms(app.programs);
    app.programs = compiled.programs;
    app.shaderSources = shaderSources;
    app.activePack = nextPack;
    app.packSelect.value = nextPack.id;
    updatePackSummary(nextPack, readme);
    setRequestedPackId(nextPack.id);
    resetAccumulation();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    if (previousPack) {
      app.packSelect.value = previousPack.id;
    }
  }
}

async function loadShaderSources(pack, forceReload) {
  if (!forceReload && app.shaderSources && app.activePack && app.activePack.id === pack.id) {
    return app.shaderSources;
  }

  const stamp = `t=${Date.now()}`;
  const [common, bufferA, image] = await Promise.all([
    pack.hasCommon ? fetchText(`${pack.basePath}/common.glsl?${stamp}`) : Promise.resolve(""),
    pack.hasBufferA ? fetchText(`${pack.basePath}/buffer_a.glsl?${stamp}`) : Promise.resolve(""),
    fetchText(`${pack.basePath}/image.glsl?${stamp}`),
  ]);

  return { common, bufferA, image };
}

async function loadPackReadme(pack) {
  if (!pack.hasReadme) {
    return "";
  }

  try {
    return await fetchText(`${pack.basePath}/README.md?t=${Date.now()}`);
  } catch {
    return "";
  }
}

function updatePackSummary(pack, readme) {
  const mode = pack.hasBufferA ? "multi-pass" : "single-pass";
  const summary = summarizeReadme(readme) || `Loaded ${mode} shader pack from ${pack.id}.`;
  const parts = [`${pack.id}`, mode];
  if (pack.hasCommon) {
    parts.push("common.glsl");
  }
  if (pack.hasBufferA) {
    parts.push("buffer_a.glsl");
  }

  app.packSummary.textContent = summary;
  app.packDetails.textContent = parts.join(" • ");
}

function summarizeReadme(readme) {
  const trimmed = readme.trim();
  if (!trimmed) {
    return "";
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length > 0);

  return lines.slice(0, 3).join(" ").slice(0, 240);
}

function getRequestedPackId() {
  const url = new URL(window.location.href);
  return url.searchParams.get("pack");
}

function setRequestedPackId(packId) {
  const url = new URL(window.location.href);
  url.searchParams.set("pack", packId);
  window.history.replaceState({}, "", url);
}

async function discoverShaderPacks() {
  try {
    const rootUrl = new URL(ROOT_PATH, import.meta.url).href;
    const found = [];
    const visited = new Set();

    await crawlDirectory(rootUrl, "", 0, found, visited);
    if (found.length === 0) {
      return [FALLBACK_PACK];
    }

    return found.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [FALLBACK_PACK];
  }
}

async function crawlDirectory(directoryUrl, relativePath, depth, found, visited) {
  if (depth > 6 || visited.has(relativePath)) {
    return;
  }

  visited.add(relativePath);

  const html = await fetchText(`${directoryUrl}${directoryUrl.includes("?") ? "&" : "?"}t=${Date.now()}`);
  const entries = parseDirectoryEntries(html, directoryUrl);

  const files = new Set();
  const childDirs = [];

  entries.forEach((entry) => {
    if (entry.isDirectory) {
      if (!shouldSkipDirectory(entry.name)) {
        childDirs.push({
          url: entry.url,
          relativePath: relativePath ? `${relativePath}/${entry.name}` : entry.name,
        });
      }
      return;
    }

    files.add(entry.name);
  });

  if (relativePath && files.has("image.glsl")) {
    found.push({
      id: relativePath,
      label: relativePath.replace(/\//g, " / "),
      basePath: `../${relativePath}`,
      hasCommon: files.has("common.glsl"),
      hasBufferA: files.has("buffer_a.glsl"),
      hasReadme: files.has("README.md"),
    });
  }

  for (const child of childDirs) {
    await crawlDirectory(child.url, child.relativePath, depth + 1, found, visited);
  }
}

function parseDirectoryEntries(html, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const anchors = [...doc.querySelectorAll("a[href]")];

  return anchors
    .map((anchor) => anchor.getAttribute("href"))
    .filter(Boolean)
    .filter((href) => href !== "../" && href !== "./")
    .map((href) => {
      const isDirectory = href.endsWith("/");
      const rawName = isDirectory ? href.slice(0, -1) : href;
      const name = decodeURIComponent(rawName.replace(/\/$/, ""));
      return {
        name,
        isDirectory,
        url: new URL(href, baseUrl).href,
      };
    });
}

function shouldSkipDirectory(name) {
  return (
    name.startsWith(".") ||
    name === "viewer" ||
    name === "output" ||
    name === "node_modules"
  );
}

function dedupePacks(packs) {
  const deduped = new Map();
  packs.forEach((pack) => {
    deduped.set(pack.id, pack);
  });

  if (!deduped.has(FALLBACK_PACK.id)) {
    deduped.set(FALLBACK_PACK.id, FALLBACK_PACK);
  }

  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function rebuildPrograms({ reloadSources }) {
  if (!app.activePack) {
    return;
  }

  const shaderSources = await loadShaderSources(app.activePack, reloadSources);
  const compiled = compileAllPrograms(gl, shaderSources, app.config, app.activePack);
  if (!compiled.ok) {
    showError(compiled.error);
    return;
  }

  clearError();
  destroyPrograms(app.programs);
  app.programs = compiled.programs;
  app.shaderSources = shaderSources;
  resetAccumulation();
}

function compileAllPrograms(glContext, shaderSources, config, pack) {
  try {
    const commonSource = patchCommonShader(shaderSources.common || "", config);
    const imageSource = buildFragmentSource(commonSource, shaderSources.image);
    const imageProgram = createProgramInfo(glContext, "Image", imageSource);

    const bufferProgram = pack.hasBufferA
      ? createProgramInfo(glContext, "Buffer A", buildFragmentSource(commonSource, shaderSources.bufferA))
      : null;

    return {
      ok: true,
      programs: {
        buffer: bufferProgram,
        image: imageProgram,
        usesBufferA: Boolean(bufferProgram),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function patchCommonShader(source, config) {
  let patched = source || "";

  if (patched.includes("#define SCENE_STATIC")) {
    patched = patched.replace(/^#define\s+SCENE_STATIC\s+\d+/m, `#define SCENE_STATIC ${config.sceneStatic ? 1 : 0}`);
  } else {
    patched = `#define SCENE_STATIC ${config.sceneStatic ? 1 : 0}\n${patched}`;
  }

  COMPILE_SETTINGS.forEach(({ key, token }) => {
    const value = Math.max(1, Number(config[key]) | 0);
    const pattern = new RegExp(`const\\s+int\\s+${token}\\s*=\\s*[^;]+;`);
    if (pattern.test(patched)) {
      patched = patched.replace(pattern, `const int ${token} = ${value};`);
    } else {
      patched = `const int ${token} = ${value};\n${patched}`;
    }
  });

  FLOAT_SETTINGS.forEach(({ define, uniform }) => {
    const pattern = new RegExp(`const\\s+float\\s+${define}\\s*=\\s*[^;]+;`);
    if (pattern.test(patched)) {
      patched = patched.replace(pattern, `#define ${define} ${uniform}`);
    } else {
      patched = `#define ${define} ${uniform}\n${patched}`;
    }
  });

  const uniformLines = FLOAT_SETTINGS.map(({ uniform }) => `uniform float ${uniform};`).join("\n");
  return `${uniformLines}\n${patched}`;
}

function buildFragmentSource(commonSource, passSource) {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec3 iResolution;
uniform float iTime;
uniform int iFrame;
uniform sampler2D iChannel0;

out vec4 outColor;

${commonSource}

${passSource}

void main() {
  mainImage(outColor, gl_FragCoord.xy);
}
`;
}

function createProgramInfo(glContext, label, fragmentSource) {
  const vertexSource = `#version 300 es
void main() {
  vec2 p;
  if (gl_VertexID == 0) {
    p = vec2(-1.0, -1.0);
  } else if (gl_VertexID == 1) {
    p = vec2(3.0, -1.0);
  } else {
    p = vec2(-1.0, 3.0);
  }
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

  const vertexShader = compileShader(glContext, glContext.VERTEX_SHADER, vertexSource, `${label} vertex`);
  const fragmentShader = compileShader(glContext, glContext.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  const program = glContext.createProgram();

  glContext.attachShader(program, vertexShader);
  glContext.attachShader(program, fragmentShader);
  glContext.linkProgram(program);

  if (!glContext.getProgramParameter(program, glContext.LINK_STATUS)) {
    const info = glContext.getProgramInfoLog(program) || "Unknown link error";
    glContext.deleteProgram(program);
    glContext.deleteShader(vertexShader);
    glContext.deleteShader(fragmentShader);
    throw new Error(`${label} link error:\n${info}`);
  }

  glContext.deleteShader(vertexShader);
  glContext.deleteShader(fragmentShader);

  return {
    label,
    program,
    uniforms: {
      iResolution: glContext.getUniformLocation(program, "iResolution"),
      iTime: glContext.getUniformLocation(program, "iTime"),
      iFrame: glContext.getUniformLocation(program, "iFrame"),
      iChannel0: glContext.getUniformLocation(program, "iChannel0"),
      live: Object.fromEntries(
        FLOAT_SETTINGS.map(({ key, uniform }) => [key, glContext.getUniformLocation(program, uniform)])
      ),
    },
  };
}

function compileShader(glContext, type, source, label) {
  const shader = glContext.createShader(type);
  glContext.shaderSource(shader, source);
  glContext.compileShader(shader);

  if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
    const info = glContext.getShaderInfoLog(shader) || "Unknown compile error";
    glContext.deleteShader(shader);
    throw new Error(`${label} compile error:\n${info}`);
  }

  return shader;
}

function destroyPrograms(programs) {
  if (!programs) {
    return;
  }

  if (programs.buffer) {
    gl.deleteProgram(programs.buffer.program);
  }
  gl.deleteProgram(programs.image.program);
}

function createRenderTargets(glContext) {
  const candidates = [
    { internalFormat: glContext.RGBA16F, format: glContext.RGBA, type: glContext.HALF_FLOAT, label: "RGBA16F" },
    { internalFormat: glContext.RGBA8, format: glContext.RGBA, type: glContext.UNSIGNED_BYTE, label: "RGBA8" },
  ];

  const chosen = candidates.find((candidate) => testRenderTarget(glContext, candidate)) || candidates[candidates.length - 1];
  let width = 1;
  let height = 1;
  let readIndex = 0;
  const targets = [makeTarget(), makeTarget()];

  app.statusFormat.textContent = `Accumulation ${chosen.label}`;

  return {
    get readTexture() {
      return targets[readIndex].texture;
    },
    get writeTexture() {
      return targets[1 - readIndex].texture;
    },
    get writeFramebuffer() {
      return targets[1 - readIndex].framebuffer;
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;

      targets.forEach((target) => {
        glContext.bindTexture(glContext.TEXTURE_2D, target.texture);
        glContext.texImage2D(
          glContext.TEXTURE_2D,
          0,
          chosen.internalFormat,
          width,
          height,
          0,
          chosen.format,
          chosen.type,
          null
        );
      });

      this.clear();
    },
    clear() {
      const previousFbo = glContext.getParameter(glContext.FRAMEBUFFER_BINDING);
      const previousViewport = glContext.getParameter(glContext.VIEWPORT);

      targets.forEach((target) => {
        glContext.bindFramebuffer(glContext.FRAMEBUFFER, target.framebuffer);
        glContext.viewport(0, 0, width, height);
        glContext.clearColor(0, 0, 0, 0);
        glContext.clear(glContext.COLOR_BUFFER_BIT);
      });

      glContext.bindFramebuffer(glContext.FRAMEBUFFER, previousFbo);
      glContext.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
      readIndex = 0;
    },
    swap() {
      readIndex = 1 - readIndex;
    },
  };

  function makeTarget() {
    const texture = glContext.createTexture();
    glContext.bindTexture(glContext.TEXTURE_2D, texture);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.NEAREST);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.NEAREST);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.CLAMP_TO_EDGE);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
    glContext.texImage2D(
      glContext.TEXTURE_2D,
      0,
      chosen.internalFormat,
      width,
      height,
      0,
      chosen.format,
      chosen.type,
      null
    );

    const framebuffer = glContext.createFramebuffer();
    glContext.bindFramebuffer(glContext.FRAMEBUFFER, framebuffer);
    glContext.framebufferTexture2D(
      glContext.FRAMEBUFFER,
      glContext.COLOR_ATTACHMENT0,
      glContext.TEXTURE_2D,
      texture,
      0
    );

    return { texture, framebuffer };
  }
}

function testRenderTarget(glContext, candidate) {
  const texture = glContext.createTexture();
  const framebuffer = glContext.createFramebuffer();

  glContext.bindTexture(glContext.TEXTURE_2D, texture);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.NEAREST);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.NEAREST);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.CLAMP_TO_EDGE);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
  glContext.texImage2D(
    glContext.TEXTURE_2D,
    0,
    candidate.internalFormat,
    1,
    1,
    0,
    candidate.format,
    candidate.type,
    null
  );

  glContext.bindFramebuffer(glContext.FRAMEBUFFER, framebuffer);
  glContext.framebufferTexture2D(
    glContext.FRAMEBUFFER,
    glContext.COLOR_ATTACHMENT0,
    glContext.TEXTURE_2D,
    texture,
    0
  );

  const ok = glContext.checkFramebufferStatus(glContext.FRAMEBUFFER) === glContext.FRAMEBUFFER_COMPLETE;

  glContext.deleteFramebuffer(framebuffer);
  glContext.deleteTexture(texture);
  glContext.bindFramebuffer(glContext.FRAMEBUFFER, null);

  return ok;
}

function renderFrame() {
  app.rafId = 0;

  if (document.hidden) {
    return;
  }

  resizeCanvas();

  if (!app.programs) {
    app.rafId = requestAnimationFrame(renderFrame);
    return;
  }

  const time = elapsedSeconds();
  const width = app.size.width;
  const height = app.size.height;

  gl.bindVertexArray(quadVao);

  if (app.programs.usesBufferA) {
    drawPass(app.programs.buffer, renderTargets.writeFramebuffer, renderTargets.readTexture, width, height, time);
    drawPass(app.programs.image, null, renderTargets.writeTexture, width, height, time);
    renderTargets.swap();
  } else {
    drawPass(app.programs.image, null, renderTargets.readTexture, width, height, time);
  }

  app.frame += 1;
  app.statusResolution.textContent = `${width} x ${height}`;
  app.statusFrame.textContent = `frame ${app.frame}`;

  app.rafId = requestAnimationFrame(renderFrame);
}

function drawPass(programInfo, framebuffer, sourceTexture, width, height, time) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, width, height);
  gl.useProgram(programInfo.program);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(programInfo.uniforms.iChannel0, 0);
  gl.uniform3f(programInfo.uniforms.iResolution, width, height, 1.0);
  gl.uniform1f(programInfo.uniforms.iTime, time);
  gl.uniform1i(programInfo.uniforms.iFrame, app.frame);

  FLOAT_SETTINGS.forEach(({ key }) => {
    const location = programInfo.uniforms.live[key];
    if (location) {
      gl.uniform1f(location, Number(app.config[key]));
    }
  });

  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function resetAccumulation() {
  app.frame = 0;
  app.startedAt = performance.now();
  renderTargets.clear();
}

function elapsedSeconds() {
  return (performance.now() - app.startedAt) * 0.001;
}

function showError(message) {
  app.errorLog.hidden = false;
  app.errorLog.textContent = message;
}

function clearError() {
  app.errorLog.hidden = true;
  app.errorLog.textContent = "";
}
