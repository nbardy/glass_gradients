import puppeteer from 'puppeteer';

(async () => {
  console.log("Launching browser with WebGPU flags...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--use-angle=metal' // Ensures Metal backend on macOS
    ]
  });
  
  const page = await browser.newPage();
  
  // Forward browser console logs and errors to terminal
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  console.log("Navigating to http://localhost:8000/unified.html...");
  await page.goto('http://localhost:8000/unified.html');
  
  console.log("Waiting 5 seconds for V1 accumulation to settle...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log("Taking screenshot...");
  await page.screenshot({ path: 'webgpu-screenshot.png' });
  
  await browser.close();
  console.log("Screenshot saved to webgpu-screenshot.png!");
})();
