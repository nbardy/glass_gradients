import { AlgoRenderer } from "../../core/renderer";
import { AtmosphereGenerator } from "../../core/atmosphere_generator";

const RENDER_SIZE = 512;
const SKY_SIZE = 512;

export async function v6CompositePipeline(
  device: any, // GPUDevice
  canvas: HTMLCanvasElement,
  compositeShaderSource: string, // composite.wgsl
  config: Record<string, any>
): Promise<AlgoRenderer> {
  const context = canvas.getContext("webgpu") as any;
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  // Fetch remaining shaders
  const skyviewSource = await fetch("./v6/skyview.wgsl").then(r => r.text());
  const glassPrecomputeSource = await fetch("./v6/glass-precompute.wgsl").then(r => r.text());
  const presentSource = await fetch("./v6/present.wgsl").then(r => r.text());
  const atmoPrecomputeSource = await fetch("./v6/atmosphere_precompute.wgsl").then(r => r.text());

  // Compile modules
  const skyviewModule = device.createShaderModule({ code: skyviewSource });
  const glassPrecomputeModule = device.createShaderModule({ code: glassPrecomputeSource });
  const compositeModule = device.createShaderModule({ code: compositeShaderSource });
  const presentModule = device.createShaderModule({ code: presentSource });

  // Create Atmosphere Generator
  const atmosphereGenerator = new AtmosphereGenerator(device, atmoPrecomputeSource, {
    bottomRadius: 6360.0,
    topRadius: 6420.0,
  });
  atmosphereGenerator.generate();

  // Create pipelines
  const skyviewPipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: skyviewModule, entryPoint: "main" },
  });

  const glassPrecomputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: glassPrecomputeModule, entryPoint: "main" },
  });

  const compositePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: compositeModule, entryPoint: "main" },
  });

  const presentPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: presentModule, entryPoint: "vsMain" },
    fragment: { module: presentModule, entryPoint: "fsMain", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" },
  });

  // Textures
  const skyTex = device.createTexture({
    size: [SKY_SIZE, SKY_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  const transport0 = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const transport1 = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const transport2 = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  const hdrTex = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  const linearSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // Uniform Buffers
  const skyParamsBuffer = device.createBuffer({
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  
  const glassParamsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const frameParamsBuffer = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Bind Groups
  const skyviewBG = device.createBindGroup({
    layout: skyviewPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: atmosphereGenerator.transmittanceTexture.createView() },
      { binding: 2, resource: atmosphereGenerator.scatteringTexture.createView() },
      { binding: 3, resource: atmosphereGenerator.singleMieTexture.createView() },
      { binding: 4, resource: skyTex.createView() },
      { binding: 5, resource: { buffer: skyParamsBuffer } },
    ],
  });

  const glassPrecomputeBG = device.createBindGroup({
    layout: glassPrecomputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: transport0.createView() },
      { binding: 1, resource: transport1.createView() },
      { binding: 2, resource: transport2.createView() },
      { binding: 3, resource: { buffer: glassParamsBuffer } },
    ],
  });

  const compositeBG = device.createBindGroup({
    layout: compositePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: skyTex.createView() },
      { binding: 2, resource: transport0.createView() },
      { binding: 3, resource: transport1.createView() },
      { binding: 4, resource: transport2.createView() },
      { binding: 5, resource: hdrTex.createView() },
      { binding: 6, resource: { buffer: frameParamsBuffer } },
    ],
  });

  const presentBG = device.createBindGroup({
    layout: presentPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: hdrTex.createView() },
    ],
  });

  let frameCount = 0;
  let lastTime = performance.now();
  const startTime = performance.now();
  const stats = { fps: 0, frameMs: 0, status: "V6 Running" };

  return {
    name: "v6_webgpu",
    async render(timestamp: number) {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      stats.frameMs = delta;
      stats.fps = delta > 0 ? 1000 / delta : 0;
      frameCount++;

      const time = (now - startTime) / 1000.0;

      // Update uniforms
      const skyParams = new ArrayBuffer(96);
      const skyF32 = new Float32Array(skyParams);
      const skyU32 = new Uint32Array(skyParams);
      skyF32[0] = 6360.0;
      skyF32[1] = 6420.0;
      skyF32[2] = -0.2;
      skyF32[3] = 0.004675;
      skyF32[4] = 0.8;
      skyF32[5] = 0.1;
      skyF32[6] = time;
      skyF32[7] = 0;
      skyF32[8] = 0.4; skyF32[9] = 0.08; skyF32[10] = 1.0; // sunDir
      skyU32[12] = 256; skyU32[13] = 64; // transmittanceSize
      skyU32[16] = 8; skyU32[17] = 128; skyU32[18] = 32; skyU32[19] = 32; // scatteringSize
      skyU32[20] = SKY_SIZE; skyU32[21] = SKY_SIZE; // skySize
      device.queue.writeBuffer(skyParamsBuffer, 0, skyParams);

      const glassParams = new Float32Array(16);
      const glassU32 = new Uint32Array(glassParams.buffer);
      glassU32[0] = RENDER_SIZE;
      glassU32[1] = RENDER_SIZE;
      glassParams[2] = 1.0 / RENDER_SIZE;
      glassParams[3] = 1.0 / RENDER_SIZE;
      glassParams[4] = 1.0; // aspect
      glassParams[5] = 1.65; // cameraDist
      glassParams[6] = config.thickness ?? 0.06;
      glassParams[7] = 0.1; // frontLfAmp
      glassParams[8] = 0.05; // frontHfAmp
      glassParams[9] = 0.1; // backLfAmp
      glassParams[10] = 0.05; // backHfAmp
      glassParams[11] = config.etaGlass ?? 1.52;
      device.queue.writeBuffer(glassParamsBuffer, 0, glassParams);

      const frameParams = new Float32Array(20);
      const frameU32 = new Uint32Array(frameParams.buffer);
      frameU32[0] = RENDER_SIZE;
      frameU32[1] = RENDER_SIZE;
      frameParams[2] = 1.0 / RENDER_SIZE;
      frameParams[3] = 1.0 / RENDER_SIZE;
      frameU32[4] = SKY_SIZE;
      frameU32[5] = SKY_SIZE;
      frameU32[6] = frameCount;
      frameParams[7] = 1.0; // dispersionScale
      frameParams[8] = 1.0; // sigmaToLod
      frameParams[9] = 5.0; // maxLod
      frameParams[10] = 0.0; // absorptionR
      frameParams[11] = 0.0; // absorptionG
      frameParams[12] = 0.0; // absorptionB
      frameParams[13] = 0; // padding
      frameParams[14] = 0; // sunHint.x
      frameParams[15] = 0; // sunHint.y
      device.queue.writeBuffer(frameParamsBuffer, 0, frameParams);

      const encoder = device.createCommandEncoder();
      
      const pass1 = encoder.beginComputePass();
      pass1.setPipeline(skyviewPipeline);
      pass1.setBindGroup(0, skyviewBG);
      pass1.dispatchWorkgroups(Math.ceil(SKY_SIZE / 8), Math.ceil(SKY_SIZE / 8));
      pass1.end();

      const pass2 = encoder.beginComputePass();
      pass2.setPipeline(glassPrecomputePipeline);
      pass2.setBindGroup(0, glassPrecomputeBG);
      pass2.dispatchWorkgroups(Math.ceil(RENDER_SIZE / 8), Math.ceil(RENDER_SIZE / 8));
      pass2.end();

      const pass3 = encoder.beginComputePass();
      pass3.setPipeline(compositePipeline);
      pass3.setBindGroup(0, compositeBG);
      pass3.dispatchWorkgroups(Math.ceil(RENDER_SIZE / 8), Math.ceil(RENDER_SIZE / 8));
      pass3.end();

      const pass4 = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store"
        }]
      });
      pass4.setPipeline(presentPipeline);
      pass4.setBindGroup(0, presentBG);
      pass4.draw(3);
      pass4.end();

      device.queue.submit([encoder.finish()]);
    },
    getStats() { return { ...stats }; },
    dispose() {
      skyTex.destroy();
      transport0.destroy();
      transport1.destroy();
      transport2.destroy();
      hdrTex.destroy();
      atmosphereGenerator.destroy();
      skyParamsBuffer.destroy();
      glassParamsBuffer.destroy();
      frameParamsBuffer.destroy();
    }
  };
}
