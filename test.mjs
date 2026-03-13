import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', error => console.error(`[Browser Error] ${error}`));

  await page.goto('http://localhost:8000/unified.html');
  await page.waitForTimeout(2000);
  
  await browser.close();
})();
