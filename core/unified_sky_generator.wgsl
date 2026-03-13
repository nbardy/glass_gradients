// Unified Sky Generator — equirectangular compute shader
// Adapted from webgpu-unified-sun scene.wgsl for use as a BackgroundManager variant.
// Produces a 2:1 equirectangular environment map with physical atmospheric scattering,
// volumetric clouds, sun disk, configurable horizon/surface/overlay types.
//
// All variant dimensions from the original:
//   Horizon:  0=none, 1=city, 2=hills, 3=treeline
//   Surface:  0=sky-only, 1=water, 2=grass, 3=plaza/stone
//   Overlay:  0=none, 1=reeds, 2=foreground grass, 3=tree canopy

@group(0) @binding(0) var out_tex: texture_storage_2d<rgba16float, write>;

struct UnifiedSkyParams {
  resolution: vec2f,
  time: f32,
  sunIntensity: f32,

  sunDirX: f32,
  sunDirY: f32,
  sunDirZ: f32,
  rayleighStrength: f32,

  mieStrength: f32,
  turbidity: f32,
  hazeDensity: f32,
  cloudCoverage: f32,

  cloudScale: f32,
  cloudSpeed: f32,
  cloudHeight: f32,
  cloudThickness: f32,

  cloudEdge: f32,
  cloudDetail: f32,
  cloudShadowStrength: f32,
  horizonType: f32,

  surfaceType: f32,
  horizonDistance: f32,
  cityHeight: f32,
  cityDensity: f32,

  surfaceRoughness: f32,
  fogDensity: f32,
  sunVisible: f32,
  cloudTintR: f32,

  cloudTintG: f32,
  cloudTintB: f32,
  overlayType: f32,
  vegetationDensity: f32,

  foamAmount: f32,
  waterLevel: f32,
  groundLevel: f32,
  _pad0: f32,
}

@group(0) @binding(1) var<uniform> P: UnifiedSkyParams;

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958;
const FAR_PLANE: f32 = 220.0;
const TOP_ATMOSPHERE: f32 = 18.0;
const HR: f32 = 7.5;
const HM: f32 = 1.25;

// ─── Utilities ───────────────────────────────────────────────────────────────

fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn hash11(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453123); }

fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var amp = 0.5;
  var sum = 0.0;
  let rot = mat2x2f(1.6, -1.2, 1.2, 1.6);
  for (var i = 0; i < 5; i = i + 1) {
    sum = sum + amp * noise2(p);
    p = rot * p * 1.83;
    amp = amp * 0.52;
  }
  return sum;
}

fn ridgedFbm(p0: vec2f) -> f32 {
  var p = p0;
  var amp = 0.5;
  var sum = 0.0;
  let rot = mat2x2f(1.4, -1.0, 1.0, 1.4);
  for (var i = 0; i < 4; i = i + 1) {
    let n = noise2(p);
    sum = sum + amp * (1.0 - abs(2.0 * n - 1.0));
    p = rot * p * 2.05;
    amp = amp * 0.55;
  }
  return sum;
}

fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = saturate(dot(pa, ba) / max(dot(ba, ba), 1e-5));
  return length(pa - ba * h);
}

// ─── Atmospheric scattering ──────────────────────────────────────────────────

fn rayleighPhase(mu: f32) -> f32 {
  return 3.0 / (16.0 * PI) * (1.0 + mu * mu);
}

fn hgPhase(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5));
}

fn solarColor(sunDir: vec3f) -> vec3f {
  let airMass = 1.0 / max(0.04, sunDir.y + 0.08);
  let ext = exp(-vec3f(0.10, 0.23, 0.65) * airMass * P.turbidity * 0.55);
  let sunsetBlend = saturate(1.0 - sunDir.y * 1.8);
  let warmBoost = mix(vec3f(1.0), vec3f(1.25, 0.98, 0.72), sunsetBlend);
  return ext * warmBoost;
}

fn betaR() -> vec3f {
  return vec3f(0.030, 0.060, 0.120) * (0.5 + P.rayleighStrength);
}

