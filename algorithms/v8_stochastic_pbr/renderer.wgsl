struct Params {
  resolution_time: vec4f,
  sampling: vec4f,
  flags: vec4f,
  tuning: vec4f,
  sun_camera: vec4f,
  glass_a: vec4f,
  glass_b: vec4f,
  debug: vec4f,
};

struct PixelState {
  mean_count: vec4f,
  luma_stats: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> state_buffer: array<PixelState>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<storage, read_write> frame_stats: array<atomic<u32>, 8>;
@group(0) @binding(4) var background_sample_tex: texture_2d<f32>;
@group(0) @binding(5) var glass_gbuffer: texture_2d<f32>;
@group(0) @binding(6) var linear_sampler: sampler;

@group(1) @binding(0) var display_sample_tex: texture_2d<f32>;

const PI: f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;
const BG_MIN: vec2f = vec2f(-0.8, -0.6);
const BG_MAX: vec2f = vec2f(0.8, 0.9);

fn resolution() -> vec2f { return params.resolution_time.xy; }
fn scene_time() -> f32 {
  if (params.flags.x > 0.5) { return 0.0; }
  return params.resolution_time.z;
}

fn hash11(p: f32) -> f32 { return fract(sin(p * 127.1) * 43758.5453123); }
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn hash22(p: vec2f) -> vec2f {
  let n = sin(dot(p, vec2f(41.0, 289.0)));
  return fract(vec2f(262144.0, 32768.0) * n);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i + vec2f(0.0, 0.0)); let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0)); let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(mut_p: vec2f) -> f32 {
  var p = mut_p; var s = 0.0; var a = 0.5; let m = mat2x2f(1.6, 1.2, -1.2, 1.6);
  for (var i = 0; i < 5; i = i + 1) { s = s + a * noise2(p); p = m * p; a = a * 0.5; }
  return s;
}

fn r2_sequence(n: f32) -> vec2f {
  return fract((n + 1.0) * vec2f(0.7548776662466927, 0.5698402909980532));
}

fn sample_xi(frag_coord: vec2f, sample_index: f32) -> vec2f {
  let a = r2_sequence(sample_index);
  let b = hash22(frag_coord + vec2f(19.13, 73.71) * (sample_index + 1.0));
  return fract(a + b);
}

fn pixel_jitter(frag_coord: vec2f, sample_index: f32) -> vec2f {
  return sample_xi(frag_coord, sample_index) - 0.5;
}

fn make_basis(n: vec3f) -> mat3x3f {
  let up = select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), abs(n.z) >= 0.999);
  let t = normalize(cross(up, n)); let b = cross(n, t);
  return mat3x3f(t, b, n);
}

fn sample_ggx_normal(n: vec3f, xi: vec2f, alpha: f32) -> vec3f {
  let a2 = alpha * alpha; let phi = TAU * xi.x;
  let cos_theta = sqrt((1.0 - xi.y) / max(1.0 + (a2 - 1.0) * xi.y, 1e-5));
  let sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
  let h_local = vec3f(cos(phi) * sin_theta, sin(phi) * sin_theta, cos_theta);
  let basis = make_basis(n);
  return normalize(basis * h_local);
}

fn fresnel_schlick(cos_theta: f32, eta_i: f32, eta_t: f32) -> f32 {
  var f0 = (eta_i - eta_t) / (eta_i + eta_t); f0 = f0 * f0;
  return f0 + (1.0 - f0) * pow(1.0 - cos_theta, 5.0);
}

fn hg_phase(mu: f32, g: f32) -> f32 {
  let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

fn sun_dir() -> vec3f {
  let az = params.sun_camera.x; let el = params.sun_camera.y;
  return normalize(vec3f(sin(az) * cos(el), sin(el), cos(az) * cos(el)));
}

fn sunsetness(s_dir: vec3f) -> f32 { return 1.0 - smoothstep(0.05, 0.30, s_dir.y); }

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
  let w = vec2f(fbm(q * 0.35 + vec2f(seed, seed + 3.7)), fbm(q * 0.35 + vec2f(seed + 5.1, seed + 9.4)));
  q = q + 2.2 * (w - 0.5);
  let base = fbm(q + seed * 11.0);
  let detail = 0.6 * noise2(q * 2.3 + seed * 17.0) + 0.4 * noise2(q * 4.7 - seed * 3.0);
  let d = base * 0.72 + detail * 0.28;
  return smoothstep(coverage, 0.98, d);
}

