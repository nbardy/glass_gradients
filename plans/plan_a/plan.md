# Plan A: Minimal Unification

## Vision
Keep existing code mostly unchanged. Add a thin **selector layer** that:
- Picks which shader (v1, v3, v6) to compile
- Swaps hyperparams dict based on selection
- Reuses existing UI controls with dynamic visibility

**Complexity:** Low
**Implementation time:** 2-3 hours
**Risk:** Low (minimal refactor)

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│        Unified index.html           │
│  (Canvas + Controls + Metrics)      │
└────────────────┬────────────────────┘
                 │
        ┌────────┴────────┐
        ↓                 ↓
   Algo Picker      Config Manager
   (dropdown)       (swaps hyperparams)
        │                 │
        └────────┬────────┘
                 ↓
         ┌───────────────┐
         │  Renderer     │
         │  (v1|v3|v6)   │
         └───────────────┘
```

---

## Key Components

### 1. Algo Picker
- Dropdown: `<select id="algo">`
- Options: `v1_refined`, `v3_glsl`, `v4_webgl2`, `v6_webgpu`
- On change: reload shader, reset accumulation

### 2. Config Manager
- Dictionary of hyperparameter sets:
  ```ts
  const ALGO_CONFIGS = {
    v1_refined: {
      baseSamples: { min: 1, max: 16, step: 1 },
      maxSamples: { min: 1, max: 32, step: 1 },
      targetError: { min: 0.01, max: 0.2, step: 0.01 },
      // ...
    },
    v3_glsl: {
      SAMPLES: { min: 4, max: 128, step: 4 },
      etaR: { min: 0.6, max: 0.9, step: 0.01 },
      // ...
    },
    // ...
  };
  ```

### 3. Dynamic Controls Panel
- Render controls from `ALGO_CONFIGS[selectedAlgo]`
- Hide/show based on algo
- Each control updates config dict

### 4. Shader Loader
- Load correct shader file (v1/renderer.wgsl, v3/shader.glsl, etc.)
- Compile immediately on selection
- Show compile errors in UI

### 5. Stats Mapper
- Map shader output stats → metric cards
- `v1` outputs: `totalSamples, confidentPixels, stablePixels, ...`
- `v3` outputs: `frameTime, spp` (minimal)
- `v6` outputs: TBD

---

## File Structure

```
glass_gradients/
├── index.html              (unified, controls picker)
├── app.ts                  (main orchestrator)
├── config.ts               (ALGO_CONFIGS)
├── v1_refined/
│   ├── renderer.wgsl
│   ├── app.js              (extracted to lib/v1.ts)
│   └── styles.css
├── v3/
│   ├── shader.glsl
│   └── v3.ts               (host wrapper)
├── v4/
│   ├── index.html          (old, deprecated)
│   └── v4.ts               (host wrapper)
└── v6/
    ├── *.wgsl              (shaders)
    └── v6.ts               (host wrapper)
```

---

## Step-by-Step Implementation

1. Extract v1 host logic → `lib/v1_renderer.ts`
2. Create wrapper interfaces:
   ```ts
   interface AlgoRenderer {
     compile(): Promise<void>
     render(): void
     getStats(): Stats
     reset(): void
   }
   ```
3. Create `AlgoConfig` loader
4. Update `index.html` to add algo picker
5. Update `app.ts` to call selected renderer
6. Test each algo selection

---

## Pros
- Minimal code change
- Reuses existing structures
- Easy to add new algos later
- Low risk of breaking anything

## Cons
- Hyperparams are hardcoded
- Stats mapping is manual
- No shared abstraction (code duplication)
- Tight coupling to each algo's specifics
- Difficult to add new features uniformly

---

## Risk Assessment
- **GPU:** Low (each algo is proven)
- **UI:** Low (picker is simple)
- **Shader compilation:** Low (existing pipelines)
- **State management:** Medium (need to reset properly between switches)

---

## Timeline
- Setup & scaffold: 30 min
- Extract v1 logic: 30 min
- Config system: 30 min
- Dynamic UI: 30 min
- Testing: 30 min
- **Total: ~2.5 hours**
