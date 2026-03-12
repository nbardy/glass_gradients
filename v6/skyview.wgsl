// skyview.wgsl — Bruneton-style atmosphere with real LUT path
// This is the render-time half: the precompute side is separate.
// See CORRECTIONS.md for the critical architectural notes.

alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

const PI : f32 = 3.141592653589793;
const EPS: f32 = 1e-6;

struct AtmosphereParams {
  // Planet params (in consistent units, e.g. km)
  bottomRadius      : f32,
  topRadius         : f32,
  muSMin            : f32,
  sunAngularRadius  : f32,

  mieG              : f32,
  cameraHeight      : f32,
  time              : f32,
  _pad0             : f32,

  sunDir            : vec3f,
  _pad1             : f32,

  transmittanceSize : vec2<u32>,
  _pad2             : vec2<u32>,

  // scatteringSize = (nu, mu_s, mu, r)
  scatteringSize    : vec4<u32>,

  // Sky-space rendering
  skySize           : vec2<u32>,
};

struct ScatterLookup {
  scatter   : vec3f,
  singleMie : vec3f,
};

struct SkyLookup {
  radiance      : vec3f,
  transmittance : vec3f,
};

@group(0) @binding(0) var linearSampler   : sampler;
@group(0) @binding(1) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(2) var scatteringTex   : texture_3d<f32>;
@group(0) @binding(3) var singleMieTex    : texture_3d<f32>;
@group(0) @binding(4) var outSky          : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> A      : AtmosphereParams;

// ============================================================================
// Core Bruneton render-time path
// ============================================================================

fn safeSqrt(x: f32) -> f32 {
  return sqrt(max(x, 0.0));
}

fn clampRadius(r: f32) -> f32 {
  return clamp(r, A.bottomRadius, A.topRadius);
}

fn clampCosine(x: f32) -> f32 {
  return clamp(x, -1.0, 1.0);
}

fn texcoordFromUnitRange(x: f32, texels: f32) -> f32 {
  return 0.5 / texels + x * (1.0 - 1.0 / texels);
}

fn distanceToTopBoundary(r: f32, mu: f32) -> f32 {
  let disc = r * r * (mu * mu - 1.0) + A.topRadius * A.topRadius;
  return max(-r * mu + safeSqrt(disc), 0.0);
}

fn distanceToBottomBoundary(r: f32, mu: f32) -> f32 {
  let disc = r * r * (mu * mu - 1.0) + A.bottomRadius * A.bottomRadius;
  return max(-r * mu - safeSqrt(disc), 0.0);
}

fn rayIntersectsGround(r: f32, mu: f32) -> bool {
  let disc = r * r * (mu * mu - 1.0) + A.bottomRadius * A.bottomRadius;
  return (mu < 0.0) && (disc >= 0.0);
}

fn rayleighPhase(nu: f32) -> f32 {
  return 3.0 / (16.0 * PI) * (1.0 + nu * nu);
}

fn miePhase(g: f32, nu: f32) -> f32 {
  let g2 = g * g;
  let k  = 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2);
  let d  = max(1.0 + g2 - 2.0 * g * nu, EPS);
  return k * (1.0 + nu * nu) / pow(d, 1.5);
}

fn transmittanceUvFromRMu(r: f32, mu: f32) -> vec2f {
  let H   = safeSqrt(A.topRadius * A.topRadius - A.bottomRadius * A.bottomRadius);
  let rho = safeSqrt(r * r - A.bottomRadius * A.bottomRadius);

  let d     = distanceToTopBoundary(r, mu);
  let dMin  = A.topRadius - r;
  let dMax  = rho + H;

  let xMu = (d - dMin) / max(dMax - dMin, EPS);
  let xR  = rho / max(H, EPS);

  return vec2f(
    texcoordFromUnitRange(clamp(xMu, 0.0, 1.0), f32(A.transmittanceSize.x)),
    texcoordFromUnitRange(clamp(xR,  0.0, 1.0), f32(A.transmittanceSize.y))
  );
}

fn transmittanceToTop(r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(
    transmittanceTex,
    linearSampler,
    transmittanceUvFromRMu(r, mu),
    0.0
  ).rgb;
}

