// composite.wgsl
alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

struct FrameParams {
  outSize          : vec2<u32>,
  invOutSize       : vec2f,
  skySize          : vec2<u32>,
  frameIndex       : u32,
  dispersionScale  : f32,
  sigmaToLod       : f32,
  maxLod           : f32,
  absorptionR      : f32,
  absorptionG      : f32,
  absorptionB      : f32,
  sunHint          : vec2f,
  pad0             : vec2f,
};

@group(0) @binding(0) var linearSampler : sampler;
@group(0) @binding(1) var skyTex : texture_2d<f32>;
@group(0) @binding(2) var transport0 : texture_2d<f32>;
@group(0) @binding(3) var transport1 : texture_2d<f32>;
@group(0) @binding(4) var transport2 : texture_2d<f32>;
@group(0) @binding(5) var outHdr : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> P : FrameParams;

fn signNotZero(v: vec2f) -> vec2f {
  return vec2f(select(-1.0, 1.0, v.x >= 0.0), select(-1.0, 1.0, v.y >= 0.0));
}

fn octDecode(p: vec2f) -> vec3f {
  var v = vec3f(p.x, p.y, 1.0 - abs(p.x) - abs(p.y));
  if (v.z < 0.0) { 
    let tmp = (1.0 - abs(v.yx)) * signNotZero(v.xy); 
    v.x = tmp.x;
    v.y = tmp.y;
  }
  return normalize(v);
}

fn dirToSkyUV(d: vec3f) -> vec2f {
  let phi = atan2(d.x, -d.z);
  let theta = asin(d.y);
  return vec2f(phi / 6.2831853 + 0.5, 0.5 - theta / 3.14159265);
}

fn vogel(i: i32, n: i32, phi: f32) -> vec2f {
  let r = sqrt((f32(i) + 0.5) / f32(n));
  let a = f32(i) * 2.39996323 + phi;
  return r * vec2f(cos(a), sin(a));
}

fn interiorReflection(u: vec2f) -> vec3f {
  let ceiling = exp(-2.0 * max(-u.y, 0.0));
  let lamp    = exp(-120.0 * dot(u - vec2f(0.18, -0.42), u - vec2f(0.18, -0.42)));
  return vec3f(0.012, 0.014, 0.016) +
         vec3f(0.040, 0.036, 0.032) * ceiling +
         vec3f(0.10, 0.085, 0.055) * lamp;
}

fn sampleSky(uv: vec2f, axis: vec2f, sigma: vec2f, taps: i32, phi: f32, lodBias: f32) -> vec3f {
  let axis1 = vec2f(-axis.y, axis.x);
  let lod = clamp(log2(max(max(sigma.x, sigma.y), 1e-4) * P.sigmaToLod) + lodBias, 0.0, P.maxLod);

  var acc = vec3f(0.0);
  var wsum = 0.0;

  for (var i = 0; i < 12; i++) {
    if (i >= taps) { break; }
    let d = vogel(i, taps, phi);
    let off = axis * (d.x * sigma.x) + axis1 * (d.y * sigma.y);
    let w = exp(-2.0 * dot(d, d));
    let c = textureSampleLevel(skyTex, linearSampler, uv + off, lod).rgb;
    acc += w * c;
    wsum += w;
  }

  return acc / max(wsum, 1e-5);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= P.outSize.x || gid.y >= P.outSize.y) { return; }

  let pix = vec2f(vec2<u32>(gid.xy)) + 0.5;
  let uv = pix * P.invOutSize;

  let t0 = textureLoad(transport0, vec2<i32>(gid.xy), 0);
  let t1 = textureLoad(transport1, vec2<i32>(gid.xy), 0);
  let t2 = textureLoad(transport2, vec2<i32>(gid.xy), 0);

  let shift = t0.xy;
  let pathLen = t0.z;
  let F = clamp(t0.w, 0.0, 1.0);

  let axis = normalize(select(vec2f(1.0, 0.0), t1.xy, dot(t1.xy, t1.xy) > 1e-6));
  let sigmaMain = max(t1.zw, vec2f(0.003, 0.003));

  let tir = t2.x;
  let haloWeight = t2.y;
  let rough = t2.z;
  let transmitted = t2.w;

  // adaptive taps
  let importance = max(sigmaMain.x, sigmaMain.y) + 0.25 * rough + 0.25 * tir;
  let tapsMain = select(4, select(8, 12, importance > 0.03), importance > 0.015);
  let tapsHalo = select(4, 8, importance > 0.02);

  let phi = fract(sin(dot(uv + vec2f(f32(P.frameIndex) * 0.017), vec2f(12.9898, 78.233))) * 43758.5453)
          * 6.2831853;

  let outDir = octDecode(shift);
  let skyUV = dirToSkyUV(outDir);
  let sigmaHalo = 1.7 * sigmaMain + vec2f(0.008 + 0.012 * tir);

  let reflection = interiorReflection((uv * 2.0 - 1.0));

  var color = vec3f(0.0);

  // Lightweight RGB dispersion
  let disp = axis * P.dispersionScale * (0.7 + 8.0 * max(sigmaMain.x, sigmaMain.y));

  let mainR = sampleSky(skyUV - disp, axis, sigmaMain, tapsMain, phi, 0.0).r;
  let mainG = sampleSky(skyUV,       axis, sigmaMain, tapsMain, phi, 0.0).g;
  let mainB = sampleSky(skyUV + disp, axis, sigmaMain, tapsMain, phi, 0.0).b;

  let haloR = sampleSky(skyUV - disp, axis, sigmaHalo, tapsHalo, phi + 1.1, 0.5).r;
  let haloG = sampleSky(skyUV,        axis, sigmaHalo, tapsHalo, phi + 1.1, 0.5).g;
  let haloB = sampleSky(skyUV + disp, axis, sigmaHalo, tapsHalo, phi + 1.1, 0.5).b;

  let Tmain = vec3f(mainR, mainG, mainB);
  let Thalo = vec3f(haloR, haloG, haloB);
  let T = mix(Tmain, Thalo, haloWeight);

  let absorb = vec3f(
    exp(-P.absorptionR * pathLen),
    exp(-P.absorptionG * pathLen),
    exp(-P.absorptionB * pathLen)
  );

  color = F * reflection + (1.0 - F) * absorb * T * transmitted;

  textureStore(outHdr, vec2<i32>(gid.xy), vec4f(color, 1.0));
}