fn betaM() -> vec3f {
  return vec3f(0.080, 0.080, 0.080) * (0.4 + P.mieStrength * 0.8 + P.turbidity * 0.04);
}

fn skyAmbientColor(rd: vec3f, sunDir: vec3f) -> vec3f {
  let t = saturate(rd.y * 0.5 + 0.5);
  let sunElev = saturate(sunDir.y * 0.5 + 0.5);
  let zenith = mix(vec3f(0.14, 0.28, 0.72), vec3f(0.10, 0.35, 0.90), sunElev);
  let horizonSunset = vec3f(1.10, 0.55, 0.28);
  let horizonDay = vec3f(0.70, 0.80, 0.95);
  let horizon = mix(horizonSunset, horizonDay, sunElev);
  let horizonCool = vec3f(0.20, 0.25, 0.34);
  let lowBand = mix(horizonCool, horizon, 0.72);
  let base = mix(lowBand, zenith, pow(t, 0.65));
  let hazeLift = mix(vec3f(0.0), horizon * 0.45, P.hazeDensity * (1.0 - pow(t, 1.5)));
  return base + hazeLift;
}

fn sunTransmittance(pos: vec3f, sunDir: vec3f) -> vec3f {
  var maxT = 70.0;
  if (sunDir.y > 0.02) { maxT = (TOP_ATMOSPHERE - pos.y) / sunDir.y; }
  maxT = clamp(maxT, 1.0, 90.0);
  let br = betaR();
  let bm = betaM();
  let dt = maxT / 5.0;
  var odR = 0.0;
  var odM = 0.0;
  for (var i = 0; i < 5; i = i + 1) {
    let t = (f32(i) + 0.5) * dt;
    let sp = pos + sunDir * t;
    let h = clamp(sp.y, 0.0, TOP_ATMOSPHERE);
    odR = odR + exp(-h / HR) * dt;
    odM = odM + exp(-h / HM) * dt;
  }
  return exp(-(br * odR + bm * odM));
}

fn integrateSky(ro: vec3f, rd: vec3f, sunDir: vec3f) -> vec3f {
  let br = betaR();
  let bm = betaM();
  let mu = dot(rd, sunDir);
  let pr = rayleighPhase(mu);
  let pm = hgPhase(mu, 0.78);

  var maxT = 80.0;
  if (rd.y > 0.01) {
    maxT = (TOP_ATMOSPHERE - ro.y) / rd.y;
  } else if (rd.y < -0.01) {
    maxT = (ro.y) / max(-rd.y, 0.01);
    maxT = min(maxT, 40.0);
  }
  maxT = clamp(maxT, 4.0, 90.0);

  let steps = 10;
  let dt = maxT / f32(steps);
  var optR = 0.0;
  var optM = 0.0;
  var sum = vec3f(0.0);
  for (var i = 0; i < steps; i = i + 1) {
    let t = (f32(i) + 0.5) * dt;
    let pos = ro + rd * t;
    let h = clamp(pos.y, 0.0, TOP_ATMOSPHERE);
    let dR = exp(-h / HR);
    let dM = exp(-h / HM);
    optR = optR + dR * dt;
    optM = optM + dM * dt;
    let transView = exp(-(br * optR + bm * optM));
    let transSun = sunTransmittance(pos, sunDir);
    let scatter = dR * br * pr + dM * bm * pm;
    sum = sum + transView * transSun * scatter * dt;
  }

  let baseAmbient = skyAmbientColor(rd, sunDir);
  let inscatter = sum * P.sunIntensity * 12.0;
  let ambientWeight = 0.18 + 0.30 * (1.0 - exp(-maxT * 0.02));
  return inscatter + baseAmbient * ambientWeight;
}

fn renderSkyApprox(rd: vec3f, sunDir: vec3f) -> vec3f {
  let zen = saturate(rd.y * 0.5 + 0.5);
  let base = mix(
    mix(vec3f(1.0, 0.52, 0.26), vec3f(0.72, 0.82, 0.95), saturate(sunDir.y * 1.4)),
    vec3f(0.12, 0.34, 0.90),
    pow(zen, 0.65)
  );
  let halo = solarColor(sunDir) * hgPhase(dot(rd, sunDir), 0.72) * P.sunIntensity * 3.0;
  return base * (0.35 + 0.65 * zen) + halo;
}

