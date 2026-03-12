# v6 Critical Corrections & Architectural Gaps

This document records the hard architectural problems discovered after initial v6 design. These are **not implementation details**—they are fundamental correctness issues.

---

## 1. The Old Atmosphere Interface Was Fundamentally Wrong

**Status:** FIXED in skyview.wgsl

**What was wrong:**
The placeholder `evalBrunetonSky()` sampled a transmittance texture + a made-up "multiScatter LUT" as if Bruneton were a simple 2D model. It isn't.

**Reality:**
Bruneton's 2017 implementation uses a **4D scattering domain** `(r, μ, μ_s, ν)` packed into a **3D texture**. The render-time lookup:
- Samples 2D transmittance
- Samples packed 3D scattering + single-Mie separately
- Applies phase functions (`rayleighPhase()`, `miePhase()`) at render time
- Depends on exact numerical mappings for UV coordinate generation

**Fix applied:**
`skyview.wgsl` now contains the full render-time path including:
- All coordinate transformations (`scatteringUvwzFromRMuMuSNu`)
- Phase function application
- Packed texture interpolation
- Proper transmittance ratios

**Reference:** https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html

---

## 2. WebGPU Texture Layout Must Change (Not Done Yet)

**Status:** NEEDS IMPLEMENTATION

**Current state:**
The v6 sketch showed `multiScatterLUT` as a 2D texture. That is wrong for a faithful Bruneton port.

**Required layout:**
```ts
const transmittanceTex = device.createTexture({
  size: { width: transW, height: transH },
  format: "rgba16float",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | ...,
});

const scatteringTex = device.createTexture({
  // Packed 4D → 3D: width = nu*muS, height = mu, depth = r
  size: {
    width: scatNuSize * scatMuSSize,
    height: scatMuSize,
    depthOrArrayLayers: scatRSize,
  },
  dimension: "3d",
  format: "rgba16float",
  usage: ...,
});

const singleMieTex = device.createTexture({
  // Same layout as scattering
  size: { width: scatNuSize * scatMuSSize, height: scatMuSize, depthOrArrayLayers: scatRSize },
  dimension: "3d",
  format: "rgba16float",
  usage: ...,
});
```

**Impact:** The current `index.html` and ARCHITECTURE.md sketch still show the wrong texture layout. Update those before implementing the renderer.

---

## 3. Glass Precompute Has a Coordinate-Space Bug

**Status:** CRITICAL — NOT FIXED

**The bug:**
`glass-precompute.wgsl` computes a **window-space shift** `shift.xy` and stores it in `transport0.xy`. The composite pass then uses that as a **sky-UV shift**.

```wgsl
let shift = select(vec2f(0.0), P.cameraDist * (outTan - baseTan), transmitted);
textureStore(outTransport0, vec2<i32>(gid.xy), vec4f(shift, pathLen, F));
```

Later in composite:
```wgsl
let skyUV = uv + shift * 0.5;
```

**Why it's wrong:**
- `shift` is a **pixel displacement in window coordinates**
- `skyUV` is a **spherical sky map coordinate**
- Near the image edges and horizon, this causes **real warping errors**

**Correct fix:**
The glass precompute should store either:

a) **Mean outgoing direction** in octahedral encoding:
```wgsl
// In glass-precompute
let outDir = normalize(vec3f(outTan, 1.0));
let octahedral = encodeOctahedral(outDir);
// Store in transport1 or transport2
```

Then in composite:
```wgsl
let outDir = decodeOctahedral(transportOct);
let skyUV = sampleSkyFromDirection(outDir);
```

b) **Projected sky UV directly** (faster but less flexible):
Store the actual sky-map UV that the refracted ray points to, not a pixel shift.

**Impact:** Without this fix, chromatic aberration and glass distortion will subtly warp at screen edges, especially visible at high aspect ratios or wide fields of view.

---

## 4. Dispersion Is Still a Hack

**Status:** NOT FIXED (medium priority)

**Current approach:**
```wgsl
let disp = axis * P.dispersionScale * (0.7 + 8.0 * max(sigmaMain.x, sigmaMain.y));
let mainR = sampleSky(skyUV - disp, axis, sigmaMain, tapsMain, phi, 0.0).r;
let mainG = sampleSky(skyUV,       axis, sigmaMain, tapsMain, phi, 0.0).g;
let mainB = sampleSky(skyUV + disp, axis, sigmaMain, tapsMain, phi, 0.0).b;
```

