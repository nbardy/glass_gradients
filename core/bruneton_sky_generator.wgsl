@group(0) @binding(0) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(2) var scatteringTex: texture_3d<f32>;
@group(0) @binding(3) var singleMieTex: texture_3d<f32>;

struct AtmosphereParams {
  resolution: vec2f,
  sunDirection: vec3f,
  bottomRadius: f32,
  topRadius: f32,
  mieG: f32,
}
@group(0) @binding(4) var<uniform> params: AtmosphereParams;
@group(0) @binding(5) var linearSampler: sampler;

const PI = 3.14159265359;
const TAU = 6.28318530718;

// Mapping functions for Bruneton LUTs
fn clampCosine(mu: f32) -> f32 {
  return clamp(mu, -1.0, 1.0);
}

fn clampRadius(r: f32) -> f32 {
  return clamp(r, params.bottomRadius, params.topRadius);
}

fn safeSqrt(a: f32) -> f32 {
  return sqrt(max(a, 0.0));
}

fn distanceToTopAtmosphereBoundary(r: f32, mu: f32) -> f32 {
  let discriminant = r * r * (mu * mu - 1.0) + params.topRadius * params.topRadius;
  return max(-r * mu + safeSqrt(discriminant), 0.0);
}

fn getTextureCoordFromUnitRange(x: f32, size: f32) -> f32 {
  return 0.5 / size + x * (1.0 - 1.0 / size);
}

fn getTransmittanceTextureUvFromRMu(r: f32, mu: f32) -> vec2f {
  let H = sqrt(params.topRadius * params.topRadius - params.bottomRadius * params.bottomRadius);
  let rho = safeSqrt(r * r - params.bottomRadius * params.bottomRadius);
  let d = distanceToTopAtmosphereBoundary(r, mu);
  let d_min = params.topRadius - r;
  let d_max = rho + H;
  let x_mu = (d - d_min) / (d_max - d_min);
  let x_r = rho / H;
  return vec2f(
    getTextureCoordFromUnitRange(x_mu, 256.0),
    getTextureCoordFromUnitRange(x_r, 64.0)
  );
}

fn getScatteringTextureUvwzFromRMuMuSNu(r: f32, mu: f32, mu_s: f32, nu: f32, ray_r_mu_intersects_ground: bool) -> vec4f {
  let H = safeSqrt(params.topRadius * params.topRadius - params.bottomRadius * params.bottomRadius);
  let rho = safeSqrt(r * r - params.bottomRadius * params.bottomRadius);
  var u_r = getTextureCoordFromUnitRange(rho / H, 32.0);

  let r_mu = r * mu;
  let discriminant = r_mu * r_mu - r * r + params.bottomRadius * params.bottomRadius;
  var u_mu: f32;
  if (ray_r_mu_intersects_ground) {
    let d = -r_mu - safeSqrt(discriminant);
    let d_min = r - params.bottomRadius;
    let d_max = rho;
    var t = 0.0;
    if (d_max != d_min) {
        t = (d - d_min) / (d_max - d_min);
    }
    u_mu = 0.5 - 0.5 * getTextureCoordFromUnitRange(t, 16.0);
  } else {
    let d = -r_mu + safeSqrt(discriminant + H * H);
    let d_min = params.topRadius - r;
    let d_max = rho + H;
    u_mu = 0.5 + 0.5 * getTextureCoordFromUnitRange((d - d_min) / (d_max - d_min), 16.0);
  }

  let d = distanceToTopAtmosphereBoundary(params.bottomRadius, mu_s);
  let d_min = params.topRadius - params.bottomRadius;
  let d_max = H;
  let a = (d - d_min) / (d_max - d_min);
  let u_mu_s = getTextureCoordFromUnitRange(max(1.0 - a / a, 0.0) / (1.0 + a), 128.0); // Simple approx
  
  let u_nu = (nu + 1.0) / 2.0;
  return vec4f(u_nu, u_mu_s, u_mu, u_r);
}

