import { GlassGenerator } from './core/glass_generator.js';

async function init() {
  if (!navigator.gpu) {
    document.body.innerHTML = 'WebGPU not supported';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById('canvas');
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'opaque'
  });

  const shaderCode = await fetch('./core/glass_generator.wgsl').then(r => r.text());

  const generator = new GlassGenerator(device, shaderCode, {
    width: 1024,
    height: 1024,
    scale: 1.0,
    distortion: 1.0,
    pattern_type: 0,
    roughness: 0.0
  });

  // Render pipeline to display the texture
  const renderModule = device.createShaderModule({
    code: `
      @vertex fn vs(@builtin(vertex_index) v_idx: u32) -> @builtin(position) vec4f {
        let x = f32((v_idx << 1u) & 2u) * 2.0 - 1.0;
        let y = f32(v_idx & 2u) * 2.0 - 1.0;
        return vec4f(x, -y, 0.0, 1.0);
      }

      @group(0) @binding(0) var tex: texture_2d<f32>;
      @group(0) @binding(1) var samp: sampler;

      @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
        let size = vec2f(textureDimensions(tex));
        let uv = pos.xy / size;
        let val = textureSample(tex, samp, uv);
        
        // Normalize height slightly for visualization
        let r = val.r; 
        let g = val.g;
        let b = val.b; // Roughness
        return vec4f(r, g, b, 1.0);
      }
    `
  });

  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear'
  });

  const bindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: generator.texture.createView() },
      { binding: 1, resource: sampler }
    ]
  });

  function draw() {
    generator.generate();

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    passEncoder.setPipeline(renderPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(3);
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
  }

  function update() {
    generator.updateConfig({
      width: 1024, height: 1024,
      scale: parseFloat(document.getElementById('scale').value),
      distortion: parseFloat(document.getElementById('dist').value),
      pattern_type: parseFloat(document.getElementById('pattern_type').value),
      roughness: parseFloat(document.getElementById('rough').value)
    });
    draw();
  }

  document.getElementById('scale').addEventListener('input', update);
  document.getElementById('dist').addEventListener('input', update);
  document.getElementById('rough').addEventListener('input', update);
  document.getElementById('pattern_type').addEventListener('change', update);

  draw();
}

init();
