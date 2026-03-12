Yep — the right mental model is **not** “make a pretty gradient.” It’s:

**outdoor HDR radiance field → rough transmitting bathroom glass → temporal accumulation → tone mapping**

Those photos look good because the outside world is low-frequency and structured — sky, sunset band, silhouettes, horizon — while the glass contributes a stable high-frequency micro-relief that turns all of that into a soft, pebbled transmission pattern.

## 1. Start with pseudocode

### Top-level frame pipeline

```text
FRAME(time, camera, frameIndex):
    sunDir      = ComputeSunDirection(time, latitude, longitude)
    skyParams   = ComputeSkyParams(time, turbidity, ozone, exposure)

    skyline     = GenerateSkyline(seedSkyline)
    cloudLayers = GenerateCloudLayers(seedClouds)

    outdoorHDR  = BuildOutdoorRadianceField(
                    sunDir,
                    skyParams,
                    skyline,
                    cloudLayers)

    for each pixel p on window:
        L = 0
        for s = 1 .. spp:
            xi = STBN(p, frameIndex, s)

            (dirOut, Tg, F) = TraceThroughGlass(
                                cameraRay(p),
                                p,
                                xi,
                                glassParams)

            L += (1 - F) * Tg * SampleOutdoor(outdoorHDR, dirOut)
            L += F * SampleInteriorOrEnvReflection(cameraRay(p), xi)

        current[p] = L / spp

    accum   = TemporalAccumulate(prevAccum, current, motionData)
    display = ToneMap(accum, exposure, whitePoint)
    return display
```

### Outdoor radiance evaluation

```text
BuildOutdoorRadianceField(sunDir, skyParams, skyline, cloudLayers):
    return function SampleOutdoor(dir):
        if HitsSkyline(dir, skyline):
            xWorld   = ProjectDirectionToBackdrop(dir)
            shadow   = CloudShadowAt(xWorld, sunDir, cloudLayers)
            return ShadeBuildingsAndGround(xWorld, dir, sunDir, shadow)

        Lsky   = EvalSkyModel(dir, sunDir, skyParams) + SunDisk(dir, sunDir)
        Ttotal = 1
        Lcloud = 0

        for layer in cloudLayers from far to near:
            (Ti, Si) = MarchCloudLayer(dir, sunDir, layer)
            Lcloud  += Ttotal * Si
            Ttotal  *= Ti

        return Ttotal * Lsky + Lcloud
```

### Cloud marcher

```text
MarchCloudLayer(viewDir, sunDir, layer):
    (t0, t1) = IntersectLayerShell(viewDir, layer.altMin, layer.altMax)

    Tview = 1
    S     = 0
    t     = t0 + BlueNoiseOffset(pixel, frame) * ds

    while t < t1 and Tview > eps:
        x   = cameraPos + t * viewDir
        rho = CloudDensity(layer, x)

        if rho > 0:
            Tsun  = MarchToSun(x, sunDir, layer)
            phase = HG(dot(viewDir, sunDir), layer.g)

            S    += Tview * layer.sigmaS * rho * Tsun * phase * SunRadiance(sunDir) * ds
            Tview = Tview * exp(-layer.sigmaT * rho * ds)

        t += ds

    return (Tview, S)
```

### Glass transmission trace

```text
TraceThroughGlass(viewRay, pixel, xi, glass):
    p0 = IntersectFrontGlassSurface(viewRay)

    nFront = NormalFromHeight(glass.frontHeight, p0.xy)
    nFront = ApplySubpixelMicrofacet(nFront, xi, glass.subRoughness)

    w1 = Refract(-viewRay.dir, nFront, glass.etaAir / glass.etaGlass)

    dLocal = glass.thickness
           + SampleHeight(glass.backHeight,  p0.xy)
           - SampleHeight(glass.frontHeight, p0.xy)

    p1 = p0 + w1 * dLocal / max(abs(w1.z), eps)

    nBack = NormalFromHeight(glass.backHeight, p1.xy)
    nBack = ApplySubpixelMicrofacet(nBack, RotateSeed(xi), glass.subRoughness)

    w2 = Refract(w1, -nBack, glass.etaGlass / glass.etaAir)

    pathLen = dLocal / max(abs(w1.z), eps)
    Tg      = exp(-glass.sigmaA * pathLen)
    F       = FresnelSchlick(dot(-viewRay.dir, nFront), glass.etaAir, glass.etaGlass)

    return (w2, Tg, F)
```