fn getScattering(r: f32, mu: f32, mu_s: f32, nu: f32, ray_r_mu_intersects_ground: bool) -> vec3f {
  let uvwz = getScatteringTextureUvwzFromRMuMuSNu(r, mu, mu_s, nu, ray_r_mu_intersects_ground);
  let texX = uvwz.x * 8.0;
  let texY = uvwz.y * 128.0;
  let u = (texX + floor(texY)) / (8.0 * 128.0);
  return textureSampleLevel(scatteringTex, linearSampler, vec3f(u, uvwz.z, uvwz.w), 0.0).rgb;
}

fn getTransmittance(r: f32, mu: f32) -> vec3f {
  let uv = getTransmittanceTextureUvFromRMu(r, mu);
  return textureSampleLevel(transmittanceTex, linearSampler, uv, 0.0).rgb;
}

fn phaseRayleigh(nu: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + nu * nu);
}

fn phaseMie(nu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + nu * nu)) / 
         ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * nu, 1.5));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (f32(gid.x) >= params.resolution.x || f32(gid.y) >= params.resolution.y) { return; }

  let u = (f32(gid.x) + 0.5) / params.resolution.x;
  let v = (f32(gid.y) + 0.5) / params.resolution.y;

  let phi = u * TAU;
  let theta = PI * v;

  let x = sin(theta) * cos(phi);
  let y = cos(theta);
  let z = sin(theta) * sin(phi);
  let view_dir = vec3f(x, y, z);

  // View parameters
  let r = params.bottomRadius + 0.001; // Slightly above ground
  let mu = clampCosine(view_dir.y);
  let mu_s = clampCosine(params.sunDirection.y);
  let nu = clampCosine(dot(view_dir, params.sunDirection));
  
  let intersects_ground = (mu < 0.0) && (r * r * (mu * mu - 1.0) + params.bottomRadius * params.bottomRadius >= 0.0);

  var color = vec3f(0.0);

  if (!intersects_ground) {
    // Lookup scattering with correct 4D-to-3D interpolation
    let uvwz = getScatteringTextureUvwzFromRMuMuSNu(r, mu, mu_s, nu, false);
    
    let nuTexels = 8.0;
    let nuCoord = uvwz.x * (nuTexels - 1.0);
    let x0 = floor(nuCoord);
    let x1 = min(x0 + 1.0, nuTexels - 1.0);
    let t = nuCoord - x0;

    let uvw0 = vec3f((x0 + uvwz.y) / nuTexels, uvwz.z, uvwz.w);
    let uvw1 = vec3f((x1 + uvwz.y) / nuTexels, uvwz.z, uvwz.w);

    let rayleigh0 = textureSampleLevel(scatteringTex, linearSampler, uvw0, 0.0).rgb;
    let rayleigh1 = textureSampleLevel(scatteringTex, linearSampler, uvw1, 0.0).rgb;
    let rayleigh = mix(rayleigh0, rayleigh1, t);

    let mie0 = textureSampleLevel(singleMieTex, linearSampler, uvw0, 0.0).rgb;
    let mie1 = textureSampleLevel(singleMieTex, linearSampler, uvw1, 0.0).rgb;
    let mie = mix(mie0, mie1, t);
    
    let pr = phaseRayleigh(nu);
    let pm = phaseMie(nu, params.mieG);
    
    color = rayleigh * pr + mie * pm;

    // Add Sun Disk
    let sun_angular_radius = 0.00465;
    let sun_solid_angle = PI * sun_angular_radius * sun_angular_radius;
    let sun_luminance = vec3f(120000.0);
    
    if (nu > cos(sun_angular_radius)) {
      let t_sun = getTransmittance(r, mu_s);
      color = color + t_sun * sun_luminance * 1e-4; // Expose down for HDR buffer
    }
  }

  // Ensure HDR values are valid
  color = max(color, vec3f(0.0));
  textureStore(outTex, vec2<i32>(gid.xy), vec4f(color, 1.0));
}