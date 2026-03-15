export interface GlassGeneratorConfig {
  width: number;
  height: number;
  scale?: number;
  pattern_type?: number;
  frontOffset?: [number, number];
  backOffset?: [number, number];
  distortion?: number;
  roughness?: number;
  dropletProfile?: number;
}

export class GlassGenerator {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private physicsPipeline: GPUComputePipeline;
  private uniformBuffer: GPUBuffer;
  private dropletBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private physicsBindGroup: GPUBindGroup;
  public texture: GPUTexture;
  private numDroplets = 150;
  private isDynamic = false;

  constructor(device: GPUDevice, shaderCode: string, config: GlassGeneratorConfig) {
    this.device = device;
    const module = device.createShaderModule({ code: shaderCode });

    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });

    this.physicsPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'simulate_physics' },
    });

    this.texture = device.createTexture({
      size: [config.width, config.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.uniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.dropletBuffer = device.createBuffer({
      size: this.numDroplets * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const dropletsData = new Float32Array(this.numDroplets * 4);
    for (let i = 0; i < this.numDroplets; i++) {
        dropletsData[i * 4 + 0] = Math.random(); // pos.x
        dropletsData[i * 4 + 1] = Math.random(); // pos.y
        dropletsData[i * 4 + 2] = 0.001; // radius
        dropletsData[i * 4 + 3] = 0.02 + Math.random() * 0.05; // target_radius
    }
    this.device.queue.writeBuffer(this.dropletBuffer, 0, dropletsData);

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
        { binding: 2, resource: { buffer: this.dropletBuffer } },
      ],
    });

    this.physicsBindGroup = device.createBindGroup({
      layout: this.physicsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 2, resource: { buffer: this.dropletBuffer } },
      ],
    });

    this.updateConfig(config);
  }

  public updateConfig(config: GlassGeneratorConfig) {
    this.isDynamic = config.pattern_type === 7;
    const data = new Float32Array(12); // 48 bytes
    data[0] = config.scale ?? 1.0;
    data[1] = config.pattern_type ?? 0.0;
    data[2] = config.frontOffset?.[0] ?? 0.10;
    data[3] = config.frontOffset?.[1] ?? -0.07;
    data[4] = config.backOffset?.[0] ?? -0.11;
    data[5] = config.backOffset?.[1] ?? 0.06;
    data[6] = config.distortion ?? 1.0;
    data[7] = config.roughness ?? 0.0;
    data[8] = config.dropletProfile ?? 2.5;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  public generate(commandEncoder?: GPUCommandEncoder) {
    const isInternalEncoder = !commandEncoder;
    const encoder = commandEncoder || this.device.createCommandEncoder();

    if (this.isDynamic) {
        const physPass = encoder.beginComputePass();
        physPass.setPipeline(this.physicsPipeline);
        physPass.setBindGroup(0, this.physicsBindGroup);
        physPass.dispatchWorkgroups(Math.ceil(this.numDroplets / 64));
        physPass.end();
    }

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.texture.width / 16),
      Math.ceil(this.texture.height / 16)
    );
    pass.end();

    if (isInternalEncoder) {
      this.device.queue.submit([encoder.finish()]);
    }
  }

  public destroy() {
    this.texture.destroy();
    this.uniformBuffer.destroy();
    this.dropletBuffer.destroy();
  }
}