fn transmittanceSegment(r: f32, mu: f32, d: f32, hitsGround: bool) -> vec3f {
  let rd  = clampRadius(safeSqrt(d * d + 2.0 * r * mu * d + r * r));
  let mud = clampCosine((r * mu + d) / max(rd, EPS));

  if (hitsGround) {
    return min(
      transmittanceToTop(rd, -mud) / max(transmittanceToTop(r, -mu), vec3f(EPS)),
      vec3f(1.0)
    );
  }

  return min(
    transmittanceToTop(r, mu) / max(transmittanceToTop(rd, mud), vec3f(EPS)),
    vec3f(1.0)
  );
}

fn transmittanceToSun(r: f32, muS: f32) -> vec3f {
  let sinThetaH = A.bottomRadius / r;
  let cosThetaH = -safeSqrt(max(1.0 - sinThetaH * sinThetaH, 0.0));

  let visibleFraction = smoothstep(
    -sinThetaH * A.sunAngularRadius,
     sinThetaH * A.sunAngularRadius,
     muS - cosThetaH
  );

  return transmittanceToTop(r, muS) * visibleFraction;
}

fn scatteringUvwzFromRMuMuSNu(
  r: f32,
  mu: f32,
  muS: f32,
  nu: f32,
  hitsGround: bool
) -> vec4f {
  let H   = safeSqrt(A.topRadius * A.topRadius - A.bottomRadius * A.bottomRadius);
  let rho = safeSqrt(r * r - A.bottomRadius * A.bottomRadius);

  let uR = texcoordFromUnitRange(rho / max(H, EPS), f32(A.scatteringSize.w));

  let rmu  = r * mu;
  let disc = rmu * rmu - r * r + A.bottomRadius * A.bottomRadius;

  let halfMuTexels = 0.5 * f32(A.scatteringSize.z);
  var uMu = 0.0;

  if (hitsGround) {
    let d    = -rmu - safeSqrt(disc);
    let dMin = r - A.bottomRadius;
    let dMax = rho;
    let denom = dMax - dMin;
    let x = select(0.0, (d - dMin) / max(denom, EPS), denom > EPS);
    uMu = 0.5 - 0.5 * texcoordFromUnitRange(clamp(x, 0.0, 1.0), halfMuTexels);
  } else {
    let d    = -rmu + safeSqrt(disc + H * H);
    let dMin = A.topRadius - r;
    let dMax = rho + H;
    let x    = (d - dMin) / max(dMax - dMin, EPS);
    uMu = 0.5 + 0.5 * texcoordFromUnitRange(clamp(x, 0.0, 1.0), halfMuTexels);
  }

  let dSun   = distanceToTopBoundary(A.bottomRadius, muS);
  let dMinS  = A.topRadius - A.bottomRadius;
  let dMaxS  = H;
  let a      = (dSun - dMinS) / max(dMaxS - dMinS, EPS);

  let dLimit = distanceToTopBoundary(A.bottomRadius, A.muSMin);
  let Aterm  = (dLimit - dMinS) / max(dMaxS - dMinS, EPS);

  let xMuS = max(1.0 - a / max(Aterm, EPS), 0.0) / (1.0 + a);
  let uMuS = texcoordFromUnitRange(clamp(xMuS, 0.0, 1.0), f32(A.scatteringSize.y));

  let uNu = 0.5 * (nu + 1.0);

  return vec4f(uNu, uMuS, uMu, uR);
}

fn lookupPackedScattering(
  r: f32,
  mu: f32,
  muS: f32,
  nu: f32,
  hitsGround: bool
) -> ScatterLookup {
  let uvwz = scatteringUvwzFromRMuMuSNu(r, mu, muS, nu, hitsGround);

  let nuTexels = f32(A.scatteringSize.x);

  let nuCoord = uvwz.x * (nuTexels - 1.0);
  let x0      = floor(nuCoord);
  let x1      = min(x0 + 1.0, nuTexels - 1.0);
  let t       = nuCoord - x0;

  let uvw0 = vec3f((x0 + uvwz.y) / nuTexels, uvwz.z, uvwz.w);
  let uvw1 = vec3f((x1 + uvwz.y) / nuTexels, uvwz.z, uvwz.w);

  let s0 = textureSampleLevel(scatteringTex, linearSampler, uvw0, 0.0).rgb;
  let s1 = textureSampleLevel(scatteringTex, linearSampler, uvw1, 0.0).rgb;

  let m0 = textureSampleLevel(singleMieTex, linearSampler, uvw0, 0.0).rgb;
  let m1 = textureSampleLevel(singleMieTex, linearSampler, uvw1, 0.0).rgb;

  var out: ScatterLookup;
  out.scatter   = mix(s0, s1, t);
  out.singleMie = mix(m0, m1, t);
  return out;
}

