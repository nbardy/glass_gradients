@group(0) @binding(0) var out_tex: texture_storage_2d<rgba16float, write>;

struct SkyParams {
  resolution: vec2f,
  time: f32,
  sunAzimuth: f32,
  sunElevation: f32,
  sceneType: f32, // 0 for city, 1 for beach sunset
  cloudSteps: f32,
  sunShadowSteps: f32,
}
@group(0) @binding(1) var<uniform> params: SkyParams;

const PI: f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;

fn hash11(p: f32) -> f32 {
  return fract(sin(p * 127.1) * 43758.5453123);
}

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i + vec2f(0.0, 0.0));
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(mut_p: vec2f) -> f32 {
  var p = mut_p;
  var s = 0.0;
  var a = 0.5;
  let m = mat2x2f(1.6, 1.2, -1.2, 1.6);
  for (var i = 0; i < 5; i = i + 1) {
    s = s + a * noise2(p);
    p = m * p;
    a = a * 0.5;
  }
  return s;
}

fn hg_phase(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

fn sun_dir() -> vec3f {
  let az = params.sunAzimuth;
  let el = params.sunElevation;
  return normalize(vec3f(sin(az) * cos(el), sin(el), cos(az) * cos(el)));
}

fn sunsetness(s_dir: vec3f) -> f32 {
  return 1.0 - smoothstep(0.05, 0.30, s_dir.y);
}

fn eval_sky_base(rd: vec3f, s_dir: vec3f) -> vec3f {
  let ss = sunsetness(s_dir);
  let zenith = vec3f(0.24, 0.34, 0.95);
  let horizon_cool = vec3f(0.72, 0.68, 0.99);
  let horizon_warm = vec3f(1.28, 0.56, 0.23);
  let horizon = mix(horizon_cool, horizon_warm, ss);

  let t = smoothstep(-0.08, 0.56, rd.y);
  var sky = mix(horizon, zenith, t);

  let mu = max(dot(rd, s_dir), 0.0);
  let sun_glow = exp2(16.0 * (mu - 1.0));
  let sun_core = exp2(1800.0 * (mu - 1.0));
  let anti_sun = max(dot(rd, -s_dir), 0.0);
  let horizon_m = exp(-18.0 * max(rd.y, 0.0));

  sky = sky + vec3f(1.50, 0.72, 0.24) * sun_glow * (0.35 + 0.90 * ss);
  sky = sky + vec3f(24.0, 10.5, 3.2) * sun_core;
  sky = sky + vec3f(0.18, 0.09, 0.25) * pow(anti_sun, 4.0) * (0.2 + 0.8 * ss);
  sky = mix(sky, horizon * vec3f(1.05, 0.98, 1.0), 0.25 * horizon_m);
  return sky;
}

fn cloud_field(p: vec2f, seed: f32, scale: f32, coverage: f32) -> f32 {
  var q = p * scale;
  let w = vec2f(
    fbm(q * 0.35 + vec2f(seed, seed + 3.7)),
    fbm(q * 0.35 + vec2f(seed + 5.1, seed + 9.4))
  );
  q = q + 2.2 * (w - 0.5);

  let base = fbm(q + seed * 11.0);
  let detail = 0.6 * noise2(q * 2.3 + seed * 17.0) +
    0.4 * noise2(q * 4.7 - seed * 3.0);

  let d = base * 0.72 + detail * 0.28;
  return smoothstep(coverage, 0.98, d);
}

fn cloud_density_layer(
  p: vec3f, h0: f32, h1: f32, scale: f32, coverage: f32, density: f32, seed: f32
) -> f32 {
  let u = (p.y - h0) / (h1 - h0);
  if (u <= 0.0 || u >= 1.0) { return 0.0; }
  let profile = 4.0 * u * (1.0 - u);
  let wind = vec2f(cos(seed * 2.3), sin(seed * 1.7)) * (0.22 + 0.07 * seed);
  let xz = p.xz + wind * params.time;
  let d2 = cloud_field(xz, seed, scale, coverage);
  return density * profile * d2;
}

fn march_to_sun(
  p: vec3f, s_dir: vec3f, h0: f32, h1: f32, scale: f32, coverage: f32, density: f32, seed: f32
) -> f32 {
  let sy = max(s_dir.y, 0.06);
  var t_max = (h1 - p.y) / sy;
  t_max = max(t_max, 0.0);
  let steps = max(i32(params.sunShadowSteps), 1);
  let ds = t_max / f32(steps);

  var od = 0.0;
  var t = ds * 0.5;
  for (var i = 0; i < steps; i = i + 1) {
    let q = p + s_dir * t;
    od = od + cloud_density_layer(q, h0, h1, scale, coverage, density, seed) * ds;
    t = t + ds;
  }
  return exp(-1.8 * od);
}

fn march_cloud_layer(
  rd: vec3f, s_dir: vec3f, h0: f32, h1: f32, scale: f32, coverage: f32, density: f32, seed: f32, phase_g: f32
) -> vec2f {
  if (rd.y <= 0.0) { return vec2f(1.0, 0.0); }

  let t0 = h0 / rd.y;
  let t1 = h1 / rd.y;
  if (t1 <= 0.0 || t1 <= t0) { return vec2f(1.0, 0.0); }

  let steps = max(i32(params.cloudSteps), 1);
  let ds = (t1 - t0) / f32(steps);
  
  // Since we precalculate to a 2D map, we omit pixel jitter to avoid bake noise. 
  // We can just step smoothly.
  var t = t0 + ds * 0.5; 
  var t_view = 1.0;
  var s = 0.0;
  let phase = hg_phase(dot(rd, s_dir), phase_g);

  for (var i = 0; i < steps; i = i + 1) {
    let p = rd * t;
    let rho = cloud_density_layer(p, h0, h1, scale, coverage, density, seed);

    if (rho > 1e-4) {
      let t_sun = march_to_sun(p, s_dir, h0, h1, scale, coverage, density, seed);
      let sigma_s = 0.95;
      let sigma_t = 1.25;
      s = s + t_view * sigma_s * rho * t_sun * phase * ds;
      t_view = t_view * exp(-sigma_t * rho * ds);
    }
    t = t + ds;
  }
  return vec2f(t_view, s);
}

fn cloud_shadow_at(world_xz: vec2f, s_dir: vec3f) -> f32 {
  let sy = max(s_dir.y, 0.06);
  var sh = 1.0;
  let p0 = world_xz + s_dir.xz / sy * 2.4;
  let p1 = world_xz + s_dir.xz / sy * 4.5;
  let p2 = world_xz + s_dir.xz / sy * 6.8;
  let d0 = cloud_field(p0, 1.7, 0.090, 0.60);
  let d1 = cloud_field(p1, 3.4, 0.060, 0.64);
  let d2 = cloud_field(p2, 6.2, 0.038, 0.67);
  sh = sh * mix(1.0, 0.55, d0);
  sh = sh * mix(1.0, 0.70, d1);
  sh = sh * mix(1.0, 0.82, d2);
  return sh;
}

fn skyline_height(x: f32) -> f32 {
  let u = x * 2.6 + 0.5;
  let cell = floor(u * 10.0);
  var h = 0.02 + 0.14 * hash11(cell * 1.31 + 4.7);
  h = h * step(0.12, hash11(cell * 3.17 + 0.9));
  h = h * (0.60 + 0.40 * noise2(vec2f(cell * 0.08, 2.1)));
  h = h + 0.07 * step(0.88, hash11(cell * 7.11 + 1.7));
  h = h + 0.05 * exp(-1.8 * x * x);
  return h;
}

fn eval_ground(rd: vec3f, s_dir: vec3f) -> vec3f {
  let ss = sunsetness(s_dir);
  let band = exp(-40.0 * abs(rd.y));
  let base = vec3f(0.020, 0.018, 0.050);
  let warm = vec3f(0.85, 0.32, 0.13) * band * (0.25 + 0.75 * ss);
  let cool = vec3f(0.03, 0.04, 0.09) * smoothstep(-0.65, -0.05, rd.y);
  return base + warm + cool;
}

fn eval_buildings(rd: vec3f, s_dir: vec3f) -> vec3f {
  let x = rd.x / max(rd.z, 0.08);
  let y = rd.y;
  let h = skyline_height(x);

  let ss = sunsetness(s_dir);
  let top_edge = exp(-150.0 * max(h - y, 0.0));
  let facade = 0.5 + 0.5 * sin(x * 26.0 + floor((x + 2.0) * 12.0) * 0.37);
  let shadow = cloud_shadow_at(vec2f(x * 22.0, 35.0), s_dir);

  var base = vec3f(0.050, 0.025, 0.070) + vec3f(0.030, 0.010, 0.050) * facade;
  base = base * mix(0.55, 1.00, shadow);
  base = base + vec3f(0.78, 0.24, 0.09) * top_edge * (0.35 + 0.85 * ss);

  let haze = exp(-20.0 * max(y, 0.0));
  base = mix(base, vec3f(0.25, 0.18, 0.30), 0.14 * haze);
  return base;
}

fn eval_sky_and_clouds(rd: vec3f, s_dir: vec3f) -> vec3f {
  let l_sky = eval_sky_base(rd, s_dir);
  var t = 1.0;
  var s = vec3f(0.0);
  let mu = clamp(dot(rd, s_dir), 0.0, 1.0);

  let c0 = march_cloud_layer(rd, s_dir, 2.1, 2.6, 0.090, 0.60, 0.95, 1.7, 0.45);
  let c1 = march_cloud_layer(rd, s_dir, 4.0, 4.8, 0.060, 0.64, 0.78, 3.4, 0.50);
  let c2 = march_cloud_layer(rd, s_dir, 6.3, 7.2, 0.038, 0.67, 0.52, 6.2, 0.58);

  let tint_near = vec3f(1.65, 0.80, 0.42);
  let tint_far = vec3f(0.95, 0.88, 1.02);
  let c_tint0 = mix(tint_far, tint_near, pow(mu, 0.55));
  let c_tint1 = mix(tint_far, tint_near, pow(mu, 0.80));
  let c_tint2 = mix(tint_far, tint_near, pow(mu, 1.20));

  s = s + t * c0.y * c_tint0 * 5.5;
  t = t * c0.x;
  s = s + t * c1.y * c_tint1 * 4.6;
  t = t * c1.x;
  s = s + t * c2.y * c_tint2 * 3.6;
  t = t * c2.x;

  return t * l_sky + s;
}

fn sample_outdoor(rd: vec3f) -> vec3f {
  // If we had the beach scene, we'd route it here based on sceneType
  let s_dir = sun_dir();
  if (rd.y < 0.0) { return eval_ground(rd, s_dir); }
  let x = rd.x / max(rd.z, 0.08);
  if (rd.y < skyline_height(x)) { return eval_buildings(rd, s_dir); }
  return eval_sky_and_clouds(rd, s_dir);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (f32(gid.x) >= params.resolution.x || f32(gid.y) >= params.resolution.y) { return; }
  
  // Convert gid to spherical mapping
  let u = f32(gid.x) / params.resolution.x;
  let v = f32(gid.y) / params.resolution.y;
  
  // Equirectangular projection
  // u: 0 -> 1 maps to phi: 0 -> 2pi
  // v: 0 -> 1 maps to theta: pi -> 0 (top to bottom)
  let phi = u * TAU;
  let theta = PI * v;
  
  // Convert spherical to cartesian
  let x = sin(theta) * cos(phi);
  let y = cos(theta);
  let z = sin(theta) * sin(phi);
  
  let rd = vec3f(x, y, z);
  let color = sample_outdoor(rd);
  
  textureStore(out_tex, vec2<i32>(gid.xy), vec4f(color, 1.0));
}