// ─── Clouds ──────────────────────────────────────────────────────────────────

fn cloudField(pWorld: vec2f) -> f32 {
  var p = pWorld * P.cloudScale;
  p = p + vec2f(P.time * P.cloudSpeed, P.time * P.cloudSpeed * 0.61);
  let warp = vec2f(fbm(p * 0.35 + vec2f(13.1, 2.7)), fbm(p * 0.35 - vec2f(5.2, 11.7)));
  p = p + (warp - 0.5) * 4.0;
  let billow = ridgedFbm(p);
  let detail = fbm(p * (2.0 + P.cloudDetail * 1.75) + vec2f(7.7, -4.3));
  let fine = ridgedFbm(p * 4.2 - vec2f(8.4, 1.2));
  var density = billow * 0.70 + detail * 0.30 + fine * 0.18;
  let threshold = 1.0 - P.cloudCoverage;
  density = smoothstep(threshold - P.cloudEdge, threshold + P.cloudEdge, density);
  density = density * P.cloudThickness;
  return saturate(density);
}

fn sampleCloud(ro: vec3f, rd: vec3f, sunDir: vec3f) -> vec4f {
  if (rd.y <= 0.015) { return vec4f(0.0); }
  let t = (P.cloudHeight - ro.y) / rd.y;
  if (t <= 0.0 || t > FAR_PLANE) { return vec4f(0.0); }

  let p = ro + rd * t;
  let density = cloudField(p.xz);
  if (density <= 0.002) { return vec4f(0.0); }

  let sunStep = 6.0 / max(0.15, abs(sunDir.y) + 0.12);
  let dSun = cloudField(p.xz + sunDir.xz * sunStep);
  let lighting = saturate(0.48 + (dSun - density) * 2.8 + sunDir.y * 0.30);
  let sunPhase = hgPhase(dot(rd, sunDir), 0.45);
  let sunsetMix = saturate(1.0 - sunDir.y * 1.4);

  let cloudTint = vec3f(P.cloudTintR, P.cloudTintG, P.cloudTintB);
  let litCloud = mix(vec3f(0.95, 0.97, 1.00), solarColor(sunDir) * cloudTint + vec3f(0.25), sunsetMix);
  let shadowCloud = mix(vec3f(0.32, 0.38, 0.52), vec3f(0.55, 0.62, 0.74), saturate(sunDir.y * 0.8 + 0.5));
  let ambient = skyAmbientColor(rd, sunDir) * 0.50 + vec3f(0.08, 0.10, 0.12);
  let edge = saturate((1.0 - density) * 1.4 + (lighting - 0.5) * 0.6);

  var color = mix(shadowCloud, litCloud, lighting);
  color = mix(ambient, color, 0.78);
  color = color + solarColor(sunDir) * edge * sunPhase * P.cloudShadowStrength * 1.2;
  return vec4f(color, density * 0.92);
}

fn cloudOcclusionForSun(ro: vec3f, sunDir: vec3f) -> f32 {
  if (sunDir.y <= 0.015) { return 1.0; }
  let t = (P.cloudHeight - ro.y) / sunDir.y;
  if (t <= 0.0 || t > FAR_PLANE) { return 1.0; }
  let p = ro + sunDir * t;
  return 1.0 - cloudField(p.xz) * 0.95;
}

// ─── Sun disk ────────────────────────────────────────────────────────────────

fn renderSun(rd: vec3f, sunDir: vec3f, occlusion: f32) -> vec3f {
  if (P.sunVisible < 0.5) { return vec3f(0.0); }
  let mu = clamp(dot(rd, sunDir), -1.0, 1.0);
  let theta = acos(mu);
  let diskRadius = mix(0.0048, 0.0105, saturate(1.0 - sunDir.y * 1.5));
  let disk = 1.0 - smoothstep(diskRadius, diskRadius * 1.35, theta);
  let glow = exp(-pow(theta / 0.045, 1.15));
  let corona = exp(-pow(theta / 0.22, 0.9));
  let solar = solarColor(sunDir) * P.sunIntensity;
  let strength = occlusion * P.sunVisible;
  return solar * strength * (disk * 25.0 + glow * 3.5 + corona * 0.18);
}

