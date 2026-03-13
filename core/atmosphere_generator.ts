export interface AtmosphereConfig {
  bottomRadius?: number;
  topRadius?: number;
  rayleighDensityH?: number;
  mieDensityH?: number;
  rayleighScattering?: [number, number, number];
  mieScattering?: [number, number, number];
  mieExtinction?: [number, number, number];
  ozoneAbsorption?: [number, number, number];
  ozoneCenterH?: number;
  ozoneWidth?: number;
  transmittanceSize?: [number, number];
  scatteringSize?: [number, number, number, number];
}

export class AtmosphereGenerator {
  private device: GPUDevice;
  private transmittancePipeline: GPUComputePipeline;
  private scatteringPipeline: GPUComputePipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;

  public transmittanceTexture: GPUTexture;
  public scatteringTexture: GPUTexture;
  public singleMieTexture: GPUTexture;

  private tSize: [number, number];
  private sSize: [number, number, number, number];

  constructor(device: GPUDevice, shaderCode: string, config: AtmosphereConfig) {
    this.device = device;
    const module = device.createShaderModule({ code: shaderCode });

    this.transmittancePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "compute_transmittance" },
    });

    this.scatteringPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "compute_single_scattering" },
    });

    this.tSize = config.transmittanceSize ?? [256, 64];
    this.sSize = config.scatteringSize ?? [8, 128, 32, 32]; // nu, mu_s, mu, r

    this.transmittanceTexture = device.createTexture({
      size: [this.tSize[0], this.tSize[1], 1],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.scatteringTexture = device.createTexture({
      size: [this.sSize[0] * this.sSize[1], this.sSize[2], this.sSize[3]],
      dimension: "3d",
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.singleMieTexture = device.createTexture({
      size: [this.sSize[0] * this.sSize[1], this.sSize[2], this.sSize[3]],
      dimension: "3d",
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.uniformBuffer = device.createBuffer({
      size: 144, // 36 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Since layout is auto, we must use the layout from the pipeline that uses all bindings.
    // compute_single_scattering uses binding 0, 2, 3 but transmittance uses 0, 1.
    // Wait, auto layout is dangerous with multiple entry points in one shader file!
    // The WebGPU spec says auto layout includes all bindings in the entry point.
    // Let's create an explicit bind group layout.
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
      ],
    });

    // Recreate pipelines with explicit layout
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    this.transmittancePipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: "compute_transmittance" },
    });
    this.scatteringPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: "compute_single_scattering" },
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.transmittanceTexture.createView() },
        { binding: 2, resource: this.scatteringTexture.createView() },
        { binding: 3, resource: this.singleMieTexture.createView() },
      ],
    });

    this.updateConfig(config);
  }

  public updateConfig(config: AtmosphereConfig) {
    const data = new Float32Array(36); // 144 bytes
    const u32Data = new Uint32Array(data.buffer);

    data[0] = config.bottomRadius ?? 6360.0;
    data[1] = config.topRadius ?? 6420.0;
    data[2] = config.rayleighDensityH ?? 8.0;
    data[3] = config.mieDensityH ?? 1.2;

    const rScat = config.rayleighScattering ?? [0.0058, 0.0135, 0.0331];
    data[4] = rScat[0]; data[5] = rScat[1]; data[6] = rScat[2];
    
    const mScat = config.mieScattering ?? [0.0039, 0.0039, 0.0039];
    data[8] = mScat[0]; data[9] = mScat[1]; data[10] = mScat[2];

    const mExt = config.mieExtinction ?? [0.0044, 0.0044, 0.0044];
    data[12] = mExt[0]; data[13] = mExt[1]; data[14] = mExt[2];

    const oAbs = config.ozoneAbsorption ?? [0.00065, 0.00188, 0.000085];
    data[16] = oAbs[0]; data[17] = oAbs[1]; data[18] = oAbs[2];
    data[19] = config.ozoneCenterH ?? 25.0;
    
    data[20] = config.ozoneWidth ?? 15.0;
    // _pad4 (vec3f) is at offset 96 (index 24)
    u32Data[28] = this.tSize[0];
    u32Data[29] = this.tSize[1];
    u32Data[32] = this.sSize[0];
    u32Data[33] = this.sSize[1];
    u32Data[34] = this.sSize[2];
    u32Data[35] = this.sSize[3];

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  public generate(commandEncoder?: GPUCommandEncoder) {
    const isInternalEncoder = !commandEncoder;
    const encoder = commandEncoder || this.device.createCommandEncoder();

    // 1. Transmittance
    const tPass = encoder.beginComputePass();
    tPass.setPipeline(this.transmittancePipeline);
    tPass.setBindGroup(0, this.bindGroup);
    tPass.dispatchWorkgroups(
      Math.ceil(this.tSize[0] / 8),
      Math.ceil(this.tSize[1] / 8)
    );
    tPass.end();

    // 2. Single Scattering
    const sPass = encoder.beginComputePass();
    sPass.setPipeline(this.scatteringPipeline);
    sPass.setBindGroup(0, this.bindGroup);
    sPass.dispatchWorkgroups(
      Math.ceil((this.sSize[0] * this.sSize[1]) / 8),
      Math.ceil(this.sSize[2] / 8),
      Math.ceil(this.sSize[3] / 8)
    );
    sPass.end();

    if (isInternalEncoder) {
      this.device.queue.submit([encoder.finish()]);
    }
  }

  public destroy() {
    this.transmittanceTexture.destroy();
    this.scatteringTexture.destroy();
    this.singleMieTexture.destroy();
    this.uniformBuffer.destroy();
  }
}
