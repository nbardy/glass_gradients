import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal']
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  await page.goto('http://localhost:8000/unified.html');
  await page.evaluate(() => {
    document.querySelector('#algo-picker').value = 'v7_fast_analytical';
    document.querySelector('#algo-picker').dispatchEvent(new Event('change'));
  });
  await new Promise(resolve => setTimeout(resolve, 2000));
  await page.screenshot({ path: 'v7-screenshot.png' });
  await browser.close();
  console.log("Saved v7-screenshot.png");
})();
