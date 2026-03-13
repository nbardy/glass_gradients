import { AtmosphereGenerator } from "./atmosphere_generator";

export class BackgroundManager {
  private device: GPUDevice;
  private texture: GPUTexture | null = null;
  private sampler: GPUSampler;

  private mathPipeline: GPUComputePipeline | null = null;
  private mathBindGroup: GPUBindGroup | null = null;
  private mathUniforms: GPUBuffer | null = null;

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

  public async getBackground(type: "math" | "bruneton", sunDir: number[], resolution: number = 1024): Promise<GPUTexture> {
    const height = resolution / 2;
    if (!this.texture || this.texture.width !== resolution) {
      if (this.texture) this.texture.destroy();
      this.texture = this.device.createTexture({
        size: [resolution, height, 1],
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      // Force pipeline rebuild on resize
      this.mathPipeline = null;
    }

    if (type === "math") {
      await this.renderMathSky(sunDir, resolution, height);
    } else {
      await this.renderBrunetonSky(sunDir, resolution, height);
    }

    return this.texture;
  }

  private async renderMathSky(sunDir: number[], width: number, height: number) {
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
      sunDir[0] /* azimuth */, sunDir[1] /* elevation */, 0.0 /* city scene */, 8.0,
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

  private async renderBrunetonSky(sunDir: number[], width: number, height: number) {
    // Stub for now: Will wire up the AtmosphereGenerator here
    // For now, clear to blue to distinguish it
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: this.texture!.createView(),
            clearValue: { r: 0.1, g: 0.2, b: 0.8, a: 1.0 },
            loadOp: "clear",
            storeOp: "store"
        }]
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  public getSampler(): GPUSampler {
    return this.sampler;
  }

  public destroy() {
    if (this.texture) this.texture.destroy();
    if (this.mathUniforms) this.mathUniforms.destroy();
    if (this.atmosphere) this.atmosphere.destroy();
  }
}
