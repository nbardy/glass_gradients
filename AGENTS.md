# Glass Gradients - Agent Documentation

## Headless WebGPU Testing

To test WebGPU rendering headlessly (e.g. for CI or automated agents), you can use Puppeteer. A ready-to-use script is provided in `screenshot.mjs`.

### Requirements
- `puppeteer` installed as a dev dependency.

### Usage
Make sure the local server is running (`npm run serve`), then run the screenshot script:
```bash
node screenshot.mjs
```

### How it works
The script uses Puppeteer to launch headless Chromium with the necessary WebGPU flags:
- `--enable-unsafe-webgpu`
- `--ignore-gpu-blocklist`
- `--use-angle=metal` (Ensures the Metal backend is used on macOS)

It navigates to `http://localhost:8000/unified.html`, captures browser console outputs for easy debugging, waits a few seconds for progressive renderers (like V1 Refined) to accumulate and settle, and finally saves a snapshot to `webgpu-screenshot.png`.
