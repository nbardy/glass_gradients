import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader']
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', error => console.error(`[Browser Error] ${error}`));

  // Inject script to catch unhandled GPU errors globally if possible
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

  // Select V6
  await page.selectOption('#algo-picker', 'v6_webgpu');
  console.log('Selected v6_webgpu...');

  console.log('Waiting for render...');
  await page.waitForTimeout(2000); 
  
  console.log('Taking screenshot...');
  await page.screenshot({ path: 'webgpu-screenshot.png' });
  console.log('Saved to webgpu-screenshot.png');
  
  await browser.close();
})();