fn skyRadianceBruneton(
  cameraWorld: vec3f,
  viewRayWorld: vec3f,
  sunDirWorld: vec3f
) -> SkyLookup {
  var camera = cameraWorld;
  let viewRay = normalize(viewRayWorld);
  let sunDir  = normalize(sunDirWorld);

  var r   = length(camera);
  var rmu = dot(camera, viewRay);

  let discToTop = rmu * rmu - r * r + A.topRadius * A.topRadius;

  if (r > A.topRadius && discToTop < 0.0) {
    var empty: SkyLookup;
    empty.radiance      = vec3f(0.0);
    empty.transmittance = vec3f(1.0);
    return empty;
  }

  let entryDistance = -rmu - safeSqrt(discToTop);

  if (entryDistance > 0.0) {
    camera = camera + viewRay * entryDistance;
    r      = A.topRadius;
    rmu    = rmu + entryDistance;
  } else if (r > A.topRadius) {
    var empty: SkyLookup;
    empty.radiance      = vec3f(0.0);
    empty.transmittance = vec3f(1.0);
    return empty;
  }

  let mu   = rmu / max(r, EPS);
  let muS  = dot(camera, sunDir) / max(r, EPS);
  let nu   = dot(viewRay, sunDir);
  let hitG = rayIntersectsGround(r, mu);

  var result: SkyLookup;
  result.transmittance = select(transmittanceToTop(r, mu), vec3f(0.0), hitG);

  var pair = lookupPackedScattering(r, mu, muS, nu, hitG);

  result.radiance =
      pair.scatter   * rayleighPhase(nu) +
      pair.singleMie * miePhase(A.mieG, nu);

  return result;
}

// ============================================================================
// Sky-space rendering
// ============================================================================

fn dirFromSkyUv(uv: vec2f) -> vec3f {
  let phi = (uv.x * 2.0 - 1.0) * PI;
  let y   = 1.0 - uv.y * 2.0;
  let r   = sqrt(max(1.0 - y * y, 0.0));
  return normalize(vec3f(sin(phi) * r, y, cos(phi) * r));
}

fn hash12(p: vec2f) -> f32 {
  let q = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  let d = dot(q, q.yzx + 33.33);
  return fract((q.x + q.y + d) * q.z);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash12(i + vec2f(0.0, 0.0));
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(mut p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = mat2x2<f32>(0.82, -0.57, 0.57, 0.82) * p * 2.03 + 7.13;
    a *= 0.5;
  }
  return v;
}

fn cloudMask(rd: vec3f) -> f32 {
  let phi = atan2(rd.x, rd.z) / (2.0 * PI) + 0.5;
  let v   = acos(clamp(rd.y, -1.0, 1.0)) / PI;

  let pA = vec2f(phi * 1.6, v * 2.4);
  let pB = vec2f(phi * 2.8, v * 3.6);

  let a = smoothstep(0.3, 0.45, fbm(pA));
  let b = smoothstep(0.2, 0.40, fbm(pB + 11.7));
  return clamp(0.65 * a + 0.35 * b, 0.0, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= A.skySize.x || gid.y >= A.skySize.y) { return; }

  let uv = (vec2f(gid.xy) + 0.5) / vec2f(A.skySize);
  let rd = dirFromSkyUv(uv);

  let camera = vec3f(0.0, A.bottomRadius + A.cameraHeight, 0.0);
  let s = skyRadianceBruneton(camera, rd, A.sunDir);

  var L = s.radiance;

  // Optional artistic overlays (clouds, skyline, glow):
  let c = cloudMask(rd);
  let sunDir = normalize(A.sunDir);
  let mu = dot(rd, sunDir);

  let cloudGlow = c * vec3f(0.22, 0.11, 0.06) * exp(-8.0 * max(0.0, 1.0 - mu));
  let cloudOccl = mix(1.0, 0.35, c);

  L = L * cloudOccl + cloudGlow;

  // Sun disk from atmospheric transmittance (better than fake sprite)
  let sunDiskRadius = sin(A.sunAngularRadius);
  let sunDot = dot(rd, sunDir);
  let sunDiskSteps = max(0.0, (sunDot - cos(A.sunAngularRadius * 2.0)) / max(sunDiskRadius * 0.1, EPS));
  L += vec3f(1.0, 0.85, 0.6) * pow(max(0.0, sunDiskSteps), 2.0) * s.transmittance;

  textureStore(outSky, vec2<i32>(gid.xy), vec4f(L, 1.0));
}
