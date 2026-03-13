import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal']
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  await page.goto('http://localhost:8000/unified.html');
  await new Promise(resolve => setTimeout(resolve, 3000));
  await page.screenshot({ path: 'bg-screenshot.png' });
  await browser.close();
  console.log("Saved bg-screenshot.png");
})();
