// present.wgsl
alias vec2f = vec2<f32>;
alias vec4f = vec4<f32>;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@group(0) @binding(0) var linearSampler : sampler;
@group(0) @binding(1) var hdrTex : texture_2d<f32>;

@vertex
fn vsMain(@builtin(vertex_index) vid : u32) -> VSOut {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0,  1.0),
    vec2f( 3.0,  1.0)
  );

  var out : VSOut;
  let p = pos[vid];
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = 0.5 * vec2f(p.x + 1.0, 1.0 - p.y);
  return out;
}

fn aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4f {
  var c = textureSampleLevel(hdrTex, linearSampler, in.uv, 0.0).rgb;
  c *= 1.10;
  c = aces(c);
  c = pow(c, vec3<f32>(1.0 / 2.2));
  return vec4f(c, 1.0);
}