**Why it's wrong:**
This is **not a physical solution**. It treats dispersion as a 1D offset in sky-sample space, but real glass refraction produces **channel-specific outgoing directions**, not just colors shifted along an axis.

**Better approach:**
Precompute **channel-specific transport**:

a) Store **three mean outgoing directions** (one per channel):
```wgsl
// In glass-precompute
let outDirR = computeMeanOutDir(ray, front, eta_R, ...);
let outDirG = computeMeanOutDir(ray, front, eta_G, ...);
let outDirB = computeMeanOutDir(ray, front, eta_B, ...);
// Store in transport channels or separate textures
```

b) Or compute a **mean direction + Jacobian**:
```wgsl
let meanDir = computeMeanOutDir(ray, front, eta_mean, ...);
let dDirDEta = computeDirectionJacobian(...);
// Reconstruct R, G, B from eta and Jacobian in composite
```

**Impact:** Current hack works **visually** but breaks under scrutiny. A serious implementation needs proper per-channel transport.

---

## 5. Atmosphere Precision Should Stay in f32

**Status:** RECOMMENDATION (not a bug yet)

**Current plan:**
Use `rgba16float` for all texture storage to save bandwidth.

**Reality:**
The **math** for atmosphere precompute and render-time lookup should stay in `f32` because:
- Horizon mappings in `transmittanceUvFromRMu()` are numerically sensitive
- Transmittance ratios and UV conversions can quietly accumulate error
- The phase function lookups depend on exact coordinate transforms

**Safe approach:**
```ts
// Precompute in f32, store result in rgba16float
// Lookup: fetch from rgba16float, expand to f32 for math
const scatteringTex = device.createTexture({
  format: "rgba16float",  // Storage
  ...
});
// In WGSL, fetch and do math in f32 (automatic in WGSL)
let sample = textureSample(...);  // Returns f32 even from f16 texture
```

The browser **automatically expands f16 samples to f32** for arithmetic, so this is safe.

**Impact:** Low-risk optimization. Do it, but don't store intermediate math in f16.

---

## 6. LUT Generation Matters More Than Lookup Code

**Status:** UNADDRESSED (critical for quality)

**What this means:**
The lookup code in `skyview.wgsl` is now correct. But the **precomputation side** determines sunset quality.

**Bruneton's 2017 improvements (vs. older versions):**
- Ozone absorption (especially at horizon)
- Custom density profiles (altitude-dependent Rayleigh/Mie)
- Proper solar spectrum (not constant)
- Correct luminance handling (brightness calibration)
- Full 3D scattering texture precision

**Current v6 gap:**
You have the **render-time lookup** but no precompute pipeline. The LUT generator still needs to:

1. Implement Bruneton's atmospheric model with ozone
2. Precompute transmittance LUT (direct transmittance from camera to top)
3. Precompute multi-scattering LUT (scattering + sky-view)
4. Precompute single-Mie separately (for proper phase blending)
5. Pack 4D scattering domain into 3D texture correctly

**Reference:**
https://ebruneton.github.io/precomputed_atmospheric_scattering/?utm_source=chatgpt.com

This is **not optional** if you want real sunsets. The lookup code alone will give structurally correct but mediocre results.

---

## 7. Missing: Ground/Building Irradiance

**Status:** UNADDRESSED (medium priority for buildings)

**Current state:**
The composite pass does:
```wgsl
let reflection = interiorReflection((uv * 2.0 - 1.0));
```

This is a fake placeholder for room bounce.

**Reality:**
Bruneton's model includes **irradiance**, which is the downward light falling on horizontal surfaces. For **physically consistent ground and building lighting**:

1. Precompute an **irradiance texture** (2D or 3D depending on model)
2. Sample irradiance based on surface normal (for buildings, horizontal = 0°)
3. Combine with direct sunlight

**Current gap:**
Without this, your **sky is physically grounded** while your buildings are still hand-painted. Interior reflections are currently a hack, not a physical consequence.

---

## 8. Sun Disk Should Use Atmospheric Transmittance

**Status:** PARTIALLY FIXED

