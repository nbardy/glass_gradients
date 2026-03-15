import { AtmosphereGenerator } from "./atmosphere_generator";

/** Default values for unified sky parameters, matching the citySunset preset. */
export const UNIFIED_SKY_DEFAULTS = {
  sunIntensity: 1.45,
  rayleighStrength: 0.82,
  mieStrength: 1.15,
  turbidity: 3.40,
  hazeDensity: 0.060,
  cloudCoverage: 0.14,
  cloudScale: 0.050,
  cloudSpeed: 0.020,
  cloudHeight: 10.0,
  cloudThickness: 1.0,
  cloudEdge: 0.12,
  cloudDetail: 0.75,
  cloudShadowStrength: 0.80,
  horizonType: 1,    // 0=none, 1=city, 2=hills, 3=treeline
  surfaceType: 0,    // 0=sky-only, 1=water, 2=grass, 3=plaza
  horizonDistance: 125.0,
  cityHeight: 0.095,
  cityDensity: 96.0,
  surfaceRoughness: 0.35,
  fogDensity: 0.018,
  sunVisible: 1.0,
  cloudTintR: 1.04,
  cloudTintG: 0.96,
  cloudTintB: 0.92,
  overlayType: 0,    // 0=none, 1=reeds, 2=foreground grass, 3=tree canopy
  vegetationDensity: 0.45,
  foamAmount: 0.15,
  waterLevel: 0.0,
  groundLevel: 0.0,
} as const;

/** Named presets ported from webgpu-unified-sun. */
export const UNIFIED_SKY_PRESETS: Record<string, { label: string } & Partial<Record<keyof typeof UNIFIED_SKY_DEFAULTS, number>>> = {
  citySunset: {
    label: "City sunset",
    sunIntensity: 1.45, rayleighStrength: 0.82, mieStrength: 1.15, turbidity: 3.40,
    hazeDensity: 0.060, cloudCoverage: 0.14, cloudScale: 0.050, cloudSpeed: 0.020,
    cloudHeight: 10.0, cloudThickness: 1.0, cloudEdge: 0.12, cloudDetail: 0.75,
    cloudShadowStrength: 0.80, horizonType: 1, surfaceType: 0, horizonDistance: 125.0,
    cityHeight: 0.095, cityDensity: 96.0, surfaceRoughness: 0.35, fogDensity: 0.018,
    sunVisible: 1.0, cloudTintR: 1.04, cloudTintG: 0.96, cloudTintB: 0.92,
    overlayType: 0, vegetationDensity: 0.45, foamAmount: 0.15, waterLevel: 0.0, groundLevel: 0.0,
  },
  reedsLake: {
    label: "Reeds / lake sunset",
    sunIntensity: 1.20, rayleighStrength: 0.75, mieStrength: 1.05, turbidity: 3.20,
    hazeDensity: 0.055, cloudCoverage: 0.08, cloudScale: 0.055, cloudSpeed: 0.018,
    cloudHeight: 8.0, cloudThickness: 1.0, cloudEdge: 0.14, cloudDetail: 0.75,
    cloudShadowStrength: 0.65, horizonType: 0, surfaceType: 1, horizonDistance: 82.0,
    cityHeight: 0.06, cityDensity: 32.0, surfaceRoughness: 0.22, fogDensity: 0.028,
    sunVisible: 1.0, cloudTintR: 1.02, cloudTintG: 0.96, cloudTintB: 0.93,
    overlayType: 1, vegetationDensity: 1.0, foamAmount: 0.10, waterLevel: 0.0, groundLevel: 0.0,
  },
  grassyField: {
    label: "Low grass horizon",
    sunIntensity: 1.10, rayleighStrength: 0.90, mieStrength: 0.95, turbidity: 2.10,
    hazeDensity: 0.022, cloudCoverage: 0.34, cloudScale: 0.060, cloudSpeed: 0.020,
    cloudHeight: 9.0, cloudThickness: 1.0, cloudEdge: 0.14, cloudDetail: 0.85,
    cloudShadowStrength: 0.70, horizonType: 2, surfaceType: 2, horizonDistance: 70.0,
    cityHeight: 0.06, cityDensity: 36.0, surfaceRoughness: 0.35, fogDensity: 0.012,
    sunVisible: 1.0, cloudTintR: 1.00, cloudTintG: 0.98, cloudTintB: 0.97,
    overlayType: 2, vegetationDensity: 0.85, foamAmount: 0.10, waterLevel: 0.0, groundLevel: 0.0,
  },
  oceanDrama: {
    label: "Dramatic ocean",
    sunIntensity: 1.50, rayleighStrength: 0.80, mieStrength: 1.18, turbidity: 4.10,
    hazeDensity: 0.048, cloudCoverage: 0.76, cloudScale: 0.050, cloudSpeed: 0.016,
    cloudHeight: 10.0, cloudThickness: 1.0, cloudEdge: 0.18, cloudDetail: 1.00,
    cloudShadowStrength: 1.0, horizonType: 0, surfaceType: 1, horizonDistance: 110.0,
    cityHeight: 0.06, cityDensity: 32.0, surfaceRoughness: 0.18, fogDensity: 0.020,
    sunVisible: 1.0, cloudTintR: 1.08, cloudTintG: 0.92, cloudTintB: 0.88,
    overlayType: 0, vegetationDensity: 0.4, foamAmount: 0.65, waterLevel: 0.0, groundLevel: 0.0,
  },
  blueMeadow: {
    label: "Blue-sky meadow",
    sunIntensity: 1.0, rayleighStrength: 1.10, mieStrength: 0.70, turbidity: 0.90,
    hazeDensity: 0.010, cloudCoverage: 0.40, cloudScale: 0.050, cloudSpeed: 0.015,
    cloudHeight: 9.0, cloudThickness: 1.0, cloudEdge: 0.15, cloudDetail: 0.85,
    cloudShadowStrength: 0.55, horizonType: 0, surfaceType: 2, horizonDistance: 90.0,
    cityHeight: 0.05, cityDensity: 32.0, surfaceRoughness: 0.32, fogDensity: 0.008,
    sunVisible: 1.0, cloudTintR: 1.00, cloudTintG: 1.00, cloudTintB: 1.00,
    overlayType: 0, vegetationDensity: 0.70, foamAmount: 0.05, waterLevel: 0.0, groundLevel: 0.0,
  },
  parkPlaza: {
    label: "Park plaza",
    sunIntensity: 1.10, rayleighStrength: 0.92, mieStrength: 0.90, turbidity: 1.80,
    hazeDensity: 0.016, cloudCoverage: 0.22, cloudScale: 0.055, cloudSpeed: 0.016,
    cloudHeight: 8.5, cloudThickness: 1.0, cloudEdge: 0.13, cloudDetail: 0.75,
    cloudShadowStrength: 0.55, horizonType: 3, surfaceType: 3, horizonDistance: 55.0,
    cityHeight: 0.05, cityDensity: 32.0, surfaceRoughness: 0.72, fogDensity: 0.010,
    sunVisible: 1.0, cloudTintR: 1.00, cloudTintG: 0.99, cloudTintB: 0.98,
    overlayType: 3, vegetationDensity: 0.8, foamAmount: 0.05, waterLevel: 0.0, groundLevel: 0.0,
  },
};

