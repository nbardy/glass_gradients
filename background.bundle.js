(() => {
  // core/atmosphere_generator.ts
  var AtmosphereGenerator = class {
    device;
    transmittancePipeline;
    scatteringPipeline;
    uniformBuffer;
    bindGroup;
    transmittanceTexture;
    scatteringTexture;
    singleMieTexture;
    tSize;
    sSize;
    constructor(device2, shaderCode, config2) {
      this.device = device2;
      const module = device2.createShaderModule({ code: shaderCode });
      this.transmittancePipeline = device2.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "compute_transmittance" }
      });
      this.scatteringPipeline = device2.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "compute_single_scattering" }
      });
      this.tSize = config2.transmittanceSize ?? [256, 64];
      this.sSize = config2.scatteringSize ?? [8, 128, 32, 32];
      this.transmittanceTexture = device2.createTexture({
        size: [this.tSize[0], this.tSize[1], 1],
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      });
      this.scatteringTexture = device2.createTexture({
        size: [this.sSize[0] * this.sSize[1], this.sSize[2], this.sSize[3]],
        dimension: "3d",
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      });
      this.singleMieTexture = device2.createTexture({
        size: [this.sSize[0] * this.sSize[1], this.sSize[2], this.sSize[3]],
        dimension: "3d",
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      });
      this.uniformBuffer = device2.createBuffer({
        size: 144,
        // 36 floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      const bindGroupLayout = device2.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } }
        ]
      });
      const pipelineLayout = device2.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      this.transmittancePipeline = device2.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: "compute_transmittance" }
      });
      this.scatteringPipeline = device2.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: "compute_single_scattering" }
      });
      this.bindGroup = device2.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.transmittanceTexture.createView() },
          { binding: 2, resource: this.scatteringTexture.createView() },
          { binding: 3, resource: this.singleMieTexture.createView() }
        ]
      });
      this.updateConfig(config2);
    }
    updateConfig(config2) {
      const data = new Float32Array(36);
      const u32Data = new Uint32Array(data.buffer);
      data[0] = config2.bottomRadius ?? 6360;
      data[1] = config2.topRadius ?? 6420;
      data[2] = config2.rayleighDensityH ?? 8;
      data[3] = config2.mieDensityH ?? 1.2;
      const rScat = config2.rayleighScattering ?? [58e-4, 0.0135, 0.0331];
      data[4] = rScat[0];
      data[5] = rScat[1];
      data[6] = rScat[2];
      const mScat = config2.mieScattering ?? [39e-4, 39e-4, 39e-4];
      data[8] = mScat[0];
      data[9] = mScat[1];
      data[10] = mScat[2];
      const mExt = config2.mieExtinction ?? [44e-4, 44e-4, 44e-4];
      data[12] = mExt[0];
      data[13] = mExt[1];
      data[14] = mExt[2];
      const oAbs = config2.ozoneAbsorption ?? [65e-5, 188e-5, 85e-6];
      data[16] = oAbs[0];
      data[17] = oAbs[1];
      data[18] = oAbs[2];
      data[19] = config2.ozoneCenterH ?? 25;
      data[20] = config2.ozoneWidth ?? 15;
      u32Data[28] = this.tSize[0];
      u32Data[29] = this.tSize[1];
      u32Data[32] = this.sSize[0];
      u32Data[33] = this.sSize[1];
      u32Data[34] = this.sSize[2];
      u32Data[35] = this.sSize[3];
      this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    generate(commandEncoder) {
      const isInternalEncoder = !commandEncoder;
      const encoder = commandEncoder || this.device.createCommandEncoder();
      const tPass = encoder.beginComputePass();
      tPass.setPipeline(this.transmittancePipeline);
      tPass.setBindGroup(0, this.bindGroup);
      tPass.dispatchWorkgroups(
        Math.ceil(this.tSize[0] / 8),
        Math.ceil(this.tSize[1] / 8)
      );
      tPass.end();
      const sPass = encoder.beginComputePass();
      sPass.setPipeline(this.scatteringPipeline);
      sPass.setBindGroup(0, this.bindGroup);
      sPass.dispatchWorkgroups(
        Math.ceil(this.sSize[0] * this.sSize[1] / 8),
        Math.ceil(this.sSize[2] / 8),
        Math.ceil(this.sSize[3] / 8)
      );
      sPass.end();
      if (isInternalEncoder) {
        this.device.queue.submit([encoder.finish()]);
      }
    }
    destroy() {
      this.transmittanceTexture.destroy();
      this.scatteringTexture.destroy();
      this.singleMieTexture.destroy();
      this.uniformBuffer.destroy();
    }
  };

  // core/background_manager.ts
  var UNIFIED_SKY_DEFAULTS = {
    sunIntensity: 1.45,
    rayleighStrength: 0.82,
    mieStrength: 1.15,
    turbidity: 3.4,
    hazeDensity: 0.06,
    cloudCoverage: 0.14,
    cloudScale: 0.05,
    cloudSpeed: 0.02,
    cloudHeight: 10,
    cloudThickness: 1,
    cloudEdge: 0.12,
    cloudDetail: 0.75,
    cloudShadowStrength: 0.8,
    horizonType: 1,
    // 0=none, 1=city, 2=hills, 3=treeline
    surfaceType: 0,
    // 0=sky-only, 1=water, 2=grass, 3=plaza
    horizonDistance: 125,
    cityHeight: 0.095,
    cityDensity: 96,
    surfaceRoughness: 0.35,
    fogDensity: 0.018,
    sunVisible: 1,
    cloudTintR: 1.04,
    cloudTintG: 0.96,
    cloudTintB: 0.92,
    overlayType: 0,
    // 0=none, 1=reeds, 2=foreground grass, 3=tree canopy
    vegetationDensity: 0.45,
    foamAmount: 0.15,
    waterLevel: 0,
    groundLevel: 0
  };
  var UNIFIED_SKY_PRESETS = {
    citySunset: {
      label: "City sunset",
      sunIntensity: 1.45,
      rayleighStrength: 0.82,
      mieStrength: 1.15,
      turbidity: 3.4,
      hazeDensity: 0.06,
      cloudCoverage: 0.14,
      cloudScale: 0.05,
      cloudSpeed: 0.02,
      cloudHeight: 10,
      cloudThickness: 1,
      cloudEdge: 0.12,
      cloudDetail: 0.75,
      cloudShadowStrength: 0.8,
      horizonType: 1,
      surfaceType: 0,
      horizonDistance: 125,
      cityHeight: 0.095,
      cityDensity: 96,
      surfaceRoughness: 0.35,
      fogDensity: 0.018,
      sunVisible: 1,
      cloudTintR: 1.04,
      cloudTintG: 0.96,
      cloudTintB: 0.92,
      overlayType: 0,
      vegetationDensity: 0.45,
      foamAmount: 0.15,
      waterLevel: 0,
      groundLevel: 0
    },
    reedsLake: {
      label: "Reeds / lake sunset",
      sunIntensity: 1.2,
      rayleighStrength: 0.75,
      mieStrength: 1.05,
      turbidity: 3.2,
      hazeDensity: 0.055,
      cloudCoverage: 0.08,
      cloudScale: 0.055,
      cloudSpeed: 0.018,
      cloudHeight: 8,
      cloudThickness: 1,
      cloudEdge: 0.14,
      cloudDetail: 0.75,
      cloudShadowStrength: 0.65,
      horizonType: 0,
      surfaceType: 1,
      horizonDistance: 82,
      cityHeight: 0.06,
      cityDensity: 32,
      surfaceRoughness: 0.22,
      fogDensity: 0.028,
      sunVisible: 1,
      cloudTintR: 1.02,
      cloudTintG: 0.96,
      cloudTintB: 0.93,
      overlayType: 1,
      vegetationDensity: 1,
      foamAmount: 0.1,
      waterLevel: 0,
      groundLevel: 0
    },
    grassyField: {
      label: "Low grass horizon",
      sunIntensity: 1.1,
      rayleighStrength: 0.9,
      mieStrength: 0.95,
      turbidity: 2.1,
      hazeDensity: 0.022,
      cloudCoverage: 0.34,
      cloudScale: 0.06,
      cloudSpeed: 0.02,
      cloudHeight: 9,
      cloudThickness: 1,
      cloudEdge: 0.14,
      cloudDetail: 0.85,
      cloudShadowStrength: 0.7,
      horizonType: 2,
      surfaceType: 2,
      horizonDistance: 70,
      cityHeight: 0.06,
      cityDensity: 36,
      surfaceRoughness: 0.35,
      fogDensity: 0.012,
      sunVisible: 1,
      cloudTintR: 1,
      cloudTintG: 0.98,
      cloudTintB: 0.97,
      overlayType: 2,
      vegetationDensity: 0.85,
      foamAmount: 0.1,
      waterLevel: 0,
      groundLevel: 0
    },
    oceanDrama: {
      label: "Dramatic ocean",
      sunIntensity: 1.5,
      rayleighStrength: 0.8,
      mieStrength: 1.18,
      turbidity: 4.1,
      hazeDensity: 0.048,
      cloudCoverage: 0.76,
      cloudScale: 0.05,
      cloudSpeed: 0.016,
      cloudHeight: 10,
      cloudThickness: 1,
      cloudEdge: 0.18,
      cloudDetail: 1,
      cloudShadowStrength: 1,
      horizonType: 0,
      surfaceType: 1,
      horizonDistance: 110,
      cityHeight: 0.06,
      cityDensity: 32,
      surfaceRoughness: 0.18,
      fogDensity: 0.02,
      sunVisible: 1,
      cloudTintR: 1.08,
      cloudTintG: 0.92,
      cloudTintB: 0.88,
      overlayType: 0,
      vegetationDensity: 0.4,
      foamAmount: 0.65,
      waterLevel: 0,
      groundLevel: 0
    },
    blueMeadow: {
      label: "Blue-sky meadow",
      sunIntensity: 1,
      rayleighStrength: 1.1,
      mieStrength: 0.7,
      turbidity: 0.9,
      hazeDensity: 0.01,
      cloudCoverage: 0.4,
      cloudScale: 0.05,
      cloudSpeed: 0.015,
      cloudHeight: 9,
      cloudThickness: 1,
      cloudEdge: 0.15,
      cloudDetail: 0.85,
      cloudShadowStrength: 0.55,
      horizonType: 0,
      surfaceType: 2,
      horizonDistance: 90,
      cityHeight: 0.05,
      cityDensity: 32,
      surfaceRoughness: 0.32,
      fogDensity: 8e-3,
      sunVisible: 1,
      cloudTintR: 1,
      cloudTintG: 1,
      cloudTintB: 1,
      overlayType: 0,
      vegetationDensity: 0.7,
      foamAmount: 0.05,
      waterLevel: 0,
      groundLevel: 0
    },
    parkPlaza: {
      label: "Park plaza",
      sunIntensity: 1.1,
      rayleighStrength: 0.92,
      mieStrength: 0.9,
      turbidity: 1.8,
      hazeDensity: 0.016,
      cloudCoverage: 0.22,
      cloudScale: 0.055,
      cloudSpeed: 0.016,
      cloudHeight: 8.5,
      cloudThickness: 1,
      cloudEdge: 0.13,
      cloudDetail: 0.75,
      cloudShadowStrength: 0.55,
      horizonType: 3,
      surfaceType: 3,
      horizonDistance: 55,
      cityHeight: 0.05,
      cityDensity: 32,
      surfaceRoughness: 0.72,
      fogDensity: 0.01,
      sunVisible: 1,
      cloudTintR: 1,
      cloudTintG: 0.99,
      cloudTintB: 0.98,
      overlayType: 3,
      vegetationDensity: 0.8,
      foamAmount: 0.05,
      waterLevel: 0,
      groundLevel: 0
    }
  };
  var BackgroundManager = class {
    device;
    texture = null;
    sampler;
    mathPipeline = null;
    mathBindGroup = null;
    mathUniforms = null;
    unifiedPipeline = null;
    unifiedBindGroup = null;
    unifiedUniforms = null;
    brunetonPipeline = null;
    atmosphere = null;
    constructor(device2) {
      this.device = device2;
      this.sampler = device2.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        // Equirectangular wraps horizontally
        addressModeV: "clamp-to-edge"
      });
    }
    async getBackground(type, az, el, resolution = 1024, unifiedConfig) {
      const height = resolution / 2;
      if (!this.texture || this.texture.width !== resolution) {
        if (this.texture) this.texture.destroy();
        this.texture = this.device.createTexture({
          size: [resolution, height, 1],
          format: "rgba16float",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.mathPipeline = null;
        this.unifiedPipeline = null;
      }
      if (type === "math") {
        await this.renderMathSky(az, el, resolution, height);
      } else if (type === "unified") {
        await this.renderUnifiedSky(az, el, resolution, height, unifiedConfig);
      } else {
        await this.renderBrunetonSky(az, el, resolution, height);
      }
      return this.texture;
    }
    async renderMathSky(az, el, width, height) {
      if (!this.mathPipeline) {
        const response = await fetch("./core/math_sky_generator.wgsl");
        const shader = await response.text();
        const module = this.device.createShaderModule({ code: shader });
        this.mathPipeline = this.device.createComputePipeline({
          layout: "auto",
          compute: { module, entryPoint: "main" }
        });
        this.mathUniforms = this.device.createBuffer({
          size: 48,
          // 12 floats
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.mathBindGroup = this.device.createBindGroup({
          layout: this.mathPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.texture.createView() },
            { binding: 1, resource: { buffer: this.mathUniforms } }
          ]
        });
      }
      const data = new Float32Array([
        width,
        height,
        performance.now() / 1e3,
        0,
        az,
        el,
        0,
        8,
        3,
        0,
        0,
        0
      ]);
      this.device.queue.writeBuffer(this.mathUniforms, 0, data);
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.mathPipeline);
      pass.setBindGroup(0, this.mathBindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    async renderUnifiedSky(az, el, width, height, config2) {
      if (!this.unifiedPipeline) {
        const response = await fetch("./core/unified_sky_generator.wgsl");
        const shader = await response.text();
        const module = this.device.createShaderModule({ code: shader });
        this.unifiedPipeline = this.device.createComputePipeline({
          layout: "auto",
          compute: { module, entryPoint: "main" }
        });
        this.unifiedUniforms = this.device.createBuffer({
          size: 144,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.unifiedBindGroup = this.device.createBindGroup({
          layout: this.unifiedPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.texture.createView() },
            { binding: 1, resource: { buffer: this.unifiedUniforms } }
          ]
        });
      }
      const cfg = { ...UNIFIED_SKY_DEFAULTS, ...config2 };
      const sdx = Math.cos(el) * Math.sin(az);
      const sdy = Math.sin(el);
      const sdz = Math.cos(el) * Math.cos(az);
      const data = new Float32Array([
        width,
        height,
        performance.now() / 1e3,
        cfg.sunIntensity,
        sdx,
        sdy,
        sdz,
        cfg.rayleighStrength,
        cfg.mieStrength,
        cfg.turbidity,
        cfg.hazeDensity,
        cfg.cloudCoverage,
        cfg.cloudScale,
        cfg.cloudSpeed,
        cfg.cloudHeight,
        cfg.cloudThickness,
        cfg.cloudEdge,
        cfg.cloudDetail,
        cfg.cloudShadowStrength,
        cfg.horizonType,
        cfg.surfaceType,
        cfg.horizonDistance,
        cfg.cityHeight,
        cfg.cityDensity,
        cfg.surfaceRoughness,
        cfg.fogDensity,
        cfg.sunVisible,
        cfg.cloudTintR,
        cfg.cloudTintG,
        cfg.cloudTintB,
        cfg.overlayType,
        cfg.vegetationDensity,
        cfg.foamAmount,
        cfg.waterLevel,
        cfg.groundLevel,
        0
      ]);
      this.device.queue.writeBuffer(this.unifiedUniforms, 0, data);
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.unifiedPipeline);
      pass.setBindGroup(0, this.unifiedBindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    brunetonSkyPipeline = null;
    brunetonBindGroup = null;
    brunetonUniforms = null;
    lastBrunetonSun = [0, 0, 0];
    async renderBrunetonSky(az, el, width, height) {
      if (!this.atmosphere) {
        const response = await fetch("./v6/atmosphere_precompute.wgsl");
        const shader = await response.text();
        this.atmosphere = new AtmosphereGenerator(this.device, shader, {});
        this.atmosphere.generate();
      }
      const sdx = Math.cos(el) * Math.sin(az);
      const sdy = Math.sin(el);
      const sdz = Math.cos(el) * Math.cos(az);
      if (!this.brunetonSkyPipeline) {
        const response = await fetch("./core/bruneton_sky_generator.wgsl");
        const shader = await response.text();
        const module = this.device.createShaderModule({ code: shader });
        this.brunetonSkyPipeline = this.device.createComputePipeline({
          layout: "auto",
          compute: { module, entryPoint: "main" }
        });
        this.brunetonUniforms = this.device.createBuffer({
          size: 32,
          // 8 floats
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.brunetonBindGroup = this.device.createBindGroup({
          layout: this.brunetonSkyPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.texture.createView() },
            { binding: 1, resource: this.atmosphere.transmittanceTexture.createView() },
            { binding: 2, resource: this.atmosphere.scatteringTexture.createView() },
            { binding: 3, resource: this.atmosphere.singleMieTexture.createView() },
            { binding: 4, resource: { buffer: this.brunetonUniforms } },
            { binding: 5, resource: this.sampler }
          ]
        });
      }
      const data = new Float32Array([
        width,
        height,
        sdx,
        sdy,
        sdz,
        0,
        6360,
        6420,
        0.8,
        0
      ]);
      this.device.queue.writeBuffer(this.brunetonUniforms, 0, data);
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.brunetonSkyPipeline);
      pass.setBindGroup(0, this.brunetonBindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    getSampler() {
      return this.sampler;
    }
    destroy() {
      if (this.texture) this.texture.destroy();
      if (this.mathUniforms) this.mathUniforms.destroy();
      if (this.unifiedUniforms) this.unifiedUniforms.destroy();
      if (this.atmosphere) this.atmosphere.destroy();
    }
  };

  // background.ts
  var config = { ...UNIFIED_SKY_DEFAULTS, sunAzimuth: 0.14, sunElevation: 0.073 };
  var paused = false;
  var device;
  var bgManager;
  var displayPipeline;
  var displayBindGroup;
  var displaySampler;
  var canvas;
  var ctx;
  var presentFormat;
  var lastBgView = null;
  var BLIT_WGSL = (
    /* wgsl */
    `
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
`
  );
  var CONTROL_DEFS = [
    {
      key: "preset",
      label: "Preset",
      type: "select",
      group: "Scene",
      options: Object.entries(UNIFIED_SKY_PRESETS).map(([_k, v], i) => ({ value: i, label: v.label }))
    },
    { key: "sunAzimuth", label: "Sun azimuth", type: "range", min: -3.14, max: 3.14, step: 0.01, group: "Scene" },
    { key: "sunElevation", label: "Sun elevation", type: "range", min: -0.1, max: 0.8, step: 1e-3, group: "Scene" },
    { key: "sunIntensity", label: "Sun intensity", type: "range", min: 0.5, max: 2, step: 0.01, group: "Scene" },
    { key: "sunVisible", label: "Sun disk", type: "range", min: 0, max: 1, step: 1, group: "Scene" },
    {
      key: "horizonType",
      label: "Horizon",
      type: "select",
      group: "Scene",
      options: [{ value: 0, label: "None" }, { value: 1, label: "City skyline" }, { value: 2, label: "Low hills" }, { value: 3, label: "Tree line" }]
    },
    {
      key: "surfaceType",
      label: "Surface",
      type: "select",
      group: "Scene",
      options: [{ value: 0, label: "Sky only" }, { value: 1, label: "Water" }, { value: 2, label: "Grass" }, { value: 3, label: "Plaza / stone" }]
    },
    {
      key: "overlayType",
      label: "Overlay",
      type: "select",
      group: "Scene",
      options: [{ value: 0, label: "None" }, { value: 1, label: "Reeds" }, { value: 2, label: "Foreground grass" }, { value: 3, label: "Tree canopy" }]
    },
    { key: "cloudCoverage", label: "Cloud coverage", type: "range", min: 0, max: 1, step: 0.01, group: "Clouds" },
    { key: "cloudScale", label: "Cloud scale", type: "range", min: 0.01, max: 0.15, step: 1e-3, group: "Clouds" },
    { key: "cloudSpeed", label: "Cloud speed", type: "range", min: 0, max: 0.1, step: 1e-3, group: "Clouds" },
    { key: "cloudHeight", label: "Cloud height", type: "range", min: 4, max: 16, step: 0.1, group: "Clouds" },
    { key: "cloudThickness", label: "Thickness", type: "range", min: 0.1, max: 2, step: 0.01, group: "Clouds" },
    { key: "cloudEdge", label: "Edge softness", type: "range", min: 0.05, max: 0.3, step: 0.01, group: "Clouds" },
    { key: "cloudDetail", label: "Detail", type: "range", min: 0.3, max: 1.5, step: 0.01, group: "Clouds" },
    { key: "cloudShadowStrength", label: "Shadow strength", type: "range", min: 0, max: 1.5, step: 0.01, group: "Clouds" },
    { key: "cloudTintR", label: "Tint R", type: "range", min: 0.8, max: 1.2, step: 0.01, group: "Clouds" },
    { key: "cloudTintG", label: "Tint G", type: "range", min: 0.8, max: 1.2, step: 0.01, group: "Clouds" },
    { key: "cloudTintB", label: "Tint B", type: "range", min: 0.8, max: 1.2, step: 0.01, group: "Clouds" },
    { key: "rayleighStrength", label: "Rayleigh", type: "range", min: 0.2, max: 2, step: 0.01, group: "Atmosphere" },
    { key: "mieStrength", label: "Mie", type: "range", min: 0.2, max: 2, step: 0.01, group: "Atmosphere" },
    { key: "turbidity", label: "Turbidity", type: "range", min: 0.4, max: 5.5, step: 0.01, group: "Atmosphere" },
    { key: "hazeDensity", label: "Haze", type: "range", min: 0, max: 0.1, step: 1e-3, group: "Atmosphere" },
    { key: "fogDensity", label: "Fog density", type: "range", min: 0, max: 0.05, step: 1e-3, group: "Atmosphere" },
    { key: "horizonDistance", label: "Horizon dist", type: "range", min: 20, max: 160, step: 1, group: "Materials" },
    { key: "cityHeight", label: "City height", type: "range", min: 0.01, max: 0.16, step: 1e-3, group: "Materials" },
    { key: "cityDensity", label: "City density", type: "range", min: 8, max: 140, step: 1, group: "Materials" },
    { key: "surfaceRoughness", label: "Surface roughness", type: "range", min: 0.05, max: 1, step: 0.01, group: "Materials" },
    { key: "vegetationDensity", label: "Vegetation", type: "range", min: 0.1, max: 1.5, step: 0.01, group: "Materials" },
    { key: "foamAmount", label: "Water foam", type: "range", min: 0, max: 1.2, step: 0.01, group: "Materials" }
  ];
  var controlRefs = /* @__PURE__ */ new Map();
  function buildControls() {
    const form = document.getElementById("controls");
    const groups = /* @__PURE__ */ new Map();
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
      let input;
      if (def.type === "select") {
        input = document.createElement("select");
        input.style.flex = "1";
        input.style.maxWidth = "140px";
        for (const opt of def.options) {
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
      groups.get(def.group).appendChild(label);
      controlRefs.set(def.key, { input, valueEl: valueSpan, def });
      syncDisplay(def.key);
    }
  }
  function syncDisplay(key) {
    const ref = controlRefs.get(key);
    if (!ref) return;
    const val = key === "preset" ? ref.input.value : config[key];
    if (ref.def.type === "select") {
      const opt = ref.def.options?.find((o) => String(o.value) === String(val));
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
  function applyPreset(index) {
    const keys = Object.keys(UNIFIED_SKY_PRESETS);
    const key = keys[index];
    if (!key) return;
    const preset = UNIFIED_SKY_PRESETS[key];
    for (const [pk, pv] of Object.entries(preset)) {
      if (pk === "label") continue;
      config[pk] = pv;
    }
    syncAllControls();
  }
  async function initGPU() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    device = await adapter.requestDevice();
    canvas = document.getElementById("canvas");
    ctx = canvas.getContext("webgpu");
    presentFormat = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: presentFormat, alphaMode: "opaque" });
    bgManager = new BackgroundManager(device);
    displaySampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
    const module = device.createShaderModule({ code: BLIT_WGSL });
    displayPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: presentFormat }] },
      primitive: { topology: "triangle-list" }
    });
  }
  function rebuildBindGroup(bgTexView) {
    displayBindGroup = device.createBindGroup({
      layout: displayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: displaySampler },
        { binding: 1, resource: bgTexView }
      ]
    });
    lastBgView = bgTexView;
  }
  var frameCount = 0;
  var fpsAccum = 0;
  var fps = 0;
  var lastTime = 0;
  async function frame(now) {
    requestAnimationFrame(frame);
    if (paused) return;
    const dt = lastTime ? (now - lastTime) * 1e-3 : 0.016;
    lastTime = now;
    fpsAccum += dt;
    frameCount++;
    if (fpsAccum >= 0.5) {
      fps = frameCount / fpsAccum;
      fpsAccum = 0;
      frameCount = 0;
    }
    const sunDir = [config.sunAzimuth ?? 0.14, config.sunElevation ?? 0.073];
    const unifiedCfg = {};
    for (const key of Object.keys(UNIFIED_SKY_DEFAULTS)) {
      if (key in config) unifiedCfg[key] = config[key];
    }
    const bgTex = await bgManager.getBackground("unified", sunDir, 1024, unifiedCfg);
    const bgView = bgTex.createView();
    if (bgView !== lastBgView) {
      rebuildBindGroup(bgView);
    }
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    pass.setPipeline(displayPipeline);
    pass.setBindGroup(0, displayBindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const statsEl = document.getElementById("stats-panel");
    statsEl.innerHTML = `<div class="stat-card"><span class="stat-label">FPS</span><strong class="stat-value">${fps.toFixed(1)}</strong></div>`;
  }
  async function main() {
    buildControls();
    const pauseBtn = document.getElementById("pause-btn");
    pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.textContent = paused ? "Resume" : "Pause";
    });
    try {
      await initGPU();
    } catch (e) {
      const err = document.getElementById("error");
      err.textContent = e?.message ?? String(e);
      return;
    }
    requestAnimationFrame(frame);
  }
  main().catch(console.error);
})();
//# sourceMappingURL=background.bundle.js.map
