struct Params {
    resolution: vec2f,
    time: f32,
    samples: f32,
    microRoughness: f32,
    etaR: f32,
    etaG: f32,
    etaB: f32,
};

@group(0) @binding(0) var<uniform> params: Params;

// --- 1. SIGNAL GENERATION: HIGH-FREQUENCY MICRO-TOPOGRAPHY ---

fn hash22(p_in: vec2f) -> vec2f {
    var p = vec2f(dot(p_in, vec2f(127.1, 311.7)), dot(p_in, vec2f(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
}

fn smoothVoronoi(x: vec2f) -> f32 {
    let n = floor(x);
    let f = fract(x);
    var res = 0.0;

    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let g = vec2f(f32(i), f32(j));
            let r = g - f + hash22(n + g);
            let d = dot(r, r);
            res += exp(-12.0 * d);
        }
    }
    return -(1.0 / 12.0) * log(res);
}

fn evaluateGlassRelief(uv: vec2f) -> f32 {
    let h1 = smoothVoronoi(uv * 12.0);
    let h2 = smoothVoronoi(uv * 28.0 + vec2f(10.0, 15.0));
    let h3 = smoothVoronoi(uv * 55.0 - vec2f(30.0, 15.0));
    let macro_val = sin(uv.x * 2.0 + params.time * 0.1) * cos(uv.y * 3.0) * 0.1;
    return (h1 * 0.6 + h2 * 0.3 + h3 * 0.1) * 0.08 + macro_val;
}

// --- 2. DOMAIN DECOUPLING: INCIDENT RADIANCE FIELD ---

fn sampleSkyRadiance(dir: vec3f) -> vec3f {
    let elevation = dir.y;

    let zenith = vec3f(0.12, 0.14, 0.45);
    let midSky = vec3f(0.60, 0.30, 0.55);
    let horizon = vec3f(0.95, 0.50, 0.15);
    let ground = vec3f(0.02, 0.02, 0.04);

    var sky = mix(midSky, zenith, smoothstep(0.0, 0.5, elevation));
    sky = mix(horizon, sky, smoothstep(-0.1, 0.15, elevation));
    sky = mix(ground, sky, smoothstep(-0.2, -0.05, elevation));

    let sunDir = normalize(vec3f(0.4, 0.08, 1.0));
    let mu = max(dot(dir, sunDir), 0.0);
    let sunLobe = pow(mu, 40.0) * 3.0;

    sky += vec3f(1.0, 0.85, 0.6) * sunLobe;

    let clouds = sin(dir.x * 4.0) * cos(dir.y * 6.0 - dir.x * 3.0);
    sky *= mix(1.0, 0.5, smoothstep(0.0, 1.0, clouds) * smoothstep(0.1, -0.1, elevation));

    return max(sky, vec3f(0.0));
}

// --- VERTEX SHADER (Fullscreen Triangle) ---
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) fragCoord: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    let x = -1.0 + f32((vertex_index & 1u) << 2u);
    let y = -1.0 + f32((vertex_index & 2u) << 1u);
    var out: VertexOutput;
    out.position = vec4f(x, y, 0.0, 1.0);
    // Convert clip space [-1, 1] to screen coords [0, resolution]
    // WebGPU clip space Y is up, screen space Y is down.
    out.fragCoord = vec2f((x + 1.0) * 0.5 * params.resolution.x, (1.0 - y) * 0.5 * params.resolution.y); 
    return out;
}

// --- 3. THE OPTICAL ENGINE (MAIN INTEGRATION LOOP) ---

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let fragCoord = in.fragCoord;
    let uv = fragCoord.xy / params.resolution.xy;
    let aspectUV = (fragCoord.xy - 0.5 * params.resolution.xy) / params.resolution.y;

    let viewDir = normalize(vec3f(aspectUV * 0.05, 1.0));

    let e = vec2f(0.005, 0.0);
    let h = evaluateGlassRelief(aspectUV);
    let hx = evaluateGlassRelief(aspectUV + e.xy);
    let hy = evaluateGlassRelief(aspectUV + e.yx);
    let macroNormal = normalize(vec3f(h - hx, h - hy, e.x));

    let etaR = 1.0 / params.etaR;
    let etaG = 1.0 / params.etaG;
    let etaB = 1.0 / params.etaB;

    var color = vec3f(0.0);
    let SAMPLES = i32(params.samples);
    let microRoughness = params.microRoughness;
    let GOLDEN_ANGLE = 2.39996323;

    for (var i = 0; i < SAMPLES; i++) {
        let t = f32(i) / f32(SAMPLES);
        let r = sqrt(t) * microRoughness;
        let theta = f32(i) * GOLDEN_ANGLE;
        let offset = vec2f(cos(theta), sin(theta)) * r;

        let microN = normalize(macroNormal + vec3f(offset, 0.0));

        var rR = refract(viewDir, microN, etaR);
        var rG = refract(viewDir, microN, etaG);
        var rB = refract(viewDir, microN, etaB);

        if (dot(rR, rR) < 0.01) { rR = reflect(viewDir, microN); }
        if (dot(rG, rG) < 0.01) { rG = reflect(viewDir, microN); }
        if (dot(rB, rB) < 0.01) { rB = reflect(viewDir, microN); }

        color += vec3f(sampleSkyRadiance(rR).x, sampleSkyRadiance(rG).y, sampleSkyRadiance(rB).z);
    }

    color /= f32(SAMPLES);

    let R0 = 0.04;
    let cosTheta = max(dot(-viewDir, vec3f(0.0, 0.0, -1.0)), 0.0);
    let F = R0 + (1.0 - R0) * pow(1.0 - cosTheta, 5.0);
    color = mix(color, vec3f(0.01, 0.01, 0.015), F);

    color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);

    let dither = fract(sin(dot(fragCoord, vec2f(12.9898, 78.233))) * 43758.5453);
    color += vec3f((dither - 0.5) / 255.0);

    return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}