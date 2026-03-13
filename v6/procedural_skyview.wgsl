alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

struct SkyParams {
  sunDir: vec3f,
  time: f32,
  bgType: u32,
  skySize: vec2<u32>,
};

@group(0) @binding(0) var outSky : texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> P : SkyParams;

const PI : f32 = 3.141592653589793;

fn dirFromSkyUv(uv: vec2f) -> vec3f {
  let phi = (uv.x * 2.0 - 1.0) * PI;
  let y   = 1.0 - uv.y * 2.0;
  let r   = sqrt(max(1.0 - y * y, 0.0));
  return normalize(vec3f(sin(phi) * r, y, cos(phi) * r));
}

fn saturate(x : f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn hash11(p: f32) -> f32 { return fract(sin(p) * 43758.5453123); }
fn hash21_sunset(p : vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21_sunset(i);
  let b = hash21_sunset(i + vec2f(1.0, 0.0));
  let c = hash21_sunset(i + vec2f(0.0, 1.0));
  let d = hash21_sunset(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm_sunset(mut_p : vec2f) -> f32 {
  var p = mut_p;
  var v = 0.0;
  var a = 0.5;
  let rot = mat2x2<f32>(0.80, -0.60, 0.60, 0.80);
  for (var i : i32 = 0; i < 5; i = i + 1) {
    v = v + a * noise2(p);
    p = rot * p * 2.02 + vec2f(17.1, 13.7);
    a = a * 0.5;
  }
  return v;
}

// ==========================================
// Beach Sunset
// ==========================================
fn sunset_sky_color(rd : vec3f) -> vec3f {
  let t = saturate(rd.y / 0.5);
  let inv_t = 1.0 - t; 

  let topCol = vec3f(0.13, 0.03, 0.14);
  let midCol = vec3f(0.37, 0.05, 0.13);
  let horizonCol = vec3f(0.98, 0.26, 0.11);

  var col = mix(topCol, midCol, smoothstep(0.0, 0.55, inv_t));
  col = mix(col, horizonCol, smoothstep(0.48, 1.0, inv_t));
  col = col + vec3f(1.0, 0.28, 0.10) * pow(inv_t, 8.0) * 0.22;
  return col;
}

fn sunset_sun_disk(rd : vec3f, s_dir : vec3f, time : f32) -> vec3f {
  let mu = dot(rd, s_dir);
  let d = acos(clamp(mu, -1.0, 1.0)); 
  let radius = 0.06;
  
  let disk = 1.0 - smoothstep(radius, radius + 0.006, d);
  let glow = exp(-d * 9.16) * 0.774;

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

  col = col + vec3f(0.90, 0.22, 0.10) * reflection * sparkle * (0.18 + 0.45 * (1.0 - depth));

  let horizonSheen = 1.0 - smoothstep(0.0, 0.08, depth);
  col = col + vec3f(0.22, 0.05, 0.05) * horizonSheen * 0.35;

  let foamRegion = smoothstep(0.60, 1.0, depth);
  let foamNoise = fbm_sunset(vec2f(uv_x * 22.0, depth * 20.0 - time * 0.18));
  let foam = smoothstep(0.58, 0.76, foamNoise) * foamRegion;
  col = col + vec3f(0.75, 0.78, 0.85) * foam * 0.20;

  col = col * (1.0 - 0.12 * smoothstep(0.35, 1.0, depth) * smoothstep(0.45, 0.95, ripples));
  return col;
}

fn sample_beach_sunset(rd: vec3f, s_dir: vec3f, time: f32) -> vec3f {
  if (rd.y < 0.0) {
    var col = sunset_ocean_color(rd, s_dir, time);
    col = col + vec3f(1.0, 0.16, 0.08) * exp(-abs(rd.y) * 14.0) * 0.17;
    col = col + vec3f(0.16, 0.03, 0.04) * (1.0 - smoothstep(0.0, 0.15, abs(rd.y))) * 0.12;
    return col;
  } else {
    var col = sunset_sky_color(rd) + sunset_sun_disk(rd, s_dir, time);
    let d = acos(clamp(dot(rd, s_dir), -1.0, 1.0));
    let clouds = sunset_cloud_mask(rd, time);
    col = mix(col, vec3f(0.075, 0.040, 0.055), clouds * 0.92);
    col = col + vec3f(0.75, 0.12, 0.08) * exp(-d * 8.5) * 0.26 * clouds;
    col = col + vec3f(1.0, 0.16, 0.08) * exp(-abs(rd.y) * 14.0) * 0.17;
    col = col + vec3f(0.16, 0.03, 0.04) * (1.0 - smoothstep(0.0, 0.15, abs(rd.y))) * 0.12;
    return col;
  }
}

// ==========================================
// City Skyline
// ==========================================
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
  let ss = saturate(s_dir.y * -4.0 + 1.0);
  let band = exp(-40.0 * abs(rd.y));
  let base = vec3f(0.020, 0.018, 0.050);
  let warm = vec3f(0.85, 0.32, 0.13) * band * (0.25 + 0.75 * ss);
  let cool = vec3f(0.03, 0.04, 0.09) * smoothstep(-0.65, -0.05, rd.y);
  return base + warm + cool;
}

fn eval_buildings(rd: vec3f, s_dir: vec3f) -> vec3f {
  let x = rd.x / max(rd.z, 0.08);
  let h = skyline_height(x);
  let top_edge = exp(-150.0 * max(h - rd.y, 0.0));
  let facade = 0.5 + 0.5 * sin(x * 26.0 + floor((x + 2.0) * 12.0) * 0.37);
  var base = vec3f(0.050, 0.025, 0.070) + vec3f(0.030, 0.010, 0.050) * facade;
  base = base + vec3f(0.78, 0.24, 0.09) * top_edge * (0.35 + 0.85 * saturate(s_dir.y * -4.0 + 1.0));
  base = mix(base, vec3f(0.25, 0.18, 0.30), 0.14 * exp(-20.0 * max(rd.y, 0.0)));
  return base;
}

fn eval_sky_base(rd: vec3f, s_dir: vec3f) -> vec3f {
  let y = max(rd.y, 0.0);
  let d = acos(clamp(dot(rd, s_dir), -1.0, 1.0));
  
  let top = vec3f(0.12, 0.14, 0.45);
  let mid = vec3f(0.60, 0.30, 0.55);
  let hor = vec3f(0.95, 0.50, 0.15);
  
  var sky = mix(mid, top, smoothstep(0.0, 0.5, y));
  sky = mix(hor, sky, smoothstep(0.0, 0.15, y));
  
  let sunLobe = pow(max(dot(rd, s_dir), 0.0), 40.0) * 3.0;
  sky = sky + vec3f(1.0, 0.85, 0.6) * sunLobe;
  return sky;
}

fn sample_city_skyline(rd: vec3f, s_dir: vec3f) -> vec3f {
  if (rd.z <= 0.02) { return vec3f(0.0); }
  if (rd.y < 0.0) { return eval_ground(rd, s_dir); }
  let x = rd.x / max(rd.z, 0.08);
  if (rd.y < skyline_height(x)) { return eval_buildings(rd, s_dir); }
  return eval_sky_base(rd, s_dir);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= P.skySize.x || gid.y >= P.skySize.y) { return; }

  let uv = (vec2f(gid.xy) + 0.5) / vec2f(P.skySize);
  let rd = dirFromSkyUv(uv);
  let s_dir = normalize(P.sunDir);

  var col = vec3f(0.0);
  if (P.bgType == 0u) {
    col = sample_city_skyline(rd, s_dir);
  } else if (P.bgType == 1u) {
    col = sample_beach_sunset(rd, s_dir, P.time);
  }
  
  textureStore(outSky, vec2<i32>(gid.xy), vec4f(col, 1.0));
}