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

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var glass_gbuffer: texture_2d<f32>;
@group(0) @binding(3) var linear_sampler: sampler;
@group(0) @binding(4) var background_sample_tex: texture_2d<f32>;

const PI: f32 = 3.14159265358979323846;

fn resolution() -> vec2f {
  return params.resolution_time.xy;
}

fn scene_time() -> f32 {
  if (params.flags.x > 0.5) {
    return 0.0;
  }
  return params.resolution_time.z;
}

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

fn sun_dir() -> vec3f {
  let az = params.sun_camera.x;
  let el = params.sun_camera.y;
  return normalize(vec3f(sin(az) * cos(el), sin(el), cos(az) * cos(el)));
}

fn sunsetness(s_dir: vec3f) -> f32 {
  return 1.0 - smoothstep(0.05, 0.30, s_dir.y);
}

// Procedural outdoor environment
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
  var base = vec3f(0.050, 0.025, 0.070) + vec3f(0.030, 0.010, 0.050) * facade;
  base = base + vec3f(0.78, 0.24, 0.09) * top_edge * (0.35 + 0.85 * ss);
  let haze = exp(-20.0 * max(y, 0.0));
  base = mix(base, vec3f(0.25, 0.18, 0.30), 0.14 * haze);
  return base;
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

const TAU: f32 = 6.28318530717958647692;

fn sample_outdoor(rd: vec3f) -> vec3f {
  let theta = acos(clamp(rd.y, -1.0, 1.0)); // 0 to pi
  let phi = atan2(rd.z, rd.x); // -pi to pi
  let u = fract(phi / TAU);
  let v = theta / PI;
  return textureSampleLevel(background_sample_tex, linear_sampler, vec2f(u, v), 0.0).rgb;
}

fn glass_gbuffer_uv(uv_glass: vec2f) -> vec2f {
  var uv = uv_glass;
  uv.y = -uv.y;
  let dims_u = textureDimensions(glass_gbuffer);
  let res = vec2f(dims_u);
  return (uv * res.y + 0.5 * res) / res;
}

fn sample_glass_gbuffer(uv_glass: vec2f) -> vec4f {
  let uv = glass_gbuffer_uv(uv_glass);
  return textureSampleLevel(glass_gbuffer, linear_sampler, uv, 0.0);
}

fn glass_height_front(uv: vec2f) -> f32 { return sample_glass_gbuffer(uv).r; }
fn glass_height_back(uv: vec2f) -> f32 { return sample_glass_gbuffer(uv).g; }
fn glass_complexity(uv: vec2f) -> f32 { return sample_glass_gbuffer(uv).b; }

fn normal_from_height_front(uv: vec2f) -> vec3f {
  let e = 0.0022;
  let h_l = glass_height_front(uv - vec2f(e, 0.0));
  let h_r = glass_height_front(uv + vec2f(e, 0.0));
  let h_d = glass_height_front(uv - vec2f(0.0, e));
  let h_u = glass_height_front(uv + vec2f(0.0, e));
  let g = vec2f(h_r - h_l, h_u - h_d) * (0.5 / e) * params.glass_a.z;
  return normalize(vec3f(g.x, g.y, -1.0));
}

fn normal_from_height_back(uv: vec2f) -> vec3f {
  let e = 0.0022;
  let h_l = glass_height_back(uv - vec2f(e, 0.0));
  let h_r = glass_height_back(uv + vec2f(e, 0.0));
  let h_d = glass_height_back(uv - vec2f(0.0, e));
  let h_u = glass_height_back(uv + vec2f(0.0, e));
  let g = vec2f(h_r - h_l, h_u - h_d) * (0.5 / e) * params.glass_a.z;
  return normalize(vec3f(g.x, g.y, -1.0));
}

fn fresnel_schlick(cos_theta: f32, eta_i: f32, eta_t: f32) -> f32 {
  var f0 = (eta_i - eta_t) / (eta_i + eta_t);
  f0 = f0 * f0;
  return f0 + (1.0 - f0) * pow(1.0 - cos_theta, 5.0);
}

struct GlassTrace {
  rd_out: vec3f,
  tg: vec3f,
  fresnel: f32,
};