**What's changed:**
`skyview.wgsl` now includes:
```wgsl
L += vec3f(1.0, 0.85, 0.6) * pow(max(0.0, sunDiskSteps), 2.0) * s.transmittance;
```

This multiplies the sun disk by the computed atmospheric transmittance, which is better than a fake sprite.

**Still not ideal:**
This is an **analytic disk**, not a **resolved solar limb**. For true photorealism:
- Sample the **solar radiance** from the scattering texture
- Apply atmospheric **extinction** correctly
- Handle **limb darkening** (solar disk is darker at the edge)

But the current approach is a solid step forward.

---

## 9. Cloud Model Is Separate, Not Unified

**Status:** ARCHITECTURAL LIMITATION (working as intended)

**Current design:**
1. Bruneton sky as background
2. Sky-space clouds layered on top (extinction + glow)
3. Glass as transport operator

**Why this is okay:**
For bathroom window images, this is a good compromise. Unified cloud+atmosphere transport is much heavier.

**Limitation:**
Clouds and atmosphere are **decoupled**. So:
- Clouds don't scatter light downward realistically
- Shadows under clouds aren't physically consistent
- Volumetric density gradients are hand-painted

For a shipping app, this is fine. If you later want full volumetric clouds, you'd need to fold them into the precompute or add a separate volumetric march.

---

## 10. No Verification Tests

**Status:** NOT DONE (should be done before shipping)

**Recommended test suite:**

```ts
// CPU-side checks for WGSL functions:
function testDistanceToTopBoundary() {
  const r = 6371 + 10;  // Earth radius + 10 km
  const mu = 0.5;
  const d = distanceToTopBoundary(r, mu);
  // Check: d >= 0, d should equal published reference values
}

function testRayIntersectsGround() {
  // Ground hit: r near surface, mu < 0 ✓
  // No hit: r near surface, mu > 0 ✗
}

function testTransmittanceRatios() {
  // Verify: T(r, mu) / T(r, -mu) = expected value
  // Bruneton's reference provides ground truth
}

function testScatteringCoordinateMapping() {
  // Round-trip: (r, mu, muS, nu) → UV → sample → back
  // Verify monotonicity and invertibility
}

function testSkyRadianceVsReference() {
  // Compare a few sky directions against
  // Bruneton's reference implementation
  // Should match within 1-2%
}
```

**Impact:** Without tests, bugs in coordinate mapping or phase functions will be **subtle and hard to find**. Invest in verification.

---

## 11. Optimize Second: Profile First

**Status:** GOOD PRACTICE

**Current ARCHITECTURE.md includes timestamp-query setup**, which is correct. But before you apply fancy optimizations (f16, subgroups, tile classification):

1. **Measure the baseline** with timestamp queries
2. **Identify the real bottleneck** (likely glass precompute on resize, composite on frame)
3. **Profile on your target hardware** (mobile, desktop, VR)
4. **Then optimize the actual bottleneck**

Premature optimization of the wrong pass wastes effort.

---

## Checklist for v6 → Production

- [ ] Update `index.html` to create `scatteringTex` + `singleMieTex` (not fake `multiScatterLUT`)
- [ ] Implement LUT precomputation pipeline (Bruneton's model, not toy version)
- [ ] Fix glass coordinate-space bug: store mean outgoing direction or sky-space UV
- [ ] Improve dispersion: compute per-channel outgoing directions
- [ ] Add irradiance precompute for ground/building lighting
- [ ] Implement CPU test suite for atmosphere math
- [ ] Profile: measure sky-view compute, glass precompute, composite, present times
- [ ] Optimize based on real measurements, not guesses
- [ ] Ship with confidence

---

## References

- Bruneton et al., *Precomputed Atmospheric Scattering*: https://ebruneton.github.io/precomputed_atmospheric_scattering/
- Bruneton's reference GLSL: https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html
- WebGPU Spec: https://gpuweb.github.io/gpuweb/
- WGSL Spec: https://gpuweb.github.io/gpuweb/wgsl/

---

**Status as of 2026-03-13:**
- ✅ Render-time sky lookup (fixed)
- ⚠️ Texture layout (needs update)
- 🔴 Glass coordinate-space (critical bug)
- ⚠️ Dispersion model (good enough but not physical)
- ⚠️ LUT precomputation (skeleton only)
- ⚠️ Irradiance (missing)
- ⚠️ Testing (missing)
