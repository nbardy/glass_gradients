import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader']
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', error => console.error(`[Browser Error] ${error}`));

  console.log('Navigating to unified.html...');
  await page.goto('http://localhost:8000/unified.html');
  
  console.log('Waiting for render...');
  await page.waitForTimeout(3000); // give it a moment to accumulate
  
  console.log('Taking screenshot...');
  await page.screenshot({ path: 'webgpu-screenshot.png' });
  console.log('Saved to webgpu-screenshot.png');
  
  await browser.close();
})();
