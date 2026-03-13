import { AlgoRenderer } from "../../core/renderer";
import { GlassGenerator } from "../../core/glass_generator";

declare const GPUBufferUsage: any;
declare const GPUMapMode: any;
declare const GPUTextureUsage: any;

const RENDER_SIZE = 512;
const WORKGROUP_SIZE = 16;

export async function v7GlassPipeline(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;

  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  // Load glass generator shader
  const glassGenResponse = await fetch("./core/glass_generator.wgsl");
  const glassGenSource = await glassGenResponse.text();

  // Initialize glass generator (precompute glass texture)
  const glassGenerator = new GlassGenerator(device, glassGenSource, {
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    scale: config.glassScale ?? 1.0,
    frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
    backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
    distortion: config.glassDistortion ?? 1.0,
    pattern_type: config.glassPatternType ?? 0.0,
    roughness: config.glassRoughness ?? 0.0,
  });

  // Generate initial glass texture
  glassGenerator.generate();

  // Load V7 shader
  const shaderResponse = await fetch("./algorithms/v7/renderer.wgsl");
  const shaderSource = await shaderResponse.text();

  // Compile shader module
  const shaderModule = device.createShaderModule({ code: shaderSource });

  // Create pipelines (glass compute, render)
  const glassComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_compute" },
  });

  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_fullscreen",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_display",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  // Create GPU buffers and textures
  const paramsBuffer = device.createBuffer({
    size: 128, // 8 * 4 * 4 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const displayTexture = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  
  // Dummy background cache to satisfy binding layout if we want to add it later
  const dummyBackground = device.createTexture({
    size: [1, 1],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Create bind groups
  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const glassComputeBindGroup = device.createBindGroup({
    layout: glassComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: displayTexture.createView() },
      { binding: 2, resource: glassGenerator.texture.createView() },
      { binding: 3, resource: linearSampler },
    ],
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: displayTexture.createView() },
    ],
  });

  const renderParamsBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 2, resource: glassGenerator.texture.createView() },
      { binding: 3, resource: linearSampler },
    ],
  });

  // --- Debug Canvases Setup ---
  const debugIds = ["debug-r", "debug-g", "debug-b", "debug-bg"];
  const debugContexts: GPUCanvasContext[] = [];
  let debugPipeline: GPURenderPipeline | null = null;
  let debugBindGroupGbuffer: GPUBindGroup | null = null;
  let debugBindGroupBg: GPUBindGroup | null = null;
  const debugUniforms = device.createBuffer({
    size: 32, // Safe uniform buffer size
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  for (const id of debugIds) {
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (el) {
      const ctx = el.getContext("webgpu") as GPUCanvasContext;
      ctx.configure({ device, format: canvasFormat });
      debugContexts.push(ctx);
    }
  }

  if (debugContexts.length === 4) {
    const debugShader = `
      @vertex fn vs(@builtin(vertex_index) v_idx: u32) -> @builtin(position) vec4f {
        let pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        return vec4f(pos[v_idx], 0.0, 1.0);
      }
      @group(0) @binding(0) var tex: texture_2d<f32>;
      @group(0) @binding(1) var samp: sampler;
      struct Uniforms { channel: f32, pad: vec3f }
      @group(0) @binding(2) var<uniform> uniforms: Uniforms;
      
      @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
        let size = vec2f(textureDimensions(tex));
        var uv = pos.xy / size;
        uv.y = 1.0 - uv.y; // flip y for correct display
        let val = textureSampleLevel(tex, samp, uv, 0.0);
        
        if (uniforms.channel > 2.5) {
          // aces tonemap for background to match
          let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
          var col = clamp((val.rgb * (a * val.rgb + b)) / (val.rgb * (c * val.rgb + d) + e), vec3f(0.0), vec3f(1.0));
          return vec4f(pow(col, vec3f(1.0/2.2)), 1.0);
        }
        
        var c = 0.0;
        if (uniforms.channel < 0.5) { c = val.r; }
        else if (uniforms.channel < 1.5) { c = val.g; }
        else { c = val.b; }
        return vec4f(vec3f(c), 1.0);
      }
    `;
    const debugModule = device.createShaderModule({ code: debugShader });
    debugPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: debugModule, entryPoint: "vs" },
      fragment: { module: debugModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
      primitive: { topology: "triangle-list" },
    });
    debugBindGroupGbuffer = device.createBindGroup({
      layout: debugPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: glassGenerator.texture.createView() },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: debugUniforms } },
      ],
    });
    debugBindGroupBg = device.createBindGroup({
      layout: debugPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: dummyBackground.createView() },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: debugUniforms } },
      ],
    });
  }
  // ----------------------------

  // Runtime state
  const startTime = performance.now();
  let stats: Record<string, any> = {
    fps: 0,
    frameMs: 0,
    spp: 1, // Single pass
  };

  let lastFrameTime = performance.now();
  let smoothedMs = 0;
  let frame = 0;

  function buildParamBlock(): Float32Array {
    const params = new Float32Array(32);

    // resolution_time: vec4f
    params[0] = RENDER_SIZE;  
    params[1] = RENDER_SIZE;  
    params[2] = (performance.now() - startTime) / 1000.0;  
    params[3] = frame;

    // sampling: vec4f (unused)
    params[4] = 1;
    params[5] = 1;
    params[6] = 1;
    params[7] = 1;

    // flags: vec4f
    params[8] = 0.0;
    params[9] = config.bgType ?? 0.0;
    params[10] = 0.0;
    params[11] = config.showOutdoorOnly ? 1.0 : 0.0;

    // tuning: vec4f
    params[12] = config.varianceBoost ?? 1.2;
    params[13] = config.outlierK ?? 3.0;
    params[14] = config.exposure ?? 1.18;
    params[15] = 0.0;

    // sun_camera: vec4f
    params[16] = config.sunAzimuth ?? 0.58;
    params[17] = config.sunElevation ?? 0.055;
    params[18] = config.cameraZ ?? 1.65;
    params[19] = config.cameraFocal ?? 1.85;

    // glass_a: vec4f
    params[20] = config.glassThickness ?? 0.06;
    params[21] = config.glassHeightAmpl ?? 0.01;
    params[22] = config.glassBump ?? 0.19; // Passed to map normal scale
    params[23] = config.glassRoughness ?? 0.085; // Ignored by analytical

    // glass_b: vec4f
    params[24] = config.glassIor ?? 1.52;
    params[25] = config.splitView ? 1.0 : 0.0;
    params[26] = 0.0;
    params[27] = 0.0;

    // debug: vec4f
    params[28] = config.splitView ? 1.0 : 0.0;
    params[29] = 0.0;
    params[30] = 0.0;
    params[31] = 0.0;

    return params;
  }

  // Return renderer object
  return {
    name: "v7_fast_analytical",

    async render(timestamp: number) {
      const now = performance.now();
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      smoothedMs = smoothedMs === 0 ? frameDelta : smoothedMs * 0.9 + frameDelta * 0.1;
      stats.frameMs = smoothedMs;
      stats.fps = smoothedMs > 0 ? 1000 / smoothedMs : 0;

      device.queue.writeBuffer(paramsBuffer, 0, buildParamBlock() as any);

      const encoder = device.createCommandEncoder();

      // Update and generate glass texture if needed
      // For peak perf in V7, we only do this when config changes, but we'll do it every frame here for simplicity of the port
      glassGenerator.updateConfig({
        width: RENDER_SIZE,
        height: RENDER_SIZE,
        scale: config.glassScale ?? 1.0,
        frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
        backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
        distortion: config.glassDistortion ?? 1.0,
        pattern_type: config.glassPatternType ?? 0.0,
        roughness: config.glassRoughness ?? 0.0,
      });
      glassGenerator.generate(encoder);

      // Glass compute pass
      const glassPass = encoder.beginComputePass();
      glassPass.setPipeline(glassComputePipeline);
      glassPass.setBindGroup(0, glassComputeBindGroup);
      glassPass.dispatchWorkgroups(
        Math.ceil(RENDER_SIZE / WORKGROUP_SIZE),
        Math.ceil(RENDER_SIZE / WORKGROUP_SIZE)
      );
      glassPass.end();

      // Render pass
      const colorView = context.getCurrentTexture().createView();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(0, renderParamsBindGroup);
      renderPass.setBindGroup(1, renderBindGroup);
      renderPass.draw(3);
      renderPass.end();

      if (config.splitView && debugPipeline && debugBindGroupGbuffer && debugBindGroupBg && debugContexts.length === 4) {
        for (let i = 0; i < 4; i++) {
          device.queue.writeBuffer(debugUniforms, 0, new Float32Array([i, 0, 0, 0]));
          const debugPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: debugContexts[i].getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store"
            }]
          });
          debugPass.setPipeline(debugPipeline);
          debugPass.setBindGroup(0, i === 3 ? debugBindGroupBg : debugBindGroupGbuffer);
          debugPass.draw(3);
          debugPass.end();
        }
      }

      device.queue.submit([encoder.finish()]);

      frame++;
    },

    getStats() {
      return { ...stats };
    },

    dispose() {
      paramsBuffer.destroy();
      displayTexture.destroy();
      dummyBackground.destroy();
    },
  };
}