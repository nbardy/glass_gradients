import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal']
  });
  const page = await browser.newPage();
  
  let errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:50093/unified.html');
  await new Promise(r => setTimeout(r, 1000));
  
  const algos = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#algo-picker option')).map(o => o.value);
  });
  
  for (const algo of algos) {
    console.log(`Testing ${algo}...`);
    errors = [];
    await page.evaluate((val) => {
      document.querySelector('#algo-picker').value = val;
      document.querySelector('#algo-picker').dispatchEvent(new Event('change'));
    }, algo);
    await new Promise(r => setTimeout(r, 1000));
    if (errors.length > 0) {
      console.log(`Errors in ${algo}:`);
      console.log(errors.join('\n'));
    }
  }

  await browser.close();
})();