That’s the core architecture I’d build.

---

## 2. The math that matters

### Equation 1 — Outdoor composition

Let the background radiance seen in direction ( \omega ) be

[
L_{\text{out}}(\omega)
======================

\chi_{\text{sky}}(\omega),L_{\text{atm+cloud}}(\omega)
+
\left(1-\chi_{\text{sky}}(\omega)\right),L_{\text{build}}(\omega)
]

where ( \chi_{\text{sky}} ) is a skyline / horizon visibility mask. A simple skyline mask is

[
\chi_{\text{sky}}(\phi,\theta)=H!\left(\theta-h_{\text{skyline}}(\phi)\right)
]

with azimuth ( \phi ), elevation ( \theta ), and a procedural skyline height function ( h_{\text{skyline}} ).

This is the big simplification: **because the glass heavily low-passes the outside world, the exterior can be much simpler than it first appears**.

### Equation 2 — Layered cloud density

For cloud layer ( i ),

[
\rho_i(\mathbf{x})
==================

q_i(z),
\mathrm{saturate}!\left(
\mathrm{remap}!\big(
f_{\text{fbm}}(\mathbf{x}/s_i)
+
\alpha_i f_{\text{worley}}(\mathbf{x}/s'_i),
c_i,1,0,1
\big)
\right)
]

* ( q_i(z) ): vertical profile of that cloud deck
* ( f_{\text{fbm}} ): broad shape
* ( f_{\text{worley}} ): breakup / cellular erosion
* ( c_i ): coverage threshold

This gives you high, mid, and low layers with different silhouettes and shadowing.

### Equation 3 — Beer-Lambert transmittance

[
T(a\rightarrow b)=
\exp!\left(
-\int_a^b \sigma_t ,\rho(\mathbf{x}(s)), ds
\right)
]

with extinction ( \sigma_t = \sigma_a + \sigma_s ). This is the core attenuation law for clouds, haze, and tinted glass. Scratchapixel’s volume rendering walkthrough uses exactly this attenuation structure for in-scattering and transmittance, and pbrt uses the same participating-media framing. ([Scratchapixel][1])

### Equation 4 — Single-scattering cloud radiance

[
L_{\text{cloud}}(\omega_v)
==========================

\int
T_v(t),
\sigma_s \rho(\mathbf{x}*t),
T*\odot(\mathbf{x}*t),
p(\mu),
L*\odot , dt
]

where ( \mu = \omega_v \cdot \omega_\odot ), and the usual phase function choice is Henyey-Greenstein:

[
p_{HG}(\mu, g)
==============

\frac{1-g^2}{4\pi(1+g^2-2g\mu)^{3/2}}
]

Use one ( g ) for a simple model, or a weighted sum of two HG lobes if you need richer forward/back scatter behavior. pbrt explicitly notes HG as the default phase function and mentions weighted sums for more complex fits. ([PBR Book][2])

### Equation 5 — Two-interface frosted slab

Model the glass as a slab with a front relief ( h_f(x,y) ) and back relief ( h_b(x,y) ).

Local normals:

[
\mathbf{n}_f = \frac{(-\partial_x h_f,,-\partial_y h_f,,1)}{|(-\partial_x h_f,,-\partial_y h_f,,1)|}
,\qquad
\mathbf{n}_b = \frac{(-\partial_x h_b,,-\partial_y h_b,,1)}{|(-\partial_x h_b,,-\partial_y h_b,,1)|}
]

Snell at entry and exit:

[
\omega_1 = \mathrm{refract}(-\omega_v,\mathbf{n}_f,\eta_a/\eta_g)
,\qquad
\omega_2 = \mathrm{refract}(\omega_1,-\mathbf{n}_b,\eta_g/\eta_a)
]

Local slab thickness:

[
d_{\text{local}} = d + h_b - h_f
]

Glass absorption:

[
T_g = e^{-\sigma_a \ell}
,\qquad
\ell \approx \frac{d_{\text{local}}}{|\omega_{1,z}|}
]

Final transmitted/reflected mix:

[
L_o = F(\theta),L_{\text{refl}} + \big(1-F(\theta)\big),T_g,L_{\text{out}}(\omega_2)
]

This is the part that makes the images look like **pebbled bathroom glass** instead of a generic blur. The rough-transmission literature is the right theoretical anchor here: Walter et al. extend microfacet theory to rough transmissive surfaces such as etched glass, compare against measured data, and note GGX can fit some surfaces better than Beckmann; pbrt’s rough dielectric chapter is the implementation-minded companion. Demofox’s Shadertoy path tracing write-up is also a nice practical reference for Fresnel, rough refraction, absorption, tone mapping, and exposure. ([Cornell Graphics][3])

---

## 3. Relevant ShaderToy / reference stack to mine

I couldn’t open every ShaderToy source directly from this environment, so treat these as **starting points to inspect locally**, not as me claiming I line-read each shader.

For sky baselines, the obvious anchors are **Preetham Sky** (`llSSDR`) and **Hosek-Wilkie Skylight Model** (`wslfD7`). Preetham’s classic daylight paper is the simple parametric baseline — location, time/date, atmospheric conditions, clear/overcast skies — while the Charles University sky-dome project provides the sample implementation for the Hosek/Wilkie line, and Bruneton’s 2017 implementation is the stronger “serious reference implementation” for precomputed atmospheric scattering with tests and fewer ad-hoc Earth-specific assumptions. GPU Gems chapter 16 is also useful if you want the full Nishita-style atmosphere with exponential density falloff instead of a lighter analytic sky. ([Shadertoy][4])

For cloud work, good anchors are **Clouds** (`XslGRr`), **Volumetric: Clouds** (`WcdSz2`), and **Sunset and moving clouds** (`NclGR8`); the last one is explicitly described as true volumetric sunset clouds with 3D raymarching and self-shadowing. Maxime Heckel’s volumetric cloud article is a very useful bridge between Shadertoy-style experimentation and production-minded thinking: it emphasizes constant-step volume marching, cites Frostbite/Horizon-style references, and discusses blue-noise dithering to hide undersampling artifacts. ([Shadertoy][5])

For glass, I’d split references into two bins. **Frosted Glass Shader** (`WdSGz1`) and **Supah frosted glass** (`7tyyDy`) are useful for distortion language and art direction. For actual physically based transmission, use Demofox’s Shadertoy path tracing series — especially the `ttfyzN` write-up on Fresnel, rough refraction, and absorption — and the newer **Path Traced Study: Glass & Chess** (`3fGyRR`) as the “solid PBR render” reference. ([Shadertoy][6])

---

## 4. Hypothesis space: four candidate pipelines

### Candidate A — 2D gradient + distortion blur

Render a painted HDR backdrop, then distort and blur it with a normal map.

This is fast, and it gets you 60% of the look, but it misses the **stable lenslet behavior** of real pebbled glass and won’t react correctly as the sun, cloud cover, or skyline change.

### Candidate B — Thin-sheet rough BTDF over a 2D environment

Use a rough dielectric transmission model, but sample a simple outdoor environment map.

This is already much better. It gives you proper refraction directions and Fresnel, but pure statistical roughness still tends to look too smooth.

### Candidate C — **Recommended**

**2.5D outdoor radiance field + volumetric clouds + skyline + explicit two-interface glass relief + stochastic accumulation**

This is the sweet spot. It preserves the fixed pebbled texture, gets real sunset/cloud behavior, and avoids wasting time on high-detail outdoor geometry that the glass will smear away anyway.

### Candidate D — Full path-traced outdoor scene + atmosphere + clouds + thick glass

This is the gold-standard brute-force version.

It is also probably overkill for this exact image family unless you want close-up caustic behavior, indoor interreflection, camera motion with parallax, or physically faithful twilight.

---

## 5. The key design decision

**Raymarch the clouds. Ray trace the glass.**

That’s the split I’d use.

Why:

* Clouds are genuinely volumetric density fields, so constant-step raymarching is the natural tool. That’s consistent with pbrt/Scratchapixel volume rendering and also with the practical cloud-writing guidance from Maxime Heckel’s article. ([Scratchapixel][7])
* The bathroom glass is better treated as a **thin but structured refractive slab**, where two explicit interfaces matter more than marching a solid volume. Walter/pbrt rough transmission is the theoretical anchor; explicit front/back height fields are the visual anchor. ([graphics.cornell.edu][8])

A pure microfacet BTDF is not enough by itself for this look. Real privacy glass has a **deterministic micro-relief field** that leaves a stationary texture on the image. So the best model is actually **two-scale**:

1. **Explicit relief height field** for the pebbled pattern
2. **Subpixel GGX-like micro-roughness** around that local normal for extra softening

That’s the combination that gives you both the stable texture and the physical spread.

---

## 6. Variations that are worth exploring

### Sky model choice

* **Preetham** for fastest prototype
* **Hosek-Wilkie** for a better analytic sky baseline
* **Bruneton** if you want the most robust physical backbone and LUT-based scalability ([CumInCAD][9])

### Cloud lighting choice

* **Short secondary sun march** for physical baseline
* **Directional-derivative / shortcut lighting** if you need speed
* **Beer-Powder** only as an art hack, not your reference physical model; even Maxime’s write-up calls out that it’s used for aesthetics rather than as a physically based baseline. ([Maxime Heckel Blog][10])

### Noise / sampling choice

Use **spatiotemporal blue noise** or filter-adapted spatiotemporal samples. EA’s STBN slides describe it as a drop-in replacement for traditional blue-noise masks and explicitly optimized to behave better than white noise over time; the 2024 follow-up explains why temporally adapted sampling improves convergence and temporal stability under filtering. ([EA Media][11])

### Buildings / horizon choice

* Static camera: 2D skyline occupancy map is enough
* Moving camera: extruded 3D boxes on a backdrop plane
* Since the glass destroys detail, spend your budget on **cloud shadow modulation and silhouette shape**, not on windows and façade modeling

---

## 7. Final recommended approach

If I were building the “bathroom window gradient maker,” I’d do this:

1. **Outdoor sky**

   * Start with **Hosek-Wilkie** or **Bruneton**
   * Put the sun low near the horizon
   * Raise turbidity / haze so the warm horizon band shows up strongly

2. **Clouds**

   * Use **2–3 altitude layers**
   * Raymarch them with Beer-Lambert transmittance and HG phase
   * Let them cast shadows onto the skyline / ground
   * Blue-noise jitter the ray start and accumulate over time

3. **Background geometry**

   * Use a **procedural skyline function** plus coarse ground band
   * Buildings are mainly silhouette carriers and shadow receivers
   * Keep them deliberately simple

4. **Glass**

   * Model the pane as a **two-interface relief slab**
   * Front/back height fields define the pebbled texture
   * Add optional subpixel GGX roughness around the local normals
   * Trace refracted rays through the slab and sample the outdoor HDR field

5. **Accumulation / display**

   * 4–8 stochastic samples per pixel to start
   * STBN + temporal accumulation
   * Tone map last, with slight bloom only if the sun band needs it

That gives you the visual feel of the photos **without** jumping straight into a monstrous full-scene stochastic renderer.

The short version of the strategy is:

**build a believable outdoor radiance field, then make the glass do the magic.**

If you want, the next step should be turning this into a concrete pass graph: exact buffers, which parts are full-res vs half-res, and what each shader stage inputs/outputs.

[1]: https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/intro-volume-rendering.html "https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/intro-volume-rendering.html"
[2]: https://pbr-book.org/4ed/Volume_Scattering/Phase_Functions "https://pbr-book.org/4ed/Volume_Scattering/Phase_Functions"
[3]: https://www.graphics.cornell.edu/~bjw/microfacetbsdf.pdf "https://www.graphics.cornell.edu/~bjw/microfacetbsdf.pdf"
[4]: https://www.shadertoy.com/view/llSSDR "https://www.shadertoy.com/view/llSSDR"
[5]: https://www.shadertoy.com/view/XslGRr "https://www.shadertoy.com/view/XslGRr"
[6]: https://www.shadertoy.com/view/WdSGz1 "https://www.shadertoy.com/view/WdSGz1"
[7]: https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/ray-marching-get-it-right.html "https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/ray-marching-get-it-right.html"
[8]: https://www.graphics.cornell.edu/~bjw/microfacetbsdf.pdf?utm_source=chatgpt.com "https://www.graphics.cornell.edu/~bjw/microfacetbsdf.pdf"
[9]: https://papers.cumincad.org/data/works/att/74bb.content.pdf "https://papers.cumincad.org/data/works/att/74bb.content.pdf"
[10]: https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/ "https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/"
[11]: https://media.contentapi.ea.com/content/dam/ea/seed/presentations/seed-egsr2022-blue-noise-masks-slides.pdf "https://media.contentapi.ea.com/content/dam/ea/seed/presentations/seed-egsr2022-blue-noise-masks-slides.pdf"

