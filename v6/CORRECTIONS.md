# v6 Critical Corrections & Architectural Audit

This document records the hard architectural problems discovered after initial v6 design, with honest assessment of what's working and what's still broken.

---

## Current Status Summary

### ✅ Verified / Materially Improved

- The render-time atmosphere lookup now follows the Bruneton-style structure:
  - Transmittance lookup parameterized from `(r, μ)`
  - Scattering lookup parameterized from `(r, μ, μ_s, ν)`
  - Packed 4D → 3D scattering texture layout is documented
  - Rayleigh and Mie phase functions applied at render time

- Atmosphere-side shader math is structurally aligned with Bruneton's model,
  **assuming LUTs are generated with matching mappings, units, and storage conventions.**

### 🔴 Blocking Issues (Must Fix Before Viability)

#### 1. Glass/Background Coordinate-Space Mismatch (Root Cause)

**The Problem:**
- Glass precompute stores `shift.xy` in **window/image coordinates**
- Composite pass uses that shift as though it were a **sky-domain UV offset**
- This is wrong for spherical backgrounds and causes edge/horizon warping

**Why This Matters:**
The transport representation (window-plane shift) does not match the application domain (spherical sky). This is a **fundamental transport-domain error**, not a tuning issue.

**Required Fix:**
Glass must output one of:
- **Mean outgoing direction** (preferably oct-encoded) + local spread
- **Direct sky/sample coordinates** in the target background domain
- **Direction Jacobian** that allows the composite to derive correct sampling

Current representation is not robust across FOV, horizon curvature, or non-planar backgrounds.

#### 2. Bruneton LUT Precompute Is Missing

**Current State:**
We have a valid render-time lookup structure but no precompute generator.

**Missing Pieces:**
- Full Bruneton 2017 atmospheric model (not toy constant-spectrum version)
- Ozone absorption
- Custom density profiles
- Proper solar spectrum handling
- Luminance-consistent storage
- Transmittance LUT generation
- Multi-scattering LUT generation
- Single-Mie texture generation
- Correct 4D → 3D packing into storage textures

**Impact:**
Without this, the atmosphere subsystem is incomplete. The lookup code alone produces structurally correct but mediocre results.

#### 3. Dispersion Remains an Art Hack

**Current Approach:**
```wgsl
let disp = axis * P.dispersionScale * (0.7 + 8.0 * max(sigmaMain.x, sigmaMain.y));
let mainR = sampleSky(skyUV - disp, ...).r;
let mainG = sampleSky(skyUV, ...).g;
let mainB = sampleSky(skyUV + disp, ...).b;
```

**Why It's Wrong:**
- Not physically derived from real glass refraction
- Treats dispersion as 1D offset in color space
- Real dispersion produces **channel-specific outgoing directions**, not just color shifts

**Proper Fix:**
- Precompute **per-channel mean outgoing direction**, or
- Precompute **direction + Jacobian wrt refractive index** to derive RGB from physics

#### 4. No Verification / Test Harness

**Risk:**
Bruneton-style coordinate mapping is fragile. Off-by-one errors in UV transforms silently produce wrong but plausible-looking results.

**Required Tests:**
- Boundary distance functions (`distanceToTopBoundary`, `rayIntersectsGround`)
- Transmittance mapping round-trips
- Scattering coordinate mapping monotonicity
- Basic lookup sanity vs. reference implementation
- CPU-side validation of pack/unpack operations

---

## Important But Non-Blocking

### Irradiance Path (Missing)

**Current State:**
Interior reflections are a fake placeholder:
```wgsl
let reflection = interiorReflection((uv * 2.0 - 1.0));
```

**What's Missing:**
Bruneton's model includes irradiance lookup and `GetSunAndSkyIrradiance()` path for ground/surface lighting.

**Impact:**
- Sky is physically grounded
- Buildings/skyline remain artistically shaded
- Acceptable for bathroom-window demo, but not unified physical scene

**Status:** Important for quality, **not blocking for viability**.

---

## Acceptable Current Architectural Compromises

✅ **Clouds are layered separately from atmosphere** (not fully unified volumetric)
- Acceptable for this use case
- Bathroom-window images don't require volumetric cloud transport

✅ **f16 textures for storage / bandwidth**
- Keep atmosphere math in f32 for numerical stability
- f16 storage with automatic f32 expansion is fine

✅ **Sun disk still partly analytic**
- Current version multiplies sun by `s.transmittance`, which is a solid step
- Future improvement: full solar radiance + transmittance consistency
- Not blocking

---

## Practical Bottom Line

**The atmosphere side is now on a credible path.**

**The glass side has a foundational transport-domain bug.**

### v6 Is NOT Yet a Correct End-to-End Implementation

**Minimum fixes needed to make v6 viable:**

1. **Replace glass `shift.xy` with mean outgoing direction** (or target-domain sample coordinates)
2. **Fix composite pass to sample background in the correct domain**
3. **Implement the Bruneton LUT precompute path** (ozone, spectrum, luminance)
4. **Add minimal CPU/reference validation suite**

After those are done, the system becomes a serious prototype rather than a beautiful-but-misaligned blueprint.

---

## Development Roadmap

### Phase 1: Fix Glass Transport Domain (Critical)
```
Glass Precompute:
  - Change output from shift.xy → mean outgoing direction (oct-encoded)
  - Add direction Jacobian or per-channel directions for dispersion

Composite:
  - Use direction to correctly sample spherical background
  - Apply proper refraction-derived color transport
```

### Phase 2: Implement Atmosphere LUT Precompute (Required)
```
Precompute Pipeline:
  - Bruneton transmittance LUT generation
  - Multi-scattering LUT generation
  - Single-Mie texture generation
  - Proper 4D → 3D packing
```

### Phase 3: Add Validation (Critical for Confidence)
```
CPU Test Suite:
  - Boundary distance checks
  - Transmittance mapping validation
  - Scattering coordinate monotonicity
  - Reference implementation sanity checks
```

### Phase 4: Polish (Optional)
```
- Irradiance path for buildings
- Full volumetric cloud integration
- Advanced sun disk rendering
```

---

## References

- **Bruneton LUT Sampling:** https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html
- **Bruneton 2017 Full Paper:** https://ebruneton.github.io/precomputed_atmospheric_scattering/
- **WebGPU Spec:** https://gpuweb.github.io/gpuweb/
- **WGSL Spec:** https://gpuweb.github.io/gpuweb/wgsl/

---

## Key Insight

**Atmosphere lookup code ≠ Atmosphere system.**

We now have correct render-time lookup math, but that only works if:
1. LUTs are generated with matching assumptions
2. Glass outputs compatible transport representation
3. Composite applies it in the correct domain

Right now: lookup ✅, LUT generation ❌, glass transport ❌

Fix those three, and v6 becomes real.
