# Bathroom Glass Rendering v2

## Overview

This is the **hybrid physical + pragmatic** approach to rendering privacy glass for bathroom windows. The core idea is **scale separation**: keep the low-frequency optics deterministic and physically motivated, and handle unresolved high-frequency detail via local slope covariance and a practical halo compensation term.

## Mathematical Foundation

The rendering equation treats background radiance filtered through a spatially-varying transmission operator:

```
O_c(u) = F_c(u) * R_c(u) + (1 - F_c(u)) * ∫ K_{u,c}(Δ) * B_c(u+Δ) dΔ
```

Where:
- **F_c(u)** = Fresnel reflection
- **R_c(u)** = Reflected environment
- **B_c(ω)** = Background HDR panorama
- **K_{u,c}(Δ)** = Local transmission PSF (kernel)

## Components

### 1. **background.glsl**
Low-frequency HDR background panorama with:
- Sky model (Hošek–Wilkie or Bruneton-baked)
- Sun disk and cloud layers
- Procedural skyline
- Warm horizon band
- Built as mip pyramid for efficient filtering

### 2. **glass-assets.glsl**
Glass surface generation:
- Master height field (pebble pattern)
- Low-frequency/high-frequency split (scale separation)
- Normal maps from low-frequency relief
- Slope covariance from high-frequency relief
- Front and back surface decomposition

### 3. **Variant 1: Deterministic Distortion** (`variant1-deterministic-distortion.glsl`)
**Cheapest version:**
- Single Gaussian PSF per pixel
- Mean shift from local slope
- Blur from slope covariance
- Mip-pyramid background sampling
- RGB dispersion via channel-separated mean shift
- **Use when:** Performance is critical, visual accuracy is secondary

### 4. **Variant 2: Anisotropic Kernel** (`variant2-anisotropic-kernel.glsl`)
**Best visual match:**
- Two-lobe kernel mixture (main + halo)
- Anisotropic PSF from structure tensor
- Captures "lenslet band" structure
- Halo compensates for internal multi-bounce energy
- **Use when:** Target is photorealistic appearance matching references

### 5. **Variant 3: Physical Slab** (`variant3-physical-slab.glsl`)
**Most physically grounded:**
- Actual ray-slab intersection geometry
- Refraction through front/back surfaces
- Total internal reflection (TIR) handling
- Wavelength-dependent refractive index (dispersion)
- Internal bounce simulation
- Path-length absorption
- **Use when:** Precise physical accuracy matters; slower but most correct

### 6. **Final Hybrid** (`final-hybrid.glsl`)
**Recommended production version:**
Combines:
- Reduced-order physical slab (LF relief optics)
- Local anisotropic blur (HF relief covariance)
- Halo compensation (multi-bounce energy)
- RGB dispersion
- Deterministic ellipse sampling
- Efficient mip-pyramid filtering

**Why this wins:**
- Stable "pebbled lenslet" structure (real physics)
- Wide soft gradients (practical halo)
- Believable chromatic separation
- Realtime-friendly (no volumetric marching)
- Physically motivated but pragmatic

## Scale Separation Strategy

Glass is decomposed as:
```
h_f = h_f^{LF} + h_f^{HF}    (front surface)
h_b = h_b^{LF} + h_b^{HF}    (back surface)
```

- **LF (Low-Frequency):** Resolved lenslet/pebble structure → deterministic refraction
- **HF (High-Frequency):** Unresolved micro-relief → encoded as slope covariance → becomes blur

## Key Parameters

| Parameter | Role | Typical Range |
|-----------|------|---------------|
| `eta[c]` | Refractive index by channel | 1.45–1.55 (glass) |
| `sigmaA[c]` | Absorption coefficient | 0.0–0.1 |
| `ampFront` / `ampBack` | Surface roughness amplitude | 0.01–0.1 |
| `corr` | Front-back correlation | 0.0–1.0 |
| `beta` | Halo width multiplier | 2.0–4.0 |
| `sigmaHalo` | Halo base blur | 0.5–2.0 pixels |
| `wHalo` | Halo contribution weight | 0.1–0.3 |

## Dispersion

RGB dispersion is handled via:
1. Channel-separated refractive indices (Sellmeier or RGB triplet)
2. Per-channel mean shift: `μ_c` differs for R, G, B
3. Separate background samples at shifted coordinates

## When NOT to Use This

- **Volumetric clouds behind the glass:** Use the background HDR approach instead; true cloud volumetrics add little value behind a diffuser.
- **Real-time ray-traced glass slab:** The reduced-order slab is good enough; full path tracing is overkill.
- **Temporal denoising (STBN):** Only needed if using stochastic sampling. Deterministic taps are stable without it.

## Next Steps

1. Implement `BuildBackgroundHDR()` to author the panorama
2. Implement `GenerateGlassAssets()` for surface generation
3. Start with **Variant 2** (anisotropic kernel) for visual match
4. Optionally upgrade to **Final Hybrid** for stability and physics grounding
5. Tune parameters for your specific bathroom aesthetic

## References

- **Atmospheric scattering:** Bruneton et al., [Precomputed Atmospheric Scattering](https://ebruneton.github.io/precomputed_atmospheric_scattering/)
- **Sky model:** Hošek & Wilkie, [An Analytic Model for Full Spectral Sky-Dome Radiance](https://cgg.mff.cuni.cz/projects/SkylightModelling/)
- **Rough dielectrics:** Walter et al., pbrt [rough transmission](https://www.pbrt.org/)
- **Multiple-scattering microfacets:** Dreggn, [Multiple-Scattering Microfacet BSDFs with the Smith Model](https://jo.dreggn.org/home/2016_microfacets.pdf)
- **Dispersion:** RP Photonics, [Abbe Number](https://www.rp-photonics.com/abbe_number.html) and Sellmeier equations
- **Temporal filtering:** Georgiev & Fajardo, [Spatiotemporal Blue Noise Masks](https://diglib.eg.org/items/a96087bb-abe8-4851-968c-cccc7f17e08c)
