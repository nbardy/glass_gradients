import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:50093/unified.html');

  const shaders = ['v1_refined_webgpu/renderer.wgsl', 'algorithms/v7/renderer.wgsl', 'algorithms/v8_stochastic_pbr/renderer.wgsl'];

  for (const file of shaders) {
    if (!fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, 'utf8');
    const result = await page.evaluate(async (wgslCode) => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({ code: wgslCode });
        await device.createComputePipelineAsync({
          layout: "auto",
          compute: { module, entryPoint: "main_compute" }
        });
        return "Pipeline created successfully";
      } catch (e) {
        return e.toString();
      }
    }, code);
    console.log(`\nPipeline for ${file}:\n${result}`);
  }

  await browser.close();
})();