fn cloud_density_layer(p: vec3f, h0: f32, h1: f32, scale: f32, coverage: f32, density: f32, seed: f32) -> f32 {
  let u = (p.y - h0) / (h1 - h0);
  if (u <= 0.0 || u >= 1.0) { return 0.0; }
  let profile = 4.0 * u * (1.0 - u);
  let wind = vec2f(cos(seed * 2.3), sin(seed * 1.7)) * (0.22 + 0.07 * seed);
  let xz = p.xz + wind * scene_time();
  let d2 = cloud_field(xz, seed, scale, coverage);
  return density * profile * d2;
}

fn march_to_sun(p: vec3f, s_dir: vec3f, h0: f32, h1: f32, scale: f32, coverage: f32, density: f32, seed: f32) -> f32 {
  let sy = max(s_dir.y, 0.06);
  var t_max = (h1 - p.y) / sy; t_max = max(t_max, 0.0);
  let steps = max(i32(params.sampling.w), 1);
  let ds = t_max / f32(steps);
  var od = 0.0; var t = ds * 0.5;
  for (var i = 0; i < steps; i = i + 1) {
    let q = p + s_dir * t;
    od = od + cloud_density_layer(q, h0, h1, scale, coverage, density, seed) * ds;
    t = t + ds;
  }
  return exp(-1.8 * od);
}

fn march_cloud_layer(rd: vec3f, s_dir: vec3f, h0: f32, h1: f32, scale: f32, coverage: f32, density: f32, seed: f32, phase_g: f32, xi: vec2f) -> vec2f {
  if (rd.y <= 0.0) { return vec2f(1.0, 0.0); }
  let t0 = h0 / rd.y; let t1 = h1 / rd.y;
  if (t1 <= 0.0 || t1 <= t0) { return vec2f(1.0, 0.0); }
  let steps = max(i32(params.sampling.z), 1);
  let ds = (t1 - t0) / f32(steps);
  var t = t0 + ds * xi.x; var t_view = 1.0; var s = 0.0;
  let phase = hg_phase(dot(rd, s_dir), phase_g);
  for (var i = 0; i < steps; i = i + 1) {
    let p = rd * t;
    let rho = cloud_density_layer(p, h0, h1, scale, coverage, density, seed);
    if (rho > 1e-4) {
      let t_sun = march_to_sun(p, s_dir, h0, h1, scale, coverage, density, seed);
      let sigma_s = 0.95; let sigma_t = 1.25;
      s = s + t_view * sigma_s * rho * t_sun * phase * ds;
      t_view = t_view * exp(-sigma_t * rho * ds);
    }
    t = t + ds;
  }
  return vec2f(t_view, s);
}

fn cloud_shadow_at(world_xz: vec2f, s_dir: vec3f) -> f32 {
  let sy = max(s_dir.y, 0.06); var sh = 1.0;
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
  let u = x * 2.6 + 0.5; let cell = floor(u * 10.0);
  var h = 0.02 + 0.14 * hash11(cell * 1.31 + 4.7);
  h = h * step(0.12, hash11(cell * 3.17 + 0.9));
  h = h * (0.60 + 0.40 * noise2(vec2f(cell * 0.08, 2.1)));
  h = h + 0.07 * step(0.88, hash11(cell * 7.11 + 1.7));
  h = h + 0.05 * exp(-1.8 * x * x);
  return h;
}

fn eval_ground(rd: vec3f, s_dir: vec3f) -> vec3f {
  let ss = sunsetness(s_dir); let band = exp(-40.0 * abs(rd.y));
  let base = vec3f(0.020, 0.018, 0.050);
  let warm = vec3f(0.85, 0.32, 0.13) * band * (0.25 + 0.75 * ss);
  let cool = vec3f(0.03, 0.04, 0.09) * smoothstep(-0.65, -0.05, rd.y);
  return base + warm + cool;
}

fn eval_buildings(rd: vec3f, s_dir: vec3f) -> vec3f {
  let x = rd.x / max(rd.z, 0.08); let y = rd.y; let h = skyline_height(x);
  let ss = sunsetness(s_dir); let top_edge = exp(-150.0 * max(h - y, 0.0));
  let facade = 0.5 + 0.5 * sin(x * 26.0 + floor((x + 2.0) * 12.0) * 0.37);
  let shadow = cloud_shadow_at(vec2f(x * 22.0, 35.0), s_dir);
  var base = vec3f(0.050, 0.025, 0.070) + vec3f(0.030, 0.010, 0.050) * facade;
  base = base * mix(0.55, 1.00, shadow);
  base = base + vec3f(0.78, 0.24, 0.09) * top_edge * (0.35 + 0.85 * ss);
  let haze = exp(-20.0 * max(y, 0.0));
  base = mix(base, vec3f(0.25, 0.18, 0.30), 0.14 * haze);
  return base;
}