// ─── Horizon types ───────────────────────────────────────────────────────────

fn cityHorizon(phi: f32) -> f32 {
  let density = max(6.0, P.cityDensity);
  let u = phi / TAU * density + 2000.0;
  let cell = floor(u);
  let local = fract(u);
  let width = mix(0.25, 0.95, hash11(cell + 7.1));
  let tower = pow(hash11(cell + 2.3), 1.65) * P.cityHeight;
  let setback = tower * mix(0.5, 0.9, hash11(cell + 11.7));
  let antenna = tower + 0.012 * hash11(cell + 4.8);
  var height = 0.0;
  if (local < width) {
    height = tower;
    if (local > width * 0.22 && local < width * 0.80) { height = max(height, setback); }
    if (abs(local - width * 0.52) < 0.015) { height = max(height, antenna); }
  }
  return height;
}

fn hillsHorizon(phi: f32) -> f32 {
  let p = vec2f(phi * 1.7, 1.25);
  return 0.006 + ridgedFbm(p * 0.9) * 0.05 + fbm(p * 0.28) * 0.03;
}

fn treeLineHorizon(phi: f32) -> f32 {
  let p = vec2f(phi * 2.2, 4.4);
  return 0.010 + fbm(p * 0.8) * 0.02 + ridgedFbm(p * 3.4) * 0.018;
}

fn horizonSample(rd: vec3f, sunDir: vec3f) -> vec4f {
  let horizType = i32(P.horizonType + 0.5);
  if (horizType == 0) { return vec4f(0.0); }

  let horizLen = max(length(rd.xz), 1e-4);
  let tanElev = rd.y / horizLen;
  if (tanElev < -0.02) { return vec4f(0.0); }

  let phi = atan2(rd.x, rd.z);
  var occ = 0.0;
  var dist = P.horizonDistance;

  if (horizType == 1) {
    occ = cityHorizon(phi);
  } else if (horizType == 2) {
    occ = hillsHorizon(phi);
    dist = P.horizonDistance * 0.7;
  } else {
    occ = treeLineHorizon(phi);
    dist = P.horizonDistance * 0.45;
  }

  if (tanElev > occ) { return vec4f(0.0); }

  let haze = 1.0 - exp(-P.fogDensity * dist * 1.2);
  var color = vec3f(0.0);
  if (horizType == 1) {
    let local = fract(phi / TAU * max(6.0, P.cityDensity) + 2000.0);
    let rows = floor((occ - tanElev) * 160.0);
    let cols = floor(local * 40.0);
    let wSeed = rows * 13.0 + cols * 7.0 + floor(phi * 100.0);
    let windows = step(0.992, hash11(wSeed)) * (1.0 - haze) * smoothstep(0.0005, 0.015, occ - tanElev);
    color = mix(vec3f(0.02, 0.03, 0.05), vec3f(0.12, 0.16, 0.22), haze);
    color = color + vec3f(1.2, 0.85, 0.55) * windows * 0.35;
  } else if (horizType == 2) {
    color = mix(vec3f(0.05, 0.08, 0.10), vec3f(0.17, 0.22, 0.25), haze);
  } else {
    color = mix(vec3f(0.04, 0.06, 0.05), vec3f(0.10, 0.15, 0.12), haze);
  }

  return vec4f(color, 1.0);
}

// ─── Surface types ───────────────────────────────────────────────────────────

fn cloudShadowAtPoint(pWorld: vec2f, sunDir: vec3f) -> f32 {
  if (sunDir.y <= 0.01) { return 1.0; }
  let travel = (P.cloudHeight - P.groundLevel) / max(0.12, sunDir.y);
  let shadowDensity = cloudField(pWorld + sunDir.xz * travel);
  return 1.0 - shadowDensity * 0.45;
}

