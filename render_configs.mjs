import puppeteer from 'puppeteer';
import fs from 'fs';

// Define a suite of specific rendering configurations to test/render
const RENDER_SUITE = [
  {
    name: 'v7_no_refraction_baseline',
    algo: 'v7_fast_analytical',
    bgType: 'math',
    config: {
      glassIor: 1.0,           // Disables bending completely
      glassPatternType: 2,     // Pebbled
      glassBump: 0.19,
    }
  },
  {
    name: 'v1_hammered_bruneton',
    algo: 'v1_refined',
    bgType: 'bruneton',
    config: {
      glassPatternType: 6,     // Hammered Glass
      glassIor: 1.52,          // Normal glass
      glassThickness: 0.08,
      glassScale: 1.2,
      sunElevation: 0.15,      // Mid-day physical sky
    }
  },
  {
    name: 'v8_condensation_sunset',
    algo: 'v8_stochastic_pbr',
    bgType: 'math',
    config: {
      glassPatternType: 5,     // Condensation
      glassIor: 1.33,          // Water droplets
      glassScale: 0.8,
      sunElevation: -0.05,     // Sunset / Twilight
      sunAzimuth: 0.3,
    }
  },
  {
    name: 'v7_heavy_distortion_fluted',
    algo: 'v7_fast_analytical',
    bgType: 'math',
    config: {
      glassPatternType: 3,     // Ribbed/Fluted
      glassScale: 3.0,
      glassDistortion: 2.5,    // Extreme stretching
      glassIor: 1.6,           // Heavy bending
    }
  }
];

(async () => {
  console.log("Launching headless renderer...");
  
  // Ensure output directory exists
  if (!fs.existsSync('./output')) {
    fs.mkdirSync('./output');
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal']
  });

  for (const pass of RENDER_SUITE) {
    console.log(`\n▶ Rendering: ${pass.name}...`);
    const page = await browser.newPage();
    let errorCount = 0;
    
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('error') || text.includes('warning') || msg.type() === 'error') {
         console.log(`  [CONSOLE] ${text}`);
         errorCount++;
      }
    });

    await page.goto('http://localhost:8000/unified.html');
    
    // Inject the configuration into the app
    await page.evaluate((passConfig) => {
      // 1. Set Background Type
      const bgSelect = document.querySelector('#bg-picker');
      bgSelect.value = passConfig.bgType;
      bgSelect.dispatchEvent(new Event('change'));

      // 2. Set Algorithm
      const algoSelect = document.querySelector('#algo-picker');
      algoSelect.value = passConfig.algo;
      algoSelect.dispatchEvent(new Event('change'));

      // Wait a tiny bit for the UI to rebuild the controls form
    }, pass);

    // We have to wait for the switchAlgorithm async function to finish building the UI
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. Set Hyperparameters
    await page.evaluate((hyperParams) => {
      for (const [key, value] of Object.entries(hyperParams)) {
        const input = document.querySelector(`[data-setting="${key}"]`);
        if (input) {
          input.value = value.toString();
          // Dispatch input/change events so DenseControls picks it up
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          console.warn(`Could not find UI control for ${key}`);
        }
      }
    }, pass.config);

    console.log(`  Waiting 4 seconds for rays to accumulate/settle...`);
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    const screenshotPath = `./output/${pass.name}.png`;
    await page.screenshot({ path: screenshotPath });
    
    console.log(`  ✔ Saved: ${screenshotPath}`);
    if (errorCount > 0) {
      console.log(`  ! Encountered ${errorCount} errors during render.`);
    }
    await page.close();
  }

  await browser.close();
  console.log("\n✅ Batch rendering complete!");
})();
