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
