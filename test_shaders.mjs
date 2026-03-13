import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--use-angle=metal'
    ]
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:50093/unified.html');

  const shaders = [
    'core/glass_generator.wgsl',
    'v3/bathroom-glass-optical-simulator.wgsl'
  ];

  for (const file of shaders) {
    if (!fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, 'utf8');
    const result = await page.evaluate(async (wgslCode) => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();
        device.pushErrorScope('validation');
        const module = device.createShaderModule({ code: wgslCode });
        const info = await module.getCompilationInfo();
        const popError = await device.popErrorScope();
        
        let errors = info.messages.map(m => `Line ${m.lineNum}: ${m.message}`);
        if (popError) {
          errors.push(popError.message);
        }
        return errors;
      } catch (e) {
        return [e.toString()];
      }
    }, code);
    
    if (result.length > 0) {
      console.log(`\nErrors in ${file}:`);
      console.log(result.join('\n'));
    } else {
      console.log(`\n${file} compiled successfully.`);
    }
  }

  await browser.close();
})();
