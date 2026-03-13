import { AlgoRenderer } from "../../core/renderer";

export async function v4GlassPipeline(
  device: any,
  canvas: HTMLCanvasElement,
  shaderSource: string,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  const context = canvas.getContext("webgpu") as any;
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const shaderModule = device.createShaderModule({ code: shaderSource });

  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  const paramsBuffer = device.createBuffer({
    size: 16, // resolution(8), time(4), pad(4)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });

  let lastTime = performance.now();
  let frameCount = 0;
  const startTime = performance.now();
  const stats = { fps: 0, frameMs: 0, status: "Running WebGPU (Transcribed)" };

  return {
    name: "v4_webgl2",
    async render(timestamp: number) {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      stats.frameMs = delta;
      stats.fps = delta > 0 ? 1000 / delta : 0;
      frameCount++;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const paramsArray = new Float32Array([width, height, (now - startTime) / 1000.0, 0]);
      device.queue.writeBuffer(paramsBuffer, 0, paramsArray);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(renderPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();

      device.queue.submit([encoder.finish()]);
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      paramsBuffer.destroy();
    },
  };
}