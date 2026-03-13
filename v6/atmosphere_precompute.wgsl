// atmosphere_precompute.wgsl
// Generates Bruneton-style atmospheric scattering LUTs.

alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

const PI : f32 = 3.141592653589793;
const EPS: f32 = 1e-6;
const SAMPLE_COUNT: i32 = 50; // Integration steps

struct AtmosphereParams {
  bottomRadius      : f32,
  topRadius         : f32,
  rayleighDensityH  : f32,
  mieDensityH       : f32,

  rayleighScattering: vec3f,
  _pad1             : f32,
  
  mieScattering     : vec3f,
  _pad2             : f32,
  
  mieExtinction     : vec3f,
  _pad3             : f32,
  
  ozoneAbsorption   : vec3f,
  ozoneCenterH      : f32,
  
  ozoneWidth        : f32,
  _pad4             : vec3f,

  transmittanceSize : vec2<u32>,
  scatteringSize    : vec4<u32>, // (nu, mu_s, mu, r)
};

@group(0) @binding(0) var<uniform> A: AtmosphereParams;
@group(0) @binding(1) var transmittanceTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var scatteringTex: texture_storage_3d<rgba16float, write>;
@group(0) @binding(3) var singleMieTex: texture_storage_3d<rgba16float, write>;

fn safeSqrt(x: f32) -> f32 {
  return sqrt(max(x, 0.0));
}

fn clampCosine(x: f32) -> f32 {
  return clamp(x, -1.0, 1.0);
}

fn clampRadius(r: f32) -> f32 {
  return clamp(r, A.bottomRadius, A.topRadius);
}

fn unitRangeFromTexcoord(u: f32, texels: f32) -> f32 {
  return clamp((u - 0.5 / texels) / (1.0 - 1.0 / texels), 0.0, 1.0);
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

// Get r, mu from transmittance UV
fn getRMuFromTransmittanceUv(uv: vec2f) -> vec2f {
  let xMu = unitRangeFromTexcoord(uv.x, f32(A.transmittanceSize.x));
  let xR  = unitRangeFromTexcoord(uv.y, f32(A.transmittanceSize.y));

  let H = safeSqrt(A.topRadius * A.topRadius - A.bottomRadius * A.bottomRadius);
  let rho = xR * H;
  let r = safeSqrt(rho * rho + A.bottomRadius * A.bottomRadius);

  let dMin = A.topRadius - r;
  let dMax = rho + H;
  let d = dMin + xMu * (dMax - dMin);

  let mu = (A.topRadius * A.topRadius - r * r - d * d) / max(2.0 * r * d, EPS);
  return vec2f(clampRadius(r), clampCosine(mu));
}

// Get r, mu, muS, nu from scattering UVWZ
fn getRMuMuSNuFromScatteringUvwz(uvwz: vec4f) -> vec4f {
  let uNu = uvwz.x;
  let uMuS = uvwz.y;
  let uMu = uvwz.z;
  let uR = uvwz.w;

  let H = safeSqrt(A.topRadius * A.topRadius - A.bottomRadius * A.bottomRadius);
  let rho = unitRangeFromTexcoord(uR, f32(A.scatteringSize.w)) * H;
  let r = clampRadius(safeSqrt(rho * rho + A.bottomRadius * A.bottomRadius));

  let rmu  = r * 0.0; // dummy
  
  // Unpack mu
  let halfMuTexels = 0.5 * f32(A.scatteringSize.z);
  var mu = 0.0;
  if (uMu < 0.5) {
    let x = unitRangeFromTexcoord(1.0 - uMu * 2.0, halfMuTexels);
    let dMin = r - A.bottomRadius;
    let dMax = rho;
    let d = dMin + x * (dMax - dMin);
    mu = (A.bottomRadius * A.bottomRadius - r * r - d * d) / max(2.0 * r * d, EPS);
  } else {
    let x = unitRangeFromTexcoord(uMu * 2.0 - 1.0, halfMuTexels);
    let dMin = A.topRadius - r;
    let dMax = rho + H;
    let d = dMin + x * (dMax - dMin);
    mu = (A.topRadius * A.topRadius - r * r - d * d) / max(2.0 * r * d, EPS);
  }

  // Unpack muS
  let xMuS = unitRangeFromTexcoord(uMuS, f32(A.scatteringSize.y));
  let dMinS = A.topRadius - A.bottomRadius;
  let dMaxS = H;
  let dLimit = distanceToTopBoundary(A.bottomRadius, -0.2); // muSMin is hardcoded -0.2 in skyview
  let Aterm = (dLimit - dMinS) / max(dMaxS - dMinS, EPS);
  let a = (1.0 - xMuS * (1.0 + Aterm)) / max(1.0 + xMuS, EPS); // Approx inversion
  let dSun = dMinS + a * (dMaxS - dMinS);
  let muS = (A.topRadius * A.topRadius - A.bottomRadius * A.bottomRadius - dSun * dSun) / max(2.0 * A.bottomRadius * dSun, EPS);

  // Unpack nu
  let nu = clampCosine(uNu * 2.0 - 1.0);

  return vec4f(clampRadius(r), clampCosine(mu), clampCosine(muS), nu);
}

struct MediumProfile {
  rayleigh: f32,
  mie: f32,
  ozone: f32,
}

fn getProfile(r: f32) -> MediumProfile {
  let h = max(r - A.bottomRadius, 0.0);
  let rayleigh = exp(-h / A.rayleighDensityH);
  let mie = exp(-h / A.mieDensityH);
  let ozone = max(0.0, 1.0 - abs(h - A.ozoneCenterH) / A.ozoneWidth);
  return MediumProfile(rayleigh, mie, ozone);
}

fn computeOpticalDepth(r: f32, mu: f32, d: f32) -> vec3f {
  var depthRayleigh = 0.0;
  var depthMie = 0.0;
  var depthOzone = 0.0;

  let dx = d / f32(SAMPLE_COUNT);
  for (var i = 0; i < SAMPLE_COUNT; i++) {
    let d_i = f32(i) * dx + dx * 0.5;
    let r_i = safeSqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r);
    let profile = getProfile(r_i);
    depthRayleigh += profile.rayleigh * dx;
    depthMie += profile.mie * dx;
    depthOzone += profile.ozone * dx;
  }

  return A.rayleighScattering * depthRayleigh + 
         A.mieExtinction * depthMie + 
         A.ozoneAbsorption * depthOzone;
}

@compute @workgroup_size(8, 8, 1)
fn compute_transmittance(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= A.transmittanceSize.x || gid.y >= A.transmittanceSize.y) { return; }

  let uv = (vec2f(gid.xy) + 0.5) / vec2f(A.transmittanceSize);
  let r_mu = getRMuFromTransmittanceUv(uv);
  let r = r_mu.x;
  let mu = r_mu.y;

  let d = select(distanceToTopBoundary(r, mu), distanceToBottomBoundary(r, mu), rayIntersectsGround(r, mu));
  let opticalDepth = computeOpticalDepth(r, mu, d);
  let transmittance = exp(-opticalDepth);

  textureStore(transmittanceTex, vec2<i32>(gid.xy), vec4f(transmittance, 1.0));
}

// Simple texture fetcher since we don't have access to transmittanceTex as a sampled texture in the same pass
// We will approximate Transmittance for Single Scattering or require two passes.
// Actually, doing it physically requires sampling Transmittance. We can compute it inline for Single Scattering to save passes,
// though it's O(N^2) work. Since it's precompute, O(N^2) is fine!

fn getTransmittanceInline(r: f32, mu: f32, d: f32) -> vec3f {
  return exp(-computeOpticalDepth(r, mu, d));
}

@compute @workgroup_size(8, 8, 4)
fn compute_single_scattering(@builtin(global_invocation_id) gid: vec3<u32>) {
  // Map 3D thread ID back to 4D coordinates
  let width = A.scatteringSize.x * A.scatteringSize.y; // nu * mu_s
  let height = A.scatteringSize.z; // mu
  let depth = A.scatteringSize.w; // r

  if (gid.x >= width || gid.y >= height || gid.z >= depth) { return; }

  let nuIndex = gid.x % A.scatteringSize.x;
  let muSIndex = gid.x / A.scatteringSize.x;

  let uvwz = vec4f(
    (f32(nuIndex) + 0.5) / f32(A.scatteringSize.x),
    (f32(muSIndex) + 0.5) / f32(A.scatteringSize.y),
    (f32(gid.y) + 0.5) / f32(A.scatteringSize.z),
    (f32(gid.z) + 0.5) / f32(A.scatteringSize.w)
  );

  let params = getRMuMuSNuFromScatteringUvwz(uvwz);
  let r = params.x;
  let mu = params.y;
  let muS = params.z;
  let nu = params.w;

  let hitsGround = rayIntersectsGround(r, mu);
  let dMax = select(distanceToTopBoundary(r, mu), distanceToBottomBoundary(r, mu), hitsGround);

  var rayleighAccum = vec3f(0.0);
  var mieAccum = vec3f(0.0);

  let dx = dMax / f32(SAMPLE_COUNT);
  for (var i = 0; i < SAMPLE_COUNT; i++) {
    let d_i = f32(i) * dx + dx * 0.5;
    let r_i = safeSqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r);
    let muS_i = (r * muS + d_i * nu) / r_i;

    let profile = getProfile(r_i);
    
    // Transmittance from r to r_i
    let t_r_ri = getTransmittanceInline(r, mu, d_i);
    
    // Transmittance from r_i to sun
    let dSun = distanceToTopBoundary(r_i, muS_i);
    let t_ri_sun = select(getTransmittanceInline(r_i, muS_i, dSun), vec3f(0.0), rayIntersectsGround(r_i, muS_i));

    let S = t_r_ri * t_ri_sun * dx;

    rayleighAccum += profile.rayleigh * S;
    mieAccum += profile.mie * S;
  }

  let finalRayleigh = rayleighAccum * A.rayleighScattering;
  let finalMie = mieAccum * A.mieScattering;

  // We write Rayleigh to scatteringTex and Mie to singleMieTex
  textureStore(scatteringTex, vec3<i32>(gid.xyz), vec4f(finalRayleigh, 1.0));
  textureStore(singleMieTex, vec3<i32>(gid.xyz), vec4f(finalMie, 1.0));
}
