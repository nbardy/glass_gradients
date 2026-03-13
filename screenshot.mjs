import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

let maxErrorCount = 10;
let maxErrorLength = 500;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--max-error-count=')) {
    maxErrorCount = parseInt(arg.split('=')[1], 10);
  }
  if (arg.startsWith('--max-error-length=')) {
    maxErrorLength = parseInt(arg.split('=')[1], 10);
  }
}

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
  
  const errors = [];

  // Forward browser console logs and errors to terminal
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    } else {
      console.log('PAGE CONSOLE:', msg.text());
    }
  });
  
  page.on('pageerror', err => {
    errors.push(err.message);
  });

  console.log("Navigating to http://localhost:8000/unified.html...");
  await page.goto('http://localhost:8000/unified.html');
  
  console.log("Waiting 5 seconds for WebGPU rendering to settle...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const screenshotFilename = 'webgpu-screenshot.png';
  console.log("Taking screenshot...");
  await page.screenshot({ path: screenshotFilename });
  
  await browser.close();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const absPath = path.resolve(__dirname, screenshotFilename);

  console.log("\n--- TEST RESULTS ---");
  console.log(`TOTAL ERROR COUNT: ${errors.length}`);
  
  if (errors.length > 0) {
      console.log("ERRORS (Truncated):");
      const displayErrors = errors.slice(0, maxErrorCount);
      displayErrors.forEach((err, idx) => {
          let text = err;
          if (text.length > maxErrorLength) {
              text = text.substring(0, maxErrorLength) + '... [TRUNCATED]';
          }
          console.log(`  ${idx + 1}: ${text}`);
      });
      if (errors.length > maxErrorCount) {
          console.log(`  ... and ${errors.length - maxErrorCount} more errors. [TRUNCATED LIST]`);
      }
  } else {
      console.log("No errors detected.");
  }

  console.log(`\nScreenshot saved to absolute path: ${absPath}`);
  console.log(`\nLLM INSTRUCTION: Please use the \`read_file\` tool on the absolute path above to view the image, and describe what you see.`);
})();
