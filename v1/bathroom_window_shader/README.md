# Bathroom Window Gradient Maker — Shadertoy Prototype

This is a first-pass shader implementation of the “bathroom window gradient maker” pipeline.

## Pass setup

### Common
Paste `common.glsl` into the **Common** tab.

### Buffer A
Paste `buffer_a.glsl` into **Buffer A**.

Set `iChannel0` of **Buffer A** to **Buffer A** itself.
This gives you temporal accumulation feedback.

### Image
Paste `image.glsl` into the **Image** tab.

Set `iChannel0` of **Image** to **Buffer A**.

## What this prototype already does

- analytic sunset sky
- 3 procedural cloud decks with single-scattering style raymarching
- coarse skyline / building occlusion and horizon band
- frosted bathroom glass as a two-interface refractive slab
- subpixel rough transmission jitter
- temporal accumulation

## What to tweak first

In `common.glsl`:

- `SUN_AZIMUTH`
- `SUN_ELEVATION`
- `SCENE_STATIC`
- `SAMPLES_PER_FRAME`
- `CLOUD_STEPS`
- `SUN_SHADOW_STEPS`
- `GLASS_BUMP`
- `GLASS_THICKNESS`

## Good defaults

- leave `SCENE_STATIC = 1` while tuning the look
- increase `SAMPLES_PER_FRAME` from 2 to 4 if your GPU is comfortable
- if you want more dramatic orange / purple sunsets, lower `SUN_ELEVATION`
- if you want denser privacy glass, raise `GLASS_BUMP` a bit and increase the high-frequency term in the height field

## Notes

This is intentionally the “candidate C” architecture:

outdoor radiance field + volumetric-ish clouds + skyline + explicit frosted glass transmission.

It is not a full unbiased path tracer, but it is organized so you can replace parts incrementally:

- swap analytic sky for Preetham / Hosek-Wilkie / Bruneton
- replace cloud lighting with a better multi-scatter approximation
- swap the procedural glass height field for a scanned normal / height map
- replace the simple micro-normal perturbation with proper GGX VNDF rough transmission
