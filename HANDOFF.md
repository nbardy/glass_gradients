# Glass Gradients - Handoff Document

## Current State

We have successfully unified the codebase into a single architecture. The application runs through a central `unified.html` file, which uses a dropdown to switch between different rendering algorithms seamlessly. 

### What's Working:
- **Unified UI:** `unified.html` and `app.ts` are fully functional, utilizing `DenseControls` for a dynamic parameters UI that updates based on the selected algorithm.
- **V1 Pipeline (Refined WebGPU):** This pipeline is fully integrated and functioning. It uses a `GlassGenerator` to precompute a G-buffer (glass morphology) and runs an adaptive Monte Carlo accumulation pass.
- **Headless Testing:** A Puppeteer script (`screenshot.mjs`) is set up to launch a headless browser with WebGPU flags enabled, load the UI, wait for the V1 accumulation to settle, and save a screenshot (`webgpu-screenshot.png`). This is documented in `AGENTS.md` (symlinked to `CLAUDE.md`).
- **Recent WIP:** Split view functionality has been wired up in the UI and the V1/V7 pipelines. Debugging overrides have been added to the V1 shader to visualize the G-buffer. New stubs for `v7` and `v8_stochastic_pbr` have been scaffolded.

## Overhang Ideas & Next Steps

The primary goal moving forward is to complete the **V6 WebGPU Compute Architecture**, which is intended to be the ultimate, high-performance destination for this project.

### 1. Fix the V6 Architecture (Highest Priority)
V6 completely supersedes earlier versions by using precomputed transport maps and atmosphere, offering 30-60x better performance. However, it currently has several critical blocking issues documented in `v6/CORRECTIONS.md`:

*   **Fix Glass Transport Domain Bug:** The V6 glass precompute currently stores a window-space pixel shift, which causes warping and breaks spherical background sampling near edges. 
    *   *Action:* Change the output of the glass precompute to store either a mean outgoing direction (octahedrally encoded) or direct target-domain sample coordinates.
*   **Implement Bruneton Atmosphere Precompute:** The composite pass has the correct mathematical structure for lookup, but the LUT generation pipeline is completely missing.
    *   *Action:* Implement the generation passes for Transmittance, Multi-scattering, and Single-Mie textures using the full 2017 Bruneton model (including ozone and correct luminance).
*   **Fix Dispersion Hack:** The current dispersion implementation treats dispersion as a 1D color offset rather than physically grounded refraction.
    *   *Action:* Precompute per-channel mean outgoing directions or a direction Jacobian.

### 2. Minor Refactoring / Stubs
*   **V3 GLSL Integration:** V3 is a mathematically sound, single-pass analytical solver (using Snell's law and Vogel spirals instead of Monte Carlo). It is currently a stub in the unified UI.
    *   *Action:* Transcribe the `bathroom-glass-optical-simulator.glsl` into WGSL to integrate it into `algorithms/v3/glass_pipeline.ts`.
*   **V4 WebGL2 Integration:** V4 is a highly optimized WebGL2 application. 
    *   *Action:* Decide whether to maintain a dual-context setup (WebGL2 vs WebGPU) to support V4 in the unified app, or deprecate it entirely in favor of V6.

### 3. Polish & Validation
*   Write CPU-side unit tests to validate the complex coordinate mapping and transmittance math required by the Bruneton atmosphere model to prevent subtle visual bugs.