export type UnifiedSkyConfig = Record<keyof typeof UNIFIED_SKY_DEFAULTS, number>;

export type BackgroundType = "math" | "bruneton" | "unified";

/** Normalize bgType from numeric (UI select) or string (HTML picker) to a BackgroundType. */
export function resolveBackgroundType(bgType: string | number): BackgroundType {
  if (typeof bgType === "string") {
    if (bgType === "math" || bgType === "bruneton" || bgType === "unified") return bgType;
  }
  const n = Number(bgType);
  if (n === 1) return "math";       // Beach Sunset → still math generator
  if (n === 2) return "bruneton";
  if (n === 3) return "unified";
  return "math";                     // 0 (City Skyline) and fallback
}

export class BackgroundManager {
  private device: GPUDevice;
  private texture: GPUTexture | null = null;
  private sampler: GPUSampler;

  private mathPipeline: GPUComputePipeline | null = null;
  private mathBindGroup: GPUBindGroup | null = null;
  private mathUniforms: GPUBuffer | null = null;

  private unifiedPipeline: GPUComputePipeline | null = null;
  private unifiedBindGroup: GPUBindGroup | null = null;
  private unifiedUniforms: GPUBuffer | null = null;

  private brunetonPipeline: GPUComputePipeline | null = null;
  private atmosphere: AtmosphereGenerator | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat', // Equirectangular wraps horizontally
      addressModeV: 'clamp-to-edge'
    });
  }

  public async getBackground(
    type: "math" | "bruneton" | "unified",
    az: number,
    el: number,
    resolution: number = 1024,
    unifiedConfig?: Partial<UnifiedSkyConfig>,
  ): Promise<GPUTexture> {
    const height = resolution / 2;
    if (!this.texture || this.texture.width !== resolution) {
      if (this.texture) this.texture.destroy();
      this.texture = this.device.createTexture({
        size: [resolution, height, 1],
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      // Force pipeline rebuild on resize
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

  private async renderMathSky(az: number, el: number, width: number, height: number) {
    if (!this.mathPipeline) {
      const response = await fetch("./core/math_sky_generator.wgsl");
      const shader = await response.text();
      const module = this.device.createShaderModule({ code: shader });
      this.mathPipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" }
      });

      this.mathUniforms = this.device.createBuffer({
        size: 48, // 12 floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      this.mathBindGroup = this.device.createBindGroup({
        layout: this.mathPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.texture!.createView() },
          { binding: 1, resource: { buffer: this.mathUniforms! } }
        ]
      });
    }

    // Update uniforms
    // resolution(2), time(1), sunAzimuth(1), sunElevation(1), sceneType(1), cloudSteps(1), sunShadowSteps(1)
    const data = new Float32Array([
      width, height, performance.now() / 1000.0, 0.0,
      az, el, 0.0 /* city scene */, 8.0,
      3.0, 0.0, 0.0, 0.0
    ]);
    this.device.queue.writeBuffer(this.mathUniforms!, 0, data);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.mathPipeline);
    pass.setBindGroup(0, this.mathBindGroup!);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private async renderUnifiedSky(
    az: number, el: number, width: number, height: number,
    config?: Partial<UnifiedSkyConfig>,
  ) {
    if (!this.unifiedPipeline) {
      const response = await fetch("./core/unified_sky_generator.wgsl");
      const shader = await response.text();
      const module = this.device.createShaderModule({ code: shader });
      this.unifiedPipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" },
      });

      // 36 floats = 144 bytes (matches UnifiedSkyParams struct)
      this.unifiedUniforms = this.device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.unifiedBindGroup = this.device.createBindGroup({
        layout: this.unifiedPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.texture!.createView() },
          { binding: 1, resource: { buffer: this.unifiedUniforms } },
        ],
      });
    }

    const cfg = { ...UNIFIED_SKY_DEFAULTS, ...config };

    // Compute sun direction from azimuth/elevation passed in sunDir[0], sunDir[1]
    
    const sdx = Math.cos(el) * Math.sin(az);
    const sdy = Math.sin(el);
    const sdz = Math.cos(el) * Math.cos(az);

    const data = new Float32Array([
      width, height, performance.now() / 1000.0, cfg.sunIntensity,
      sdx, sdy, sdz, cfg.rayleighStrength,
      cfg.mieStrength, cfg.turbidity, cfg.hazeDensity, cfg.cloudCoverage,
      cfg.cloudScale, cfg.cloudSpeed, cfg.cloudHeight, cfg.cloudThickness,
      cfg.cloudEdge, cfg.cloudDetail, cfg.cloudShadowStrength, cfg.horizonType,
      cfg.surfaceType, cfg.horizonDistance, cfg.cityHeight, cfg.cityDensity,
      cfg.surfaceRoughness, cfg.fogDensity, cfg.sunVisible, cfg.cloudTintR,
      cfg.cloudTintG, cfg.cloudTintB, cfg.overlayType, cfg.vegetationDensity,
      cfg.foamAmount, cfg.waterLevel, cfg.groundLevel, 0.0,
    ]);
    this.device.queue.writeBuffer(this.unifiedUniforms!, 0, data);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.unifiedPipeline);
    pass.setBindGroup(0, this.unifiedBindGroup!);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private brunetonSkyPipeline: GPUComputePipeline | null = null;
  private brunetonBindGroup: GPUBindGroup | null = null;
  private brunetonUniforms: GPUBuffer | null = null;
  private lastBrunetonSun: number[] = [0, 0, 0];

  private async renderBrunetonSky(az: number, el: number, width: number, height: number) {
    if (!this.atmosphere) {
      const response = await fetch("./v6/atmosphere_precompute.wgsl");
      const shader = await response.text();
      this.atmosphere = new AtmosphereGenerator(this.device, shader, {});
      this.atmosphere.generate(); // Generate the LUTs once
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
        compute: { module, entryPoint: "main" },
      });

      this.brunetonUniforms = this.device.createBuffer({
        size: 32, // 8 floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.brunetonBindGroup = this.device.createBindGroup({
        layout: this.brunetonSkyPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.texture!.createView() },
          { binding: 1, resource: this.atmosphere.transmittanceTexture.createView() },
          { binding: 2, resource: this.atmosphere.scatteringTexture.createView() },
          { binding: 3, resource: this.atmosphere.singleMieTexture.createView() },
          { binding: 4, resource: { buffer: this.brunetonUniforms } },
          { binding: 5, resource: this.sampler },
        ],
      });
    }

    const data = new Float32Array([
      width, height, 
      sdx, sdy, sdz, 0.0,
      6360.0, 6420.0, 0.8, 0.0
    ]);
    this.device.queue.writeBuffer(this.brunetonUniforms!, 0, data);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.brunetonSkyPipeline);
    pass.setBindGroup(0, this.brunetonBindGroup!);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  public getSampler(): GPUSampler {
    return this.sampler;
  }

  public destroy() {
    if (this.texture) this.texture.destroy();
    if (this.mathUniforms) this.mathUniforms.destroy();
    if (this.unifiedUniforms) this.unifiedUniforms.destroy();
    if (this.atmosphere) this.atmosphere.destroy();
  }
}