fn eval_sky_and_clouds(rd: vec3f, s_dir: vec3f, xi: vec2f) -> vec3f {
  let l_sky = eval_sky_base(rd, s_dir);
  var t = 1.0; var s = vec3f(0.0); let mu = clamp(dot(rd, s_dir), 0.0, 1.0);
  let c0 = march_cloud_layer(rd, s_dir, 2.1, 2.6, 0.090, 0.60, 0.95, 1.7, 0.45, xi + 0.13);
  let c1 = march_cloud_layer(rd, s_dir, 4.0, 4.8, 0.060, 0.64, 0.78, 3.4, 0.50, xi + 0.31);
  let c2 = march_cloud_layer(rd, s_dir, 6.3, 7.2, 0.038, 0.67, 0.52, 6.2, 0.58, xi + 0.57);
  let tint_near = vec3f(1.65, 0.80, 0.42); let tint_far = vec3f(0.95, 0.88, 1.02);
  let c_tint0 = mix(tint_far, tint_near, pow(mu, 0.55));
  let c_tint1 = mix(tint_far, tint_near, pow(mu, 0.80));
  let c_tint2 = mix(tint_far, tint_near, pow(mu, 1.20));
  s = s + t * c0.y * c_tint0 * 5.5; t = t * c0.x;
  s = s + t * c1.y * c_tint1 * 4.6; t = t * c1.x;
  s = s + t * c2.y * c_tint2 * 3.6; t = t * c2.x;
  return t * l_sky + s;
}

