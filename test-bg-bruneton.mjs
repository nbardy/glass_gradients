import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal']
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  
  await page.goto('http://localhost:8000/unified.html');
  
  // Switch to Bruneton
  await page.evaluate(() => {
    const select = document.querySelector('#bg-picker');
    select.value = 'bruneton';
    select.dispatchEvent(new Event('change'));
  });

  await new Promise(resolve => setTimeout(resolve, 3000));
  await page.screenshot({ path: 'bruneton-screenshot.png' });
  await browser.close();
  console.log("Saved bruneton-screenshot.png");
})();
