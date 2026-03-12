# V1 Refined WebGPU

This is a WebGPU migration of the original `v1` bathroom glass renderer.

## Goals

- keep the `v1` scene model: sky, cloud layers, skyline, and explicit two-interface frosted slab
- move accumulation from WebGL ping-pong feedback into a WebGPU compute pass
- track per-pixel sample statistics
- allocate extra samples to pixels with lower confidence
- use a better accumulator than a plain frame-average

## Run

From the repo root:

```bash
python3 -m http.server 6670
```

Then open:

```text
http://127.0.0.1:6670/v1_refined_webgpu/
```

## Renderer shape

- `renderer.wgsl`
  compute pass:
  renders one pixel per invocation
  updates per-pixel running mean and luminance variance
  chooses more samples for uncertain pixels
  writes display-ready color to a storage texture

- `app.js`
  sets up WebGPU
  manages buffers and uniforms
  handles reset and UI changes

- `index.html`
  minimal control surface

## Accumulation strategy

This version uses a running mean plus luminance variance tracking rather than the old `Buffer A` frame-average only.

That gives us:

- confidence estimates per pixel
- adaptive sample counts
- a place to add more advanced denoising or robust statistics later

## Theory

The physically correct target is still the expected sensor radiance for each pixel.
The unbiased Monte Carlo estimator for that expectation is a weighted mean of samples.

This renderer stays close to that, but adds a gentle outlier clamp as a practical realtime compromise.