fn grassNormal(p: vec2f) -> vec3f {
  let e = 0.22;
  let h = fbm(p * 0.35);
  let hx = fbm((p + vec2f(e, 0.0)) * 0.35);
  let hz = fbm((p + vec2f(0.0, e)) * 0.35);
  return normalize(vec3f((h - hx) * 1.8, 1.0, (h - hz) * 1.8));
}

fn shadeGrass(p: vec3f, ro: vec3f, sunDir: vec3f) -> vec3f {
  let n = grassNormal(p.xz);
  let v = normalize(ro - p);
  let sunColor = solarColor(sunDir) * P.sunIntensity;
  let shadow = cloudShadowAtPoint(p.xz, sunDir);
  let hue = fbm(p.xz * 0.18);
  let stripe = ridgedFbm(p.xz * 1.4);
  let albedo = mix(vec3f(0.10, 0.28, 0.07), vec3f(0.34, 0.64, 0.16), saturate(0.25 + 0.9 * hue));
  let ndotl = max(dot(n, sunDir), 0.0);
  let back = pow(max(dot(-n, sunDir), 0.0), 1.4) * pow(1.0 - max(dot(n, v), 0.0), 1.25);
  let skyFill = skyAmbientColor(n, sunDir) * 0.18;
  var color = albedo * (skyFill + sunColor * ndotl * shadow * 0.65);
  color = color + albedo * sunColor * back * 0.35;
  color = color + vec3f(0.02, 0.05, 0.01) * stripe * 0.12;
  let distanceFade = exp(-length(p.xz) * 0.01);
  color = mix(color * 0.85, color, distanceFade);
  return color;
}

fn waveHeight(p: vec2f) -> f32 {
  let t = P.time;
  let a = sin(p.x * 0.11 + t * 0.75) * 0.12;
  let b = sin(p.y * 0.17 - t * 0.62) * 0.09;
  let c = sin((p.x + p.y) * 0.07 + t * 0.38) * 0.07;
  let d = fbm(p * 0.14 + vec2f(t * 0.03, -t * 0.02)) * 0.10;
  return a + b + c + d;
}

fn waterNormal(p: vec2f) -> vec3f {
  let e = 0.12;
  let h = waveHeight(p);
  let hx = waveHeight(p + vec2f(e, 0.0));
  let hz = waveHeight(p + vec2f(0.0, e));
  return normalize(vec3f((h - hx) / e * 1.4, 1.0, (h - hz) / e * 1.4));
}