fn saturate(x : f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn hash21_sunset(p : vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise_sunset(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21_sunset(i);
  let b = hash21_sunset(i + vec2f(1.0, 0.0));
  let c = hash21_sunset(i + vec2f(0.0, 1.0));
  let d = hash21_sunset(i + vec2f(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm_sunset(mut_p : vec2f) -> f32 {
  var p = mut_p;
  var v = 0.0;
  var a = 0.5;
  let rot = mat2x2<f32>(0.80, -0.60, 0.60, 0.80);
  for (var i : i32 = 0; i < 5; i = i + 1) {
    v = v + a * noise_sunset(p);
    p = rot * p * 2.02 + vec2f(17.1, 13.7);
    a = a * 0.5;
  }
  return v;
}

fn sunset_sky_color(rd : vec3f) -> vec3f {
  let t = saturate(rd.y / 0.5);
  let inv_t = 1.0 - t; 

  let topCol = vec3f(0.13, 0.03, 0.14);
  let midCol = vec3f(0.37, 0.05, 0.13);
  let horizonCol = vec3f(0.98, 0.26, 0.11);

  var col = mix(topCol, midCol, smoothstep(0.0, 0.55, inv_t));
  col = mix(col, horizonCol, smoothstep(0.48, 1.0, inv_t));

  let haze = pow(inv_t, 8.0);
  col = col + vec3f(1.0, 0.28, 0.10) * haze * 0.22;

  return col;
}

fn sunset_sun_disk(rd : vec3f, s_dir : vec3f, time : f32) -> vec3f {
  let mu = dot(rd, s_dir);
  let d = acos(clamp(mu, -1.0, 1.0)); 
  let radius = 0.06;
  
  let disk = 1.0 - smoothstep(radius, radius + 0.006, d);
  let glowBoost = 1.12;
  let glow = exp(-d * (10.5 - glowBoost * 1.2)) * (0.55 + glowBoost * 0.2);

  let vert = saturate((rd.y - (s_dir.y - radius)) / max(radius * 2.0, 0.0001));
  var col = mix(vec3f(0.92, 0.20, 0.10), vec3f(1.00, 0.76, 0.46), vert);

  let grain = fbm_sunset((rd.xy - s_dir.xy) * vec2f(15.0, 11.0) + vec2f(0.0, time * 0.08));
  col = col * mix(0.96, 1.04, grain);

  return col * disk + vec3f(1.00, 0.24, 0.12) * glow;
}

fn sunset_cloud_mask(rd : vec3f, time : f32) -> f32 {
  let region = smoothstep(0.38, 0.28, rd.y) * smoothstep(0.03, 0.14, rd.y);
  let uv = vec2f(rd.x * 0.5 + 0.5, 0.565 - rd.y * 0.5); 
  let p1 = vec2f(uv.x * 5.0 + time * 0.012, uv.y * 24.0);
  let p2 = vec2f(uv.x * 2.7 - time * 0.008, uv.y * 38.0 + 11.0);

  var n = fbm_sunset(p1) * 0.70 + fbm_sunset(p2) * 0.30;
  n = n + 0.16 * (0.5 + 0.5 * sin(uv.x * 32.0 + n * 7.0));

  var clouds = smoothstep(0.60, 0.80, n) * region;

  let lowBand = exp(-pow((rd.y - 0.035) * 13.0, 2.0)); 
  let lowNoise = fbm_sunset(vec2f(uv.x * 3.4 + time * 0.006, uv.y * 44.0));
  clouds = clouds + smoothstep(0.56, 0.77, lowNoise) * lowBand * 0.45;

  return saturate(clouds);
}

fn sunset_ocean_color(rd : vec3f, s_dir: vec3f, time : f32) -> vec3f {
  let depth = saturate(-rd.y / 0.5);

  var col = mix(vec3f(0.015, 0.018, 0.040), vec3f(0.070, 0.035, 0.055), depth * 0.35);

  let uv_x = rd.x * 0.5 + 0.5;
  let perspectiveScale = mix(140.0, 18.0, sqrt(depth));
  let waveNoise = fbm_sunset(vec2f(uv_x * perspectiveScale, depth * 10.0 - time * 0.20));
  let waveNoise2 = fbm_sunset(vec2f(uv_x * perspectiveScale * 0.65 - time * 0.12, depth * 18.0 + 7.0));
  let ripples = waveNoise * 0.6 + waveNoise2 * 0.4;

  let rx = abs(rd.x - s_dir.x);
  let pathWidth = mix(0.020, 0.18, sqrt(depth));
  let reflection = exp(-pow(rx / max(pathWidth, 0.0001), 1.35));
  let sparkle = smoothstep(0.55, 0.95, ripples);

  let reflBoost = 1.0;
  col = col + vec3f(0.90, 0.22, 0.10) * reflection * sparkle * (0.18 + 0.45 * reflBoost * (1.0 - depth));

  let horizonSheen = 1.0 - smoothstep(0.0, 0.08, depth);
  col = col + vec3f(0.22, 0.05, 0.05) * horizonSheen * 0.35;

  let foamRegion = smoothstep(0.60, 1.0, depth);
  let foamNoise = fbm_sunset(vec2f(uv_x * 22.0, depth * 20.0 - time * 0.18));
  let foam = smoothstep(0.58, 0.76, foamNoise) * foamRegion;
  col = col + vec3f(0.75, 0.78, 0.85) * foam * 0.20;

  let nearDarken = smoothstep(0.35, 1.0, depth);
  col = col * (1.0 - 0.12 * nearDarken * smoothstep(0.45, 0.95, ripples));

  return col;
}

fn sample_beach_sunset(rd: vec3f, s_dir: vec3f) -> vec3f {
  let time = scene_time();

  if (rd.y < 0.0) {
    let ocean = sunset_ocean_color(rd, s_dir, time);
    let horizonGlow = exp(-abs(rd.y) * 14.0) * 0.17;
    var col = ocean + vec3f(1.0, 0.16, 0.08) * horizonGlow;
    let farMist = 1.0 - smoothstep(0.0, 0.15, abs(rd.y));
    col = col + vec3f(0.16, 0.03, 0.04) * farMist * 0.12;
    return col;
  } else {
    var col = sunset_sky_color(rd);
    let sunCol = sunset_sun_disk(rd, s_dir, time);
    col = col + sunCol;

    let d = acos(clamp(dot(rd, s_dir), -1.0, 1.0));
    let backGlow = exp(-d * 8.5);

    let clouds = sunset_cloud_mask(rd, time);
    let cloudBase = vec3f(0.075, 0.040, 0.055);
    let cloudRim = vec3f(0.75, 0.12, 0.08) * backGlow * 0.26;
    col = mix(col, cloudBase, clouds * 0.92);
    col = col + cloudRim * clouds;

    let horizonGlow = exp(-abs(rd.y) * 14.0) * 0.17;
    col = col + vec3f(1.0, 0.16, 0.08) * horizonGlow;

    let farMist = 1.0 - smoothstep(0.0, 0.15, abs(rd.y));
    col = col + vec3f(0.16, 0.03, 0.04) * farMist * 0.12;

    return col;
  }
}

fn sample_outdoor(rd: vec3f, xi: vec2f) -> vec3f {
  // Convert ray direction to spherical coordinates
  let theta = acos(clamp(rd.y, -1.0, 1.0)); // 0 to pi
  let phi = atan2(rd.z, rd.x); // -pi to pi

  // Map to UV space for equirectangular projection
  let u = fract(phi / TAU);
  let v = 1.0 - (theta / PI);

  return textureSampleLevel(background_sample_tex, linear_sampler, vec2f(u, v), 0.0).rgb;
}

fn background_rd_from_uv(uv: vec2f) -> vec3f {
  let q = mix(vec2f(BG_MIN.x, BG_MAX.y), vec2f(BG_MAX.x, BG_MIN.y), uv);
  return normalize(vec3f(q, 1.0));
}

fn background_uv_from_rd(rd: vec3f) -> vec2f {
  let q = rd.xy / max(rd.z, 1e-4);
  let uv_x = (q.x - BG_MIN.x) / (BG_MAX.x - BG_MIN.x);
  let uv_y = (BG_MAX.y - q.y) / (BG_MAX.y - BG_MIN.y);
  return vec2f(uv_x, uv_y);
}

fn sample_background_texture(rd: vec3f) -> vec3f {
  let dims_u = textureDimensions(background_sample_tex);
  let dims = vec2f(dims_u);
  let uv = clamp(background_uv_from_rd(rd), vec2f(0.0), vec2f(1.0));
  let p = uv * (dims - 1.0);
  let i0 = vec2i(floor(p));
  let i1 = min(i0 + vec2i(1, 1), vec2i(dims_u) - vec2i(1, 1));
  let f = fract(p);

  let c00 = textureLoad(background_sample_tex, i0, 0).rgb;
  let c10 = textureLoad(background_sample_tex, vec2i(i1.x, i0.y), 0).rgb;
  let c01 = textureLoad(background_sample_tex, vec2i(i0.x, i1.y), 0).rgb;
  let c11 = textureLoad(background_sample_tex, i1, 0).rgb;

  let c0 = mix(c00, c10, f.x);
  let c1 = mix(c01, c11, f.x);
  return mix(c0, c1, f.y);
}

fn glass_gbuffer_uv(uv_glass: vec2f) -> vec2f {
  var uv = uv_glass; uv.y = -uv.y;
  let dims_u = textureDimensions(glass_gbuffer);
  let res = vec2f(dims_u);
  return (uv * res.y + 0.5 * res) / res;
}

fn sample_glass_gbuffer(uv_glass: vec2f) -> vec4f {
  let uv = glass_gbuffer_uv(uv_glass);
  return textureSampleLevel(glass_gbuffer, linear_sampler, uv, 0.0);
}

fn normal_from_height_front(uv: vec2f) -> vec3f {
  let e = 0.0022;
  let h_l = sample_glass_gbuffer(uv - vec2f(e, 0.0)).r;
  let h_r = sample_glass_gbuffer(uv + vec2f(e, 0.0)).r;
  let h_d = sample_glass_gbuffer(uv - vec2f(0.0, e)).r;
  let h_u = sample_glass_gbuffer(uv + vec2f(0.0, e)).r;
  let g = vec2f(h_r - h_l, h_u - h_d) * (0.5 / e) * params.glass_a.z;
  return normalize(vec3f(-g.x, -g.y, 1.0));
}

fn normal_from_height_back(uv: vec2f) -> vec3f {
  let e = 0.0022;
  let h_l = sample_glass_gbuffer(uv - vec2f(e, 0.0)).g;
  let h_r = sample_glass_gbuffer(uv + vec2f(e, 0.0)).g;
  let h_d = sample_glass_gbuffer(uv - vec2f(0.0, e)).g;
  let h_u = sample_glass_gbuffer(uv + vec2f(0.0, e)).g;
  let g = vec2f(h_r - h_l, h_u - h_d) * (0.5 / e) * params.glass_a.z;
  return normalize(vec3f(-g.x, -g.y, 1.0));
}

struct GlassTrace {
  rd_out: vec3f,
  tg: vec3f,
  fresnel: f32,
  color_mask: vec3f,
};

fn trace_through_glass(rd_cam: vec3f, uv_glass: vec2f, xi: vec2f) -> GlassTrace {
  let roughness0 = sample_glass_gbuffer(uv_glass).b * params.glass_a.w;
  let n0g = normal_from_height_front(uv_glass);
  let n0m = sample_ggx_normal(n0g, fract(xi + vec2f(0.17, 0.73)), roughness0);
  var n0 = normalize(mix(n0g, n0m, 0.35));
  n0 = faceForward(n0, rd_cam, n0);

  // V8 physical toggles
  var ior = params.glass_b.x;
  var color_mask = vec3f(1.0);
  
  if (params.glass_b.z > 0.5) { // Dispersion
      let r = fract(xi.x + xi.y * 3.14);
      if (r < 0.333) {
          ior = ior - 0.01;
          color_mask = vec3f(3.0, 0.0, 0.0);
      } else if (r < 0.666) {
          color_mask = vec3f(0.0, 3.0, 0.0);
      } else {
          ior = ior + 0.01;
          color_mask = vec3f(0.0, 0.0, 3.0);
      }
  }

  if (params.glass_b.w > 0.5) { // Birefringence
      let r = fract(xi.x * 2.71 + xi.y * 1.41);
      if (r > 0.5) {
          n0 = normalize(n0 + vec3f(0.02, -0.02, 0.0));
      }
  }

  var rd_in = refract(rd_cam, n0, 1.0 / ior);
  let cos0 = clamp(dot(-rd_cam, n0), 0.0, 1.0);
  var fresnel = fresnel_schlick(cos0, 1.0, ior);

  if (length(rd_in) < 1e-5) {
    return GlassTrace(reflect(rd_cam, n0), vec3f(0.0), 1.0, color_mask);
  }

  let h0 = sample_glass_gbuffer(uv_glass).r;
  let h1 = sample_glass_gbuffer(uv_glass).g;
  let d = max(0.020, params.glass_a.x + params.glass_a.y * (h1 - h0));
  
  if (params.glass_b.y > 0.5) { // Milky Scattering
      let scatter = sample_ggx_normal(rd_in, fract(xi * 1.618), 0.5);
      rd_in = normalize(mix(rd_in, scatter, 0.4 * d));
  }

  let uv_back = uv_glass + rd_in.xy / max(rd_in.z, 1e-3) * d;

  let roughness1 = sample_glass_gbuffer(uv_back).b * params.glass_a.w;
  let n1g = normal_from_height_back(uv_back);
  let n1m = sample_ggx_normal(n1g, fract(xi.yx + vec2f(0.41, 0.19)), roughness1);
  var n1 = normalize(mix(n1g, n1m, 0.35));
  n1 = faceForward(n1, rd_in, n1);

  var rd_out = refract(rd_in, n1, ior);
  if (length(rd_out) < 1e-5) {
    rd_out = reflect(rd_in, n1);
    fresnel = 1.0;
  }

  let path_len = d / max(rd_in.z, 1e-3);
  let sigma_a = vec3f(0.018, 0.012, 0.008);
  let tg = exp(-sigma_a * path_len);
  return GlassTrace(rd_out, tg, fresnel, color_mask);
}

fn eval_interior_reflection(rd_cam: vec3f) -> vec3f {
  let w = 0.5 + 0.5 * rd_cam.y;
  return mix(vec3f(0.006, 0.007, 0.010), vec3f(0.012, 0.013, 0.017), w);
}

fn sample_window(frag_coord: vec2f, sample_index: f32) -> vec3f {
  let jitter = pixel_jitter(frag_coord, sample_index);
  let res = resolution();
  var p = ((frag_coord + jitter) - 0.5 * res) / res.y;
  p.y = -p.y;
  let ro = vec3f(0.0, 0.0, -params.sun_camera.z);
  let rd_cam = normalize(vec3f(p, params.sun_camera.w));
  let t_front = -ro.z / max(rd_cam.z, 1e-4);
  let p_front = ro + rd_cam * t_front;
  let uv = p_front.xy;
  let xi = sample_xi(frag_coord, sample_index);
  
  let trace = trace_through_glass(rd_cam, uv, xi);
  let l_out = sample_background_texture(normalize(trace.rd_out));
  let l_refl = eval_interior_reflection(rd_cam);

  var l = (1.0 - trace.fresnel) * trace.tg * l_out * trace.color_mask + trace.fresnel * l_refl;
  let vignette = 1.0 - smoothstep(0.15, 1.05, length(p));
  l = l * (0.92 + 0.08 * vignette);
  return l;
}

fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn confidence_from_state(state: PixelState) -> f32 {
  let count = state.mean_count.w;
  if (count < 2.0) { return 0.0; }
  let variance = max(state.luma_stats.y / max(count - 1.0, 1.0), 0.0);
  let std_err = sqrt(variance / max(count, 1.0));
  let rel_err = std_err / max(abs(state.luma_stats.x), 0.03);
  let abs_need = std_err / 0.008;
  let rel_need = rel_err / max(params.flags.w, 1e-3);
  return clamp(1.0 - max(rel_need, abs_need), 0.0, 1.0);
}

fn sample_budget(state: PixelState, frag_coord: vec2f) -> u32 {
  let base_s = max(u32(params.sampling.x), 1u);
  let max_s = max(u32(params.sampling.y), base_s);
  let count = state.mean_count.w;
  if (params.flags.x > 0.5 && count >= 12.0 && state.luma_stats.z >= 0.98) { return 0u; }
  if (params.flags.y < 0.5) { return base_s; }
  
  var rel_err = 1.0; var abs_err = 0.04;
  if (count > 1.0) {
    let variance = max(state.luma_stats.y / max(count - 1.0, 1.0), 0.0);
    let std_err = sqrt(variance / max(count, 1.0));
    rel_err = std_err / max(abs(state.luma_stats.x), 0.03);
    abs_err = std_err;
  }
  
  var p = (frag_coord - 0.5 * resolution()) / resolution().y; p.y = -p.y;
  let rd = normalize(vec3f(p, params.sun_camera.w));
  let sun_risk = pow(max(dot(rd, sun_dir()), 0.0), 64.0);
  let geom = sample_glass_gbuffer(p).b;
  let bootstrap = clamp(1.0 - count / 24.0, 0.0, 1.0);
  let dark_risk = clamp((0.08 - state.luma_stats.x) / 0.08, 0.0, 1.0);
  let bright_risk = clamp((state.luma_stats.x - 0.45) / 0.55, 0.0, 1.0);
  let need_rel = rel_err / max(params.flags.w, 1e-3);
  let need_abs = abs_err / 0.01;
  let need = clamp(max(need_rel, need_abs), 0.0, 2.5);
  let extra_f = (need * params.tuning.x + geom * 0.8 + sun_risk * 2.5 + bootstrap * 1.15 + dark_risk * 0.9 + bright_risk * 0.55) * f32(max_s - base_s);
  return base_s + u32(clamp(floor(extra_f), 0.0, f32(max_s - base_s)));
}

fn robust_sample(sample_rgb: vec3f, state: PixelState) -> vec3f {
  if (params.tuning.y <= 0.0 || state.mean_count.w < 16.0 || state.luma_stats.z < 0.65) { return sample_rgb; }
  let variance = max(state.luma_stats.y / max(state.mean_count.w - 1.0, 1.0), 0.0);
  let sigma = sqrt(variance); let lum = luminance(sample_rgb);
  let limit = max(state.luma_stats.x + params.tuning.y * sigma + 0.35, state.luma_stats.x * 4.5);
  if (lum <= limit || lum <= 0.0) { return sample_rgb; }
  return sample_rgb * (limit / lum);
}

fn update_state(state: PixelState, sample_rgb: vec3f) -> PixelState {
  var next_state = state; let sample_luma = luminance(sample_rgb);
  let old_count = next_state.mean_count.w; let new_count = old_count + 1.0;
  let next_mean_rgb = next_state.mean_count.xyz + (sample_rgb - next_state.mean_count.xyz) / new_count;
  next_state.mean_count = vec4f(next_mean_rgb, new_count);
  let delta_l = sample_luma - next_state.luma_stats.x;
  next_state.luma_stats.x = next_state.luma_stats.x + delta_l / new_count;
  let delta_l2 = sample_luma - next_state.luma_stats.x;
  next_state.luma_stats.y = next_state.luma_stats.y + delta_l * delta_l2;
  next_state.luma_stats.z = confidence_from_state(next_state);
  return next_state;
}

fn aces_film(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn tonemap_color(mean_rgb: vec3f) -> vec3f {
  var col = mean_rgb * params.tuning.z;
  let luma = luminance(col); col = mix(vec3f(luma), col, 1.08);
  col = aces_film(col); return pow(col, vec3f(1.0 / 2.2));
}

fn display_color(mean_rgb: vec3f, confidence: f32) -> vec3f {
  if (params.flags.z > 0.5) {
    let cold = vec3f(0.10, 0.16, 0.24); let warm = vec3f(0.99, 0.71, 0.18);
    return mix(cold, warm, confidence);
  }
  return tonemap_color(mean_rgb);
}

fn background_sample_budget(state: PixelState, rd: vec3f) -> u32 {
  if (params.flags.x > 0.5 && state.luma_stats.z >= 0.985 && state.mean_count.w >= 8.0) { return 0u; }
  let count = state.mean_count.w;
  var rel_err = 1.0; var abs_err = 0.03;
  if (count > 1.0) {
    let variance = max(state.luma_stats.y / max(count - 1.0, 1.0), 0.0);
    let std_err = sqrt(variance / max(count, 1.0));
    rel_err = std_err / max(abs(state.luma_stats.x), 0.03); abs_err = std_err;
  }
  let horizon_risk = exp(-18.0 * abs(rd.y));
  let sun_risk = pow(max(dot(rd, sun_dir()), 0.0), 96.0);
  let need_rel = rel_err / max(params.flags.w * 0.7, 1e-3);
  let need_abs = abs_err / 0.008;
  let bootstrap = clamp(1.0 - count / 12.0, 0.0, 1.0);
  let extra = clamp(max(need_rel, need_abs) + horizon_risk * 0.8 + sun_risk * 1.8 + bootstrap, 0.0, 3.0);
  return 1u + u32(floor(extra));
}

@compute @workgroup_size(8, 8, 1)
fn main_compute(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2u(u32(params.resolution_time.x), u32(params.resolution_time.y));
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let pixel_index = gid.y * dims.x + gid.x;
  let frag_coord = vec2f(vec2u(gid.xy)) + 0.5;
  var state = state_buffer[pixel_index];
  let spp = sample_budget(state, frag_coord);
  let start_index = state.mean_count.w;
  for (var s: u32 = 0u; s < spp; s = s + 1u) {
    let sample_index = start_index + f32(s);
    let sample_rgb = robust_sample(sample_window(frag_coord, sample_index), state);
    state = update_state(state, sample_rgb);
  }
  state_buffer[pixel_index] = state;
  atomicAdd(&frame_stats[0], spp);
  if (state.luma_stats.z >= 0.9) { atomicAdd(&frame_stats[1], 1u); }
  if (spp == 0u) { atomicAdd(&frame_stats[2], 1u); }
  if (spp > max(u32(params.sampling.x), 1u)) { atomicAdd(&frame_stats[3], 1u); }
  if (state.luma_stats.z < 0.5) { atomicAdd(&frame_stats[4], 1u); }
  if (state.luma_stats.x > 0.45 && state.luma_stats.z < 0.8) { atomicAdd(&frame_stats[5], 1u); }
  if (state.luma_stats.x < 0.08 && state.luma_stats.z < 0.8) { atomicAdd(&frame_stats[6], 1u); }
  let col = display_color(state.mean_count.xyz, state.luma_stats.z);
  textureStore(output_tex, vec2i(gid.xy), vec4f(col, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn main_background_compute(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(output_tex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let texel_index = gid.y * dims.x + gid.x;
  let uv = (vec2f(vec2u(gid.xy)) + 0.5) / vec2f(dims);
  let rd = background_rd_from_uv(uv);
  var state = state_buffer[texel_index];
  let spp = background_sample_budget(state, rd);
  let start_index = state.mean_count.w;
  for (var s: u32 = 0u; s < spp; s = s + 1u) {
    let sample_index = start_index + f32(s);
    let xi = sample_xi(vec2f(vec2u(gid.xy)) + 0.5, sample_index);
    let sample_rgb = sample_outdoor(rd, xi);
    state = update_state(state, sample_rgb);
  }
  state_buffer[texel_index] = state;
  atomicAdd(&frame_stats[0], spp);
  if (state.luma_stats.z >= 0.9) { atomicAdd(&frame_stats[1], 1u); }
  if (spp == 0u) { atomicAdd(&frame_stats[2], 1u); }
  if (spp > 1u) { atomicAdd(&frame_stats[3], 1u); }
  textureStore(output_tex, vec2i(gid.xy), vec4f(state.mean_count.xyz, 1.0));
}

struct VsOut {
  @builtin(position) position: vec4f,
};
@vertex
fn vs_fullscreen(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VsOut; out.position = vec4f(pos[vertex_index], 0.0, 1.0);
  return out;
}
@fragment
fn fs_display(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let color = textureLoad(display_sample_tex, vec2i(position.xy), 0);
  // params.flags.x must flow into the return value or the compiler dead-code-eliminates
  // group(0), breaking auto-layout bind group indices. Multiplying by 0.0 is NOT safe
  // (compiler can fold it); select with an always-false condition is opaque to DCE.
  return select(color, vec4f(0.0), params.flags.x < -1.0e38);
}

struct DebugParams {
  channel: f32,
  pad: vec3f,
};
@group(2) @binding(0) var<uniform> debug_params: DebugParams;

@fragment
fn fs_debug(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(glass_gbuffer));
  let uv = position.xy / dims;

  let channel = debug_params.channel;

  if (channel > 2.5) {
    // Background: tonemapped
    var p = uv * 2.0 - 1.0;
    p.y = -p.y;
    p.x *= resolution().x / resolution().y;
    let rd = normalize(vec3f(p, params.sun_camera.w));
    return vec4f(tonemap_color(sample_outdoor(rd, vec2f(0.5))), 1.0);
  }

  let g = textureSampleLevel(glass_gbuffer, linear_sampler, uv, 0.0);

  if (channel < 0.5) {
    // normal_from_height_front expects centered UVs in [-0.5, 0.5] because
    // glass_gbuffer_uv internally adds 0.5 to map to texture space [0, 1].
    let n = normal_from_height_front(uv - 0.5);
    let n_color = n * 0.5 + 0.5;
    return vec4f(n_color, 1.0);
  } else if (channel < 1.5) {
    return vec4f(vec3f(g.b), 1.0);
  } else {
    return vec4f(vec3f(g.r + 0.5), 1.0);
  }
}
