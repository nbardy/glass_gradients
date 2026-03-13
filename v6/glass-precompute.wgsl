// glass-precompute.wgsl
alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

struct GlassParams {
  outSize      : vec2<u32>,
  invOutSize   : vec2f,
  aspect       : f32,
  cameraDist   : f32,
  thickness    : f32,
  frontLfAmp   : f32,
  frontHfAmp   : f32,
  backLfAmp    : f32,
  backHfAmp    : f32,
  etaGlass     : f32,
  pad0         : vec3f,
};

@group(0) @binding(0) var outTransport0 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var outTransport1 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var outTransport2 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> P : GlassParams;

fn hash12(p: vec2f) -> f32 {
  let q = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  let d = dot(q, q.yzx + 33.33);
  return fract((q.x + q.y + d) * q.z);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i + vec2f(0.0, 0.0));
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(mut_p: vec2f) -> f32 {
  var p = mut_p;
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = mat2x2<f32>(0.82, -0.57, 0.57, 0.82) * p * 2.03 + 7.13;
    a *= 0.5;
  }
  return v;
}

fn voronoiF1(x: vec2f) -> f32 {
  let n = floor(x);
  let f = fract(x);
  var md = 1e9;

  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = vec2f(hash12(n + g), hash12(n + g + 17.0));
      let r = g + o - f;
      md = min(md, dot(r, r));
    }
  }
  return sqrt(md);
}

fn pebbleMaster(u: vec2f) -> f32 {
  let d1 = voronoiF1(u * 2.40);
  let d2 = voronoiF1(u * 4.10 + vec2f(4.1, -1.7));

  let a = exp(-7.0 * d1 * d1);
  let b = exp(-8.5 * d2 * d2);
  let h = 0.75 * a + 0.30 * b + 0.18 * fbm(u * 3.0 + 1.3);

  return smoothstep(0.18, 1.00, h);
}

fn frontLF(u: vec2f) -> f32 {
  let h = pebbleMaster(u * 1.05 + vec2f(0.03, -0.01));
  return P.frontLfAmp * (h - 0.50);
}

fn frontHF(u: vec2f) -> f32 {
  let h = 0.60 * (fbm(u * 18.0 + 3.7) - 0.5) +
          0.40 * (fbm(u * 34.0 - 8.2) - 0.5);
  return P.frontHfAmp * h;
}

fn backLF(u: vec2f) -> f32 {
  let h = pebbleMaster(u * 1.02 + vec2f(-0.018, 0.027));
  let c = frontLF(u * 0.99 + vec2f(0.01, -0.01)) / max(P.frontLfAmp, 1e-5);
  let mixh = mix(h - 0.5, c, 0.70);
  return P.thickness + P.backLfAmp * mixh;
}

fn backHF(u: vec2f) -> f32 {
  let h = 0.70 * (fbm(u * 16.0 + 14.3) - 0.5) +
          0.30 * (fbm(u * 28.0 +  2.1) - 0.5);
  return P.backHfAmp * h;
}

