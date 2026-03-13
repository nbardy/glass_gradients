import puppeteer from 'puppeteer';

const ALGOS = ['v1_refined', 'v7_fast_analytical', 'v8_stochastic_pbr'];

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal']
  });

  for (const algo of ALGOS) {
    console.log(`\n=== Testing ${algo} ===`);
    const page = await browser.newPage();
    let errorCount = 0;
    
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('error') || text.includes('warning') || msg.type() === 'error') {
         console.log(`[CONSOLE] ${text}`);
         errorCount++;
      }
    });
    page.on('pageerror', err => {
      console.error(`[PAGE ERROR] ${err.message}`);
      errorCount++;
    });

    await page.goto('http://localhost:8000/unified.html');
    
    // Switch algorithm
    await page.evaluate((a) => {
      const select = document.querySelector('#algo-picker');
      select.value = a;
      select.dispatchEvent(new Event('change'));
    }, algo);

    // Wait for render to settle
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const screenshotPath = `test-screenshot-${algo}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved ${screenshotPath}`);
    console.log(`Errors encountered: ${errorCount}`);
    await page.close();
  }

  await browser.close();
  console.log("\nDone checking all algorithms.");
})();
