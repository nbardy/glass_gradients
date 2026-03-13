@group(0) @binding(0) var out_tex: texture_storage_2d<rgba16float, write>;

struct GlassParams {
    scale: f32,
    pattern_type: f32,
    front_offset: vec2f,
    back_offset: vec2f,
    distortion: f32,
    roughness: f32,
}
@group(0) @binding(1) var<uniform> params: GlassParams;

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn hash22(p: vec2f) -> vec2f {
  let n = sin(dot(p, vec2f(41.0, 289.0)));
  return fract(vec2f(262144.0, 32768.0) * n);
}

fn voronoi(x: vec2f) -> vec3f {
    let n = floor(x);
    let f = fract(x);
    
    var m = vec3f(8.0);
    for(var j = -1; j <= 1; j++) {
        for(var i = -1; i <= 1; i++) {
            let g = vec2f(f32(i), f32(j));
            let o = hash22(n + g);
            // Animate or shift based on hash
            let r = g - f + o;
            let d = dot(r, r);
            if(d < m.x) {
                m = vec3f(d, o.x, o.y);
            }
        }
    }
    return vec3f(sqrt(m.x), m.y, m.z);
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

fn glass_base(uv: vec2f) -> f32 {
  let p_type = u32(params.pattern_type);
  var p = uv * params.scale * 18.0;

  if (p_type == 0u) {
    // FBM Wavy
    let w = vec2f(
      fbm(p * 0.45 + vec2f(1.3, 4.7)),
      fbm(p * 0.45 + vec2f(8.1, 2.6))
    );
    p = p + 2.4 * (w - 0.5) * params.distortion;

    var h = 0.55 * noise2(p) +
      0.24 * noise2(p * 2.13 + 13.7) +
      0.12 * noise2(p * 4.07 + 7.1) +
      0.07 * noise2(p * 8.21 + 1.9);

    return smoothstep(0.22, 0.88, h);

  } else if (p_type == 1u) {
    // Frosted Flat
    let n = hash21(uv * 1000.0);
    return n * 0.02 * params.distortion;

  } else if (p_type == 2u) {
    // Pebbled / Cellular
    let v = voronoi(p * 0.4);
    var h = 1.0 - v.x;
    h = h + params.distortion * 0.1 * noise2(p * 2.0);
    return h * 0.4;

  } else if (p_type == 3u) {
    // Ribbed / Fluted
    let w = sin(p.y * 0.1) * params.distortion * 0.2;
    let wave = sin((p.x + w) * 2.0);
    var h = wave * 0.5 + 0.5;
    h = smoothstep(0.1, 0.9, h);
    return h * 0.2;
  }

  return 0.0;
}

fn glass_height_front(uv: vec2f) -> f32 {
  var h = glass_base(uv * 1.05 + params.front_offset);
  if (u32(params.pattern_type) == 0u) {
      h = h + 0.08 * (noise2(uv * 42.0 + 4.0) - 0.5);
  }
  return h;
}

fn glass_height_back(uv: vec2f) -> f32 {
  var h = glass_base(uv * 1.01 + params.back_offset);
  if (u32(params.pattern_type) == 0u) {
      h = h + 0.05 * (noise2(uv * 38.0 + 17.0) - 0.5);
  }
  return h;
}

fn normal_from_height_front(uv: vec2f) -> vec3f {
  let e = 0.0022;
  let h_l = glass_height_front(uv - vec2f(e, 0.0));
  let h_r = glass_height_front(uv + vec2f(e, 0.0));
  let h_d = glass_height_front(uv - vec2f(0.0, e));
  let h_u = glass_height_front(uv + vec2f(0.0, e));
  let g = vec2f(h_r - h_l, h_u - h_d) * (0.5 / e);
  return normalize(vec3f(-g.x, -g.y, 1.0));
}

fn normal_from_height_back(uv: vec2f) -> vec3f {
  let e = 0.0022;
  let h_l = glass_height_back(uv - vec2f(e, 0.0));
  let h_r = glass_height_back(uv + vec2f(e, 0.0));
  let h_d = glass_height_back(uv - vec2f(0.0, e));
  let h_u = glass_height_back(uv + vec2f(0.0, e));
  let g = vec2f(h_r - h_l, h_u - h_d) * (0.5 / e);
  return normalize(vec3f(-g.x, -g.y, 1.0));
}

fn glass_complexity(uv: vec2f) -> f32 {
  let n0 = normal_from_height_front(uv);
  let n1 = normal_from_height_back(uv);
  let slope = length(n0.xy) + length(n1.xy);
  return clamp(slope * 1.5, 0.0, 1.0);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let dims = textureDimensions(out_tex);
  if (global_id.x >= dims.x || global_id.y >= dims.y) {
    return;
  }

  let res = vec2f(f32(dims.x), f32(dims.y));
  let frag_coord = vec2f(f32(global_id.x), f32(global_id.y));
  
  var uv = (frag_coord - 0.5 * res) / res.y;
  uv.y = -uv.y;

  let h_front = glass_height_front(uv);
  let h_back = glass_height_back(uv);
  
  var complexity = glass_complexity(uv);
  if (u32(params.pattern_type) == 1u) {
      complexity = params.roughness + 0.8; 
  } else {
      complexity = clamp(complexity + params.roughness, 0.0, 1.0);
  }

  let mask = 1.0;
  let out_val = vec4f(h_front, h_back, complexity, mask);
  textureStore(out_tex, vec2<i32>(global_id.xy), out_val);
}