fn gradFrontLF(u: vec2f) -> vec2f {
  let e = 0.0025;
  return vec2f(
    frontLF(u + vec2f(e, 0.0)) - frontLF(u - vec2f(e, 0.0)),
    frontLF(u + vec2f(0.0, e)) - frontLF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn gradBackLF(u: vec2f) -> vec2f {
  let e = 0.0025;
  return vec2f(
    backLF(u + vec2f(e, 0.0)) - backLF(u - vec2f(e, 0.0)),
    backLF(u + vec2f(0.0, e)) - backLF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn gradFrontHF(u: vec2f) -> vec2f {
  let e = 0.0015;
  return vec2f(
    frontHF(u + vec2f(e, 0.0)) - frontHF(u - vec2f(e, 0.0)),
    frontHF(u + vec2f(0.0, e)) - frontHF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn gradBackHF(u: vec2f) -> vec2f {
  let e = 0.0015;
  return vec2f(
    backHF(u + vec2f(e, 0.0)) - backHF(u - vec2f(e, 0.0)),
    backHF(u + vec2f(0.0, e)) - backHF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn normalFromGrad(g: vec2f) -> vec3f {
  return normalize(vec3f(-g.x, -g.y, 1.0));
}

fn fresnelDielectric(cosi: f32, etaI: f32, etaT: f32) -> f32 {
  let e = etaI / etaT;
  let sint2 = e * e * max(0.0, 1.0 - cosi * cosi);
  if (sint2 >= 1.0) { return 1.0; }
  let cost = sqrt(max(0.0, 1.0 - sint2));
  let Rs = (etaI * cosi - etaT * cost) / (etaI * cosi + etaT * cost);
  let Rp = (etaT * cosi - etaI * cost) / (etaT * cosi + etaI * cost);
  return 0.5 * (Rs * Rs + Rp * Rp);
}

fn refractDielectric(I: vec3f, Nin: vec3f, etaI: f32, etaT: f32) -> vec4f {
  var N = Nin;
  var cosi = dot(-I, N);
  if (cosi < 0.0) {
    N = -N;
    cosi = -cosi;
  }

  let F = fresnelDielectric(clamp(cosi, 0.0, 1.0), etaI, etaT);
  let eta = etaI / etaT;
  let k = 1.0 - eta * eta * (1.0 - cosi * cosi);

  if (k < 0.0) {
    return vec4f(0.0, 0.0, 0.0, -1.0); // TIR
  }

  let T = normalize(eta * I + (eta * cosi - sqrt(k)) * N);
  return vec4f(T, F);
}

fn surfaceZ(backSide: bool, xy: vec2f) -> f32 {
  return select(frontLF(xy), backLF(xy), backSide);
}

fn surfaceEval(backSide: bool, ro: vec3f, rd: vec3f, t: f32) -> f32 {
  let p = ro + rd * t;
  return p.z - surfaceZ(backSide, p.xy);
}

fn solveSurface(backSide: bool, ro: vec3f, rd: vec3f, tMaxInit: f32) -> vec2f {
  var a = 1e-4;
  var b = max(tMaxInit, 0.02);
  var fa = surfaceEval(backSide, ro, rd, a);
  var fb = surfaceEval(backSide, ro, rd, b);

  for (var i = 0; i < 6; i++) {
    if (fa * fb <= 0.0) { break; }
    b *= 1.6;
    fb = surfaceEval(backSide, ro, rd, b);
  }

  if (fa * fb > 0.0) {
    return vec2f(-1.0, 0.0);
  }

  for (var i = 0; i < 10; i++) {
    var m = 0.5 * (a + b);
    let denom = fb - fa;
    if (abs(denom) > 1e-7) {
      m = clamp((a * fb - b * fa) / denom, a + 1e-4, b - 1e-4);
    }
    let fm = surfaceEval(backSide, ro, rd, m);
    if (fa * fm <= 0.0) {
      b = m;
      fb = fm;
    } else {
      a = m;
      fa = fm;
    }
  }

  return vec2f(0.5 * (a + b), 1.0);
}

fn signNotZero(v: vec2f) -> vec2f {
  return vec2f(select(-1.0, 1.0, v.x >= 0.0), select(-1.0, 1.0, v.y >= 0.0));
}

fn octEncode(v: vec3f) -> vec2f {
  var p = v.xy * (1.0 / (abs(v.x) + abs(v.y) + abs(v.z)));
  if (v.z < 0.0) { p = (1.0 - abs(p.yx)) * signNotZero(p); }
  return p;
}

fn buildEllipse(u: vec2f) -> vec4f {
  let gf = gradFrontHF(u);
  let gb = gradBackHF(u);
  let rough = sqrt(dot(gf, gf) + dot(gb, gb));

  let axis = normalize(select(vec2f(1.0, 0.0), gf, dot(gf, gf) > 1e-8));
  let sigmaMajor = 0.006 + 0.05 * rough;
  let sigmaMinor = 0.004 + 0.02 * rough;

  return vec4f(axis, sigmaMajor, sigmaMinor);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= P.outSize.x || gid.y >= P.outSize.y) { return; }

  let pix = vec2f(vec2<u32>(gid.xy)) + 0.5;
  var u = pix * P.invOutSize * 2.0 - 1.0;
  u.x *= P.aspect;

  let cam = vec3f(0.0, 0.0, -P.cameraDist);
  let ray = normalize(vec3f(u, P.cameraDist));

  // Front hit
  let frontHit = solveSurface(false, cam, ray, P.cameraDist + 0.2);
  if (frontHit.y < 0.5) {
    textureStore(outTransport0, vec2<i32>(gid.xy), vec4f(0.0, 0.0, P.thickness, 0.04));
    textureStore(outTransport1, vec2<i32>(gid.xy), vec4f(1.0, 0.0, 0.01, 0.01));
    textureStore(outTransport2, vec2<i32>(gid.xy), vec4f(0.0, 0.05, 0.0, 0.0));
    return;
  }

  let pFront = cam + ray * frontHit.x;
  let nFront = normalFromGrad(gradFrontLF(pFront.xy));

  let enter = refractDielectric(ray, -nFront, 1.0, P.etaGlass);
  let F = max(enter.w, 0.0);

  if (enter.w < 0.0) {
    textureStore(outTransport0, vec2<i32>(gid.xy), vec4f(0.0, 0.0, 0.0, 1.0));
    textureStore(outTransport1, vec2<i32>(gid.xy), vec4f(1.0, 0.0, 0.0, 0.0));
    textureStore(outTransport2, vec2<i32>(gid.xy), vec4f(1.0, 1.0, 1.0, 0.0));
    return;
  }

  var p = pFront + enter.xyz * 1e-4;
  var d = enter.xyz;
  var pathLen = 0.0;
  var tir = 0.0;
  var transmitted = false;
  var outDir = ray;

  for (var bounce = 0; bounce < 4; bounce++) {
    let towardBack = d.z > 0.0;
    let hit = solveSurface(towardBack, p, d, P.thickness / max(abs(d.z), 1e-3) + 0.04);
    if (hit.y < 0.5) { break; }

    pathLen += hit.x;
    p = p + d * hit.x;

    let nGeom = select(normalFromGrad(gradFrontLF(p.xy)), normalFromGrad(gradBackLF(p.xy)), towardBack);
    let Nincident = select(nGeom, -nGeom, towardBack);
    let ext = refractDielectric(d, Nincident, P.etaGlass, 1.0);

    if (ext.w >= 0.0 && towardBack) {
      transmitted = true;
      outDir = ext.xyz;
      break;
    }

    if (ext.w < 0.0) {
      // TIR
      d = reflect(d, nGeom);
      p = p + d * 1e-4;
      tir += 1.0;
    } else {
      // escaped toward camera side; stop
      break;
    }
  }

  // Always store outgoing direction (oct-encoded). If not transmitted, just use original ray direction.
  let finalDir = select(ray, outDir, transmitted);
  let shift = octEncode(normalize(finalDir));

  let ell = buildEllipse(u);
  let rough = sqrt(dot(gradFrontHF(u), gradFrontHF(u)) + dot(gradBackHF(u), gradBackHF(u)));
  let halo = clamp(0.05 + 0.55 * (tir / 4.0) + 2.8 * rough + 0.10 * F, 0.0, 1.0);

  textureStore(outTransport0, vec2<i32>(gid.xy), vec4f(shift, pathLen, F));
  textureStore(outTransport1, vec2<i32>(gid.xy), ell);
  textureStore(outTransport2, vec2<i32>(gid.xy), vec4f(tir / 4.0, halo, rough, select(0.0, 1.0, transmitted)));
}