fn trace_through_glass_analytical(rd_cam: vec3f, uv_glass: vec2f) -> GlassTrace {
  let n0 = normal_from_height_front(uv_glass);
  
  var rd_in = refract(rd_cam, n0, 1.0 / params.glass_b.x);
  let cos0 = clamp(dot(-rd_cam, n0), 0.0, 1.0);
  var fresnel = fresnel_schlick(cos0, 1.0, params.glass_b.x);

  if (length(rd_in) < 1e-5) {
    return GlassTrace(reflect(rd_cam, n0), vec3f(0.0), 1.0);
  }

  let h0 = glass_height_front(uv_glass);
  let h1 = glass_height_back(uv_glass);
  let d = max(0.020, params.glass_a.x + params.glass_a.y * (h1 - h0));
  let uv_back = uv_glass + rd_in.xy / max(rd_in.z, 1e-3) * d;

  var n1 = normal_from_height_back(uv_back);
  n1 = faceForward(n1, rd_in, n1);

  var rd_out = refract(rd_in, n1, params.glass_b.x);
  if (length(rd_out) < 1e-5) {
    rd_out = reflect(rd_in, n1);
    fresnel = 1.0;
  }

  let path_len = d / max(rd_in.z, 1e-3);
  let sigma_a = vec3f(0.018, 0.012, 0.008);
  let tg = exp(-sigma_a * path_len);
  return GlassTrace(rd_out, tg, fresnel);
}

fn eval_interior_reflection(rd_cam: vec3f) -> vec3f {
  let w = 0.5 + 0.5 * rd_cam.y;
  return mix(vec3f(0.006, 0.007, 0.010), vec3f(0.012, 0.013, 0.017), w);
}

fn tonemap(color: vec3f) -> vec3f {
  var col = color * params.tuning.z;
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  col = clamp((col * (a * col + b)) / (col * (c * col + d) + e), vec3f(0.0), vec3f(1.0));
  return pow(col, vec3f(1.0 / 2.2));
}

@compute @workgroup_size(16, 16, 1)
fn main_compute(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2u(u32(params.resolution_time.x), u32(params.resolution_time.y));
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let frag_coord = vec2f(vec2u(gid.xy)) + 0.5;
  let res = resolution();
  var p = (frag_coord - 0.5 * res) / res.y;
  p.y = -p.y;

  let ro = vec3f(0.0, 0.0, -params.sun_camera.z);
  let rd_cam = normalize(vec3f(p, params.sun_camera.w));
  let t_front = -ro.z / max(rd_cam.z, 1e-4);
  let p_front = ro + rd_cam * t_front;
  let uv = p_front.xy;

  let trace = trace_through_glass_analytical(rd_cam, uv);
  
  // Deterministic Analytic Blur using Vogel Disk
  let roughness = glass_complexity(uv);
  let blur_radius = mix(0.005, 0.15, roughness); // Scale blur by roughness
  let s_dir = sun_dir();
  
  var l_out = vec3f(0.0);
  let num_samples = 16u;
  let golden_angle = 2.39996323; // pi * (3 - sqrt(5))
  
  for (var i = 0u; i < num_samples; i = i + 1u) {
    let r = sqrt(f32(i) + 0.5) / sqrt(f32(num_samples));
    let theta = f32(i) * golden_angle;
    
    // Offset the outgoing ray
    let offset = vec2f(cos(theta), sin(theta)) * r * blur_radius;
    
    // Create an orthogonal basis around trace.rd_out to apply offset
    let up = vec3f(0.0, 1.0, 0.0);
    let right = normalize(cross(up, trace.rd_out));
    let top = cross(trace.rd_out, right);
    
    let sample_rd = normalize(trace.rd_out + right * offset.x + top * offset.y);
    l_out = l_out + sample_outdoor(sample_rd);
  }
  l_out = l_out / f32(num_samples);
  
  let l_refl = eval_interior_reflection(rd_cam);

  var l = (1.0 - trace.fresnel) * trace.tg * l_out + trace.fresnel * l_refl;
  let vignette = 1.0 - smoothstep(0.15, 1.05, length(p));
  l = l * (0.92 + 0.08 * vignette);

  textureStore(output_tex, vec2i(gid.xy), vec4f(l, 1.0));
}

struct VsOut {
  @builtin(position) position: vec4f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VsOut;
  out.position = vec4f(pos[vertex_index], 0.0, 1.0);
  return out;
}

@group(1) @binding(0) var display_tex: texture_2d<f32>;

@fragment
fn fs_display(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dummy = params.flags.x; // Force layout to preserve group 0
  let pixel = vec2i(position.xy);
  let color = textureLoad(display_tex, pixel, 0).rgb;
  return vec4f(tonemap(color), 1.0);
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
    // Re-create direction from uv
    var p = uv - 0.5;
    p.y = -p.y;
    p.x *= resolution().x / resolution().y;
    let rd = normalize(vec3f(p, params.sun_camera.w));
    return vec4f(tonemap(sample_outdoor(rd)), 1.0);
  }

  let g = textureSampleLevel(glass_gbuffer, linear_sampler, uv, 0.0);

  if (channel < 0.5) {
    let n = normal_from_height_front(uv);
    let n_color = n * 0.5 + 0.5;
    return vec4f(n_color, 1.0);
  } else if (channel < 1.5) {
    return vec4f(vec3f(g.b), 1.0);
  } else {
    return vec4f(vec3f(g.r + 0.5), 1.0);
  }
}
