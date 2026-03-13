import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader']
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', error => console.error(`[Browser Error] ${error}`));

  await page.addInitScript(() => {
    const originalRequestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function(...args) {
      const device = await originalRequestDevice.apply(this, args);
      device.onuncapturederror = (e) => {
        console.error('WebGPU uncaptured error: ' + e.error.message);
      };
      return device;
    };
  });

  console.log('Navigating to unified.html...');
  await page.goto('http://localhost:8000/unified.html');
  
  await page.selectOption('#algo-picker', 'v1_refined');
  await page.waitForTimeout(2000); 

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'webgpu-screenshot-v1.png' });
  console.log('Saved to webgpu-screenshot-v1.png');
  
  await browser.close();
})();