fn shadeWater(p: vec3f, ro: vec3f, rd: vec3f, sunDir: vec3f) -> vec3f {
  let n = waterNormal(p.xz);
  let v = normalize(ro - p);
  let r = reflect(rd, n);
  let skyRef = renderSkyApprox(normalize(vec3f(r.x, abs(r.y), r.z)), sunDir);
  let sunColor = solarColor(sunDir) * P.sunIntensity;
  let f0 = vec3f(0.02);
  let f = f0 + (vec3f(1.0) - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  let shadow = cloudShadowAtPoint(p.xz, sunDir);

  let specTightness = mix(250.0, 800.0, 1.0 - P.surfaceRoughness);
  let sunSpec = pow(max(dot(reflect(-sunDir, n), v), 0.0), specTightness) * shadow;
  let sparkle = pow(max(dot(r, sunDir), 0.0), 180.0) * 2.0;

  var foam = 0.0;
  let wave = abs(waveHeight(p.xz * 1.2));
  foam = smoothstep(0.18, 0.30, wave) * P.foamAmount;
  foam = foam + smoothstep(0.0, 14.0, 14.0 - length(p.xz)) * 0.2 * P.foamAmount;
  foam = saturate(foam);

  let deepColor = mix(vec3f(0.02, 0.05, 0.07), vec3f(0.06, 0.12, 0.16), saturate(1.0 - exp(-length(p.xz) * 0.03)));
  var color = mix(deepColor, skyRef, f);
  color = color + sunColor * (sunSpec * 14.0 + sparkle * 1.5) * f;
  color = mix(color, vec3f(0.92, 0.95, 0.98), foam * 0.55);
  color = color * shadow;
  color = color + deepColor * 0.15;
  return color;
}

// ─── Plaza / stone surface ───────────────────────────────────────────────────

fn plazaNormal(p: vec2f) -> vec3f {
  let cell = fract(p * 0.23);
  let seamX = smoothstep(0.46, 0.50, abs(cell.x - 0.5));
  let seamY = smoothstep(0.46, 0.50, abs(cell.y - 0.5));
  let bump = (seamX + seamY) * 0.06;
  let h = fbm(p * 0.10) * 0.04 + bump;
  let e = 0.12;
  let hx = fbm((p + vec2f(e, 0.0)) * 0.10) * 0.04 + (smoothstep(0.46, 0.50, abs(fract((p.x + e) * 0.23) - 0.5)) + seamY) * 0.06;
  let hz = fbm((p + vec2f(0.0, e)) * 0.10) * 0.04 + (seamX + smoothstep(0.46, 0.50, abs(fract((p.y + e) * 0.23) - 0.5))) * 0.06;
  return normalize(vec3f((h - hx) * 2.0, 1.0, (h - hz) * 2.0));
}

fn treeShadowField(p: vec2f) -> f32 {
  let n = fbm(p * 0.08 + vec2f(P.time * 0.015, 3.7));
  return smoothstep(0.48, 0.72, n);
}

fn shadePlaza(p: vec3f, ro: vec3f, sunDir: vec3f) -> vec3f {
  let n = plazaNormal(p.xz);
  let v = normalize(ro - p);
  let rough = clamp(P.surfaceRoughness, 0.05, 1.0);
  let ndotl = max(dot(n, sunDir), 0.0);
  let ndotv = max(dot(n, v), 0.0);
  let retro = pow(1.0 - max(dot(v, sunDir), 0.0), 2.0) * rough;

  let tileNoise = fbm(p.xz * 0.05);
  let base = mix(vec3f(0.50, 0.50, 0.48), vec3f(0.72, 0.72, 0.68), tileNoise);
  let shadowCloud = cloudShadowAtPoint(p.xz, sunDir);
  let shadowLeaves = mix(1.0, 0.45, treeShadowField(p.xz + sunDir.xz * 6.0));
  let shadow = shadowCloud * shadowLeaves;

  let sunColor = solarColor(sunDir) * P.sunIntensity;
  let diffuse = base * (0.12 + ndotl * shadow * (0.55 + 0.25 * retro));
  let skyFill = skyAmbientColor(n, sunDir) * 0.14;
  let warmScatter = base * sunColor * pow(1.0 - ndotv, 1.3) * 0.08 * rough;
  let seam = smoothstep(0.46, 0.50, abs(fract(p.x * 0.23) - 0.5)) + smoothstep(0.46, 0.50, abs(fract(p.z * 0.23) - 0.5));

  var color = diffuse * sunColor + base * skyFill + warmScatter;
  color = color - seam * 0.04;
  return max(color, vec3f(0.0));
}

// ─── Aerial perspective ──────────────────────────────────────────────────────

fn applyAerialPerspective(color: vec3f, dist: f32, rd: vec3f, sunDir: vec3f) -> vec3f {
  let fog = 1.0 - exp(-P.fogDensity * dist * (0.60 + 0.40 * (1.0 - rd.y)));
  let fogColor = renderSkyApprox(normalize(vec3f(rd.x, max(rd.y, 0.05), rd.z)), sunDir);
  return mix(color, fogColor, saturate(fog));
}

// ─── Foreground overlays (adapted for equirectangular) ───────────────────────
// In equirect, overlays map to the lower hemisphere (reeds/grass) or upper (canopy).
// uv.x = azimuth (phi/TAU), uv.y = elevation from ground (0 at horizon, up into scene).

fn renderForegroundReeds(uv: vec2f, sunDir: vec3f) -> vec4f {
  let density = mix(70.0, 170.0, saturate(P.vegetationDensity));
  let x = uv.x * density;
  let wind = sin(P.time * 0.8 + uv.x * 17.0) * 0.025;
  var alpha = 0.0;

  for (var i = -2; i <= 2; i = i + 1) {
    let cell = floor(x) + f32(i);
    let seed = cell + 41.7;
    let rootX = (cell + hash11(seed)) / density;
    let height = 0.12 + 0.42 * pow(hash11(seed + 1.3), 1.2) * (0.65 + P.vegetationDensity * 0.8);
    let bend = (hash11(seed + 2.4) - 0.5) * 0.10 + wind * (0.5 + 0.8 * hash11(seed + 5.1));
    let w = mix(0.0014, 0.0045, hash11(seed + 3.8));
    let tip = vec2f(rootX + bend, height);
    let dist = sdSegment(uv, vec2f(rootX, 0.0), tip);
    let taper = mix(1.0, 0.18, saturate(uv.y / max(height, 1e-4)));
    let blade = 1.0 - smoothstep(0.0, w * taper + 0.0015, dist);
    alpha = max(alpha, blade);
  }

  let rim = pow(max(dot(normalize(vec3f(0.0, 1.0, 0.15)), sunDir), 0.0), 2.0);
  let base = mix(vec3f(0.02, 0.015, 0.01), vec3f(0.09, 0.08, 0.05), rim * 0.35);
  return vec4f(base, alpha * smoothstep(0.0, 0.6, 0.6 - uv.y));
}

fn renderForegroundGrass(uv: vec2f, sunDir: vec3f) -> vec4f {
  let density = mix(60.0, 180.0, saturate(P.vegetationDensity));
  let x = uv.x * density;
  let wind = sin(P.time * 0.55 + uv.x * 10.0) * 0.015;
  var alpha = 0.0;

  for (var i = -2; i <= 2; i = i + 1) {
    let cell = floor(x) + f32(i);
    let seed = cell + 71.4;
    let rootX = (cell + hash11(seed)) / density;
    let height = 0.06 + 0.18 * hash11(seed + 1.1) * (0.6 + P.vegetationDensity);
    let bend = (hash11(seed + 2.6) - 0.5) * 0.05 + wind;
    let w = mix(0.0015, 0.0035, hash11(seed + 3.9));
    let tip = vec2f(rootX + bend, height);
    let dist = sdSegment(uv, vec2f(rootX, 0.0), tip);
    let taper = mix(1.0, 0.25, saturate(uv.y / max(height, 1e-4)));
    let blade = 1.0 - smoothstep(0.0, w * taper + 0.0012, dist);
    alpha = max(alpha, blade);
  }

  let back = pow(max(dot(normalize(vec3f(0.0, 1.0, 0.0)), sunDir), 0.0), 0.5);
  let color = mix(vec3f(0.05, 0.16, 0.03), vec3f(0.28, 0.46, 0.08), back);
  return vec4f(color, alpha * smoothstep(0.0, 0.35, 0.30 - uv.y));
}

fn renderForegroundCanopy(uv: vec2f, sunDir: vec3f) -> vec4f {
  let topMask = smoothstep(0.35, 0.95, uv.y);
  let sideMask = smoothstep(0.0, 0.22, uv.x) + smoothstep(1.0, 0.78, uv.x);
  let n = fbm(vec2f(uv.x * 6.0, uv.y * 5.0 + P.time * 0.01)) * 0.8 +
          ridgedFbm(vec2f(uv.x * 12.0, uv.y * 9.0 - P.time * 0.02)) * 0.5;
  let alpha = saturate(smoothstep(0.64, 1.04, n + topMask * 0.55 + sideMask * 0.25));
  let rim = pow(max(dot(normalize(vec3f(0.0, -0.2, 1.0)), sunDir), 0.0), 1.5);
  let color = mix(vec3f(0.05, 0.08, 0.04), vec3f(0.16, 0.20, 0.08), rim * 0.55);
  return vec4f(color, alpha);
}

fn overlaySample(rd: vec3f, equirectUV: vec2f, sunDir: vec3f) -> vec4f {
  let overlayType = i32(P.overlayType + 0.5);
  if (overlayType == 0) { return vec4f(0.0); }

  // For bottom overlays (reeds, grass): map lower hemisphere to overlay UV
  // For top overlay (canopy): map upper hemisphere
  if (overlayType == 1 || overlayType == 2) {
    // Reeds / grass appear when looking downward (rd.y < 0)
    // Map -rd.y from 0..1 to overlay uv.y 0..0.6
    if (rd.y >= 0.0) { return vec4f(0.0); }
    let overlayUV = vec2f(equirectUV.x, -rd.y * 0.8);
    if (overlayType == 1) { return renderForegroundReeds(overlayUV, sunDir); }
    return renderForegroundGrass(overlayUV, sunDir);
  }

  // Canopy appears when looking upward
  if (overlayType == 3) {
    // Map rd.y from 0..1 to uv.y 0..1 (higher = more canopy)
    let overlayUV = vec2f(equirectUV.x, saturate(rd.y));
    return renderForegroundCanopy(overlayUV, sunDir);
  }

  return vec4f(0.0);
}

// ─── Main scene compositor ───────────────────────────────────────────────────

fn renderScene(rd: vec3f, equirectUV: vec2f) -> vec3f {
  let sunDir = normalize(vec3f(P.sunDirX, P.sunDirY, P.sunDirZ));
  let ro = vec3f(0.0, 3.0, 0.0);

  // Sky (physical scattering)
  var color = integrateSky(ro, rd, sunDir);

  // Clouds
  let clouds = sampleCloud(ro, rd, sunDir);
  color = mix(color, clouds.xyz, clouds.w);

  // Sun disk
  let sunOcc = cloudOcclusionForSun(ro, sunDir);
  color = color + renderSun(rd, sunDir, sunOcc);

  var bestT = FAR_PLANE;

  // Surface (ground plane)
  let surfType = i32(P.surfaceType + 0.5);
  if (rd.y < -0.001 && surfType > 0) {
    var planeY = P.groundLevel;
    if (surfType == 1) { planeY = P.waterLevel; }
    let tPlane = (planeY - ro.y) / rd.y;
    if (tPlane > 0.0 && tPlane < bestT) {
      let p = ro + rd * tPlane;
      if (surfType == 1) {
        color = shadeWater(p, ro, rd, sunDir);
      } else if (surfType == 2) {
        color = shadeGrass(p, ro, sunDir);
      } else if (surfType == 3) {
        color = shadePlaza(p, ro, sunDir);
      }
      color = applyAerialPerspective(color, tPlane, rd, sunDir);
      bestT = tPlane;
    }
  }

  // Horizon silhouettes
  let horizon = horizonSample(rd, sunDir);
  if (horizon.w > 0.5 && P.horizonDistance < bestT) {
    color = applyAerialPerspective(horizon.xyz, P.horizonDistance, rd, sunDir);
    bestT = P.horizonDistance;
  }

  // Foreground overlays
  let overlay = overlaySample(rd, equirectUV, sunDir);
  if (overlay.w > 0.001) {
    color = mix(color, overlay.xyz, overlay.w);
  }

  return max(color, vec3f(0.0));
}

// ─── Compute entry point: equirectangular output ─────────────────────────────

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (f32(gid.x) >= P.resolution.x || f32(gid.y) >= P.resolution.y) { return; }

  let u = (f32(gid.x) + 0.5) / P.resolution.x;
  let v = (f32(gid.y) + 0.5) / P.resolution.y;

  // Equirectangular: u → phi (0..2π), v → theta (π..0, top-to-bottom)
  let phi = u * TAU;
  let theta = PI * (1.0 - v);

  let x = sin(theta) * cos(phi);
  let y = cos(theta);
  let z = sin(theta) * sin(phi);
  let rd = vec3f(x, y, z);

  let color = renderScene(rd, vec2f(u, v));
  textureStore(out_tex, vec2<i32>(gid.xy), vec4f(color, 1.0));
}
