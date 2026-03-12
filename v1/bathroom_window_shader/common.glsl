#define PI  3.14159265358979323846
#define TAU 6.28318530717958647692

#define SCENE_STATIC 1

const int   SAMPLES_PER_FRAME = 2;
const int   CLOUD_STEPS       = 8;
const int   SUN_SHADOW_STEPS  = 3;

const float CAMERA_Z          = 1.65;
const float CAMERA_FOCAL      = 1.85;
const float GLASS_THICKNESS   = 0.060;
const float GLASS_HEIGHT_AMPL = 0.010;
const float GLASS_BUMP        = 0.190;
const float GLASS_ROUGHNESS   = 0.085;
const float GLASS_IOR         = 1.52;

const float SUN_AZIMUTH       = 0.58;
const float SUN_ELEVATION     = 0.055;

float sceneTime()
{
#if SCENE_STATIC == 1
    return 0.0;
#else
    return iTime;
#endif
}

float hash11(float p)
{
    return fract(sin(p * 127.1) * 43758.5453123);
}

float hash21(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p)
{
    float n = sin(dot(p, vec2(41.0, 289.0)));
    return fract(vec2(262144.0, 32768.0) * n);
}

float noise2(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i + vec2(0.0, 0.0));
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p)
{
    float s = 0.0;
    float a = 0.5;
    mat2  m = mat2(1.6, 1.2, -1.2, 1.6);

    for (int i = 0; i < 5; ++i)
    {
        s += a * noise2(p);
        p  = m * p;
        a *= 0.5;
    }
    return s;
}

vec2 r2Sequence(float n)
{
    return fract((n + 1.0) * vec2(0.7548776662466927, 0.5698402909980532));
}

vec2 sampleXi(vec2 fragCoord, int sampleId)
{
    float n = float(iFrame * SAMPLES_PER_FRAME + sampleId);
    vec2  a = r2Sequence(n);
    vec2  b = hash22(fragCoord + vec2(19.13, 73.71) * float(sampleId + 1));
    return fract(a + b);
}

vec2 pixelJitter(vec2 fragCoord, int sampleId)
{
    return sampleXi(fragCoord, sampleId) - 0.5;
}

vec2 boxMuller(vec2 u)
{
    float r   = sqrt(-2.0 * log(max(u.x, 1e-6)));
    float phi = TAU * u.y;
    return r * vec2(cos(phi), sin(phi));
}

void makeBasis(vec3 n, out vec3 t, out vec3 b)
{
    vec3 up = (abs(n.z) < 0.999) ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
}

vec3 sampleGGXNormal(vec3 n, vec2 xi, float alpha)
{
    float a2       = alpha * alpha;
    float phi      = TAU * xi.x;
    float cosTheta = sqrt((1.0 - xi.y) / max(1.0 + (a2 - 1.0) * xi.y, 1e-5));
    float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));

    vec3 t, b;
    makeBasis(n, t, b);

    vec3 hLocal = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
    return normalize(t * hLocal.x + b * hLocal.y + n * hLocal.z);
}

float fresnelSchlick(float cosTheta, float etaI, float etaT)
{
    float f0 = (etaI - etaT) / (etaI + etaT);
    f0 *= f0;
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

float hgPhase(float mu, float g)
{
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

vec3 sunDir()
{
    float az = SUN_AZIMUTH;
    float el = SUN_ELEVATION;
    return normalize(vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el)));
}

float sunsetness(vec3 sDir)
{
    return 1.0 - smoothstep(0.05, 0.30, sDir.y);
}

vec3 evalSkyBase(vec3 rd, vec3 sDir)
{
    float ss = sunsetness(sDir);

    vec3 zenith      = vec3(0.24, 0.34, 0.95);
    vec3 horizonCool = vec3(0.72, 0.68, 0.99);
    vec3 horizonWarm = vec3(1.28, 0.56, 0.23);
    vec3 horizon     = mix(horizonCool, horizonWarm, ss);

    float t = smoothstep(-0.08, 0.56, rd.y);
    vec3 sky = mix(horizon, zenith, t);

    float mu       = max(dot(rd, sDir), 0.0);
    float sunGlow  = exp2(16.0 * (mu - 1.0));
    float sunCore  = exp2(1800.0 * (mu - 1.0));
    float antiSun  = max(dot(rd, -sDir), 0.0);
    float horizonM = exp(-18.0 * max(rd.y, 0.0));

    sky += vec3(1.50, 0.72, 0.24) * sunGlow * (0.35 + 0.90 * ss);
    sky += vec3(24.0, 10.5, 3.2) * sunCore;
    sky += vec3(0.18, 0.09, 0.25) * pow(antiSun, 4.0) * (0.2 + 0.8 * ss);
    sky  = mix(sky, horizon * vec3(1.05, 0.98, 1.0), 0.25 * horizonM);

    return sky;
}

float cloudField(vec2 p, float seed, float scale, float coverage)
{
    vec2 q = p * scale;
    vec2 w = vec2(fbm(q * 0.35 + vec2(seed, seed + 3.7)),
                  fbm(q * 0.35 + vec2(seed + 5.1, seed + 9.4)));
    q += 2.2 * (w - 0.5);

    float base   = fbm(q + seed * 11.0);
    float detail = 0.6 * noise2(q * 2.3 + seed * 17.0) +
                   0.4 * noise2(q * 4.7 - seed * 3.0);

    float d = base * 0.72 + detail * 0.28;
    return smoothstep(coverage, 0.98, d);
}

float cloudDensityLayer(
    vec3  p,
    float h0,
    float h1,
    float scale,
    float coverage,
    float density,
    float seed)
{
    float u = (p.y - h0) / (h1 - h0);
    if (u <= 0.0 || u >= 1.0) return 0.0;

    float profile = 4.0 * u * (1.0 - u);

    vec2 wind = vec2(cos(seed * 2.3), sin(seed * 1.7)) * (0.22 + 0.07 * seed);
    vec2 xz   = p.xz + wind * sceneTime();

    float d2 = cloudField(xz, seed, scale, coverage);
    return density * profile * d2;
}

float marchToSun(
    vec3  p,
    vec3  sDir,
    float h0,
    float h1,
    float scale,
    float coverage,
    float density,
    float seed)
{
    float sy = max(sDir.y, 0.06);
    float tMax = (h1 - p.y) / sy;
    tMax = max(tMax, 0.0);
    float ds = tMax / float(SUN_SHADOW_STEPS);

    float od = 0.0;
    float t  = ds * 0.5;
    for (int i = 0; i < SUN_SHADOW_STEPS; ++i)
    {
        vec3 q = p + sDir * t;
        od += cloudDensityLayer(q, h0, h1, scale, coverage, density, seed) * ds;
        t  += ds;
    }

    return exp(-1.8 * od);
}

vec2 marchCloudLayer(
    vec3  rd,
    vec3  sDir,
    float h0,
    float h1,
    float scale,
    float coverage,
    float density,
    float seed,
    float phaseG,
    vec2  xi)
{
    if (rd.y <= 0.0) return vec2(1.0, 0.0);

    float t0 = h0 / rd.y;
    float t1 = h1 / rd.y;
    if (t1 <= 0.0 || t1 <= t0) return vec2(1.0, 0.0);

    float ds = (t1 - t0) / float(CLOUD_STEPS);
    float t  = t0 + ds * xi.x;

    float Tview = 1.0;
    float S     = 0.0;
    float phase = hgPhase(dot(rd, sDir), phaseG);

    for (int i = 0; i < CLOUD_STEPS; ++i)
    {
        vec3 p = rd * t;
        float rho = cloudDensityLayer(p, h0, h1, scale, coverage, density, seed);

        if (rho > 1e-4)
        {
            float Tsun   = marchToSun(p, sDir, h0, h1, scale, coverage, density, seed);
            float sigmaS = 0.95;
            float sigmaT = 1.25;
            S     += Tview * sigmaS * rho * Tsun * phase * ds;
            Tview *= exp(-sigmaT * rho * ds);
        }

        t += ds;
    }

    return vec2(Tview, S);
}

float cloudShadowAt(vec2 worldXZ, vec3 sDir)
{
    float sy = max(sDir.y, 0.06);
    float sh = 1.0;

    vec2 p0 = worldXZ + sDir.xz / sy * 2.4;
    vec2 p1 = worldXZ + sDir.xz / sy * 4.5;
    vec2 p2 = worldXZ + sDir.xz / sy * 6.8;

    float d0 = cloudField(p0, 1.7, 0.090, 0.60);
    float d1 = cloudField(p1, 3.4, 0.060, 0.64);
    float d2 = cloudField(p2, 6.2, 0.038, 0.67);

    sh *= mix(1.0, 0.55, d0);
    sh *= mix(1.0, 0.70, d1);
    sh *= mix(1.0, 0.82, d2);
    return sh;
}

float skylineHeight(float x)
{
    float u    = x * 2.6 + 0.5;
    float cell = floor(u * 10.0);

    float h = 0.02 + 0.14 * hash11(cell * 1.31 + 4.7);
    h *= step(0.12, hash11(cell * 3.17 + 0.9));
    h *= 0.60 + 0.40 * noise2(vec2(cell * 0.08, 2.1));
    h += 0.07 * step(0.88, hash11(cell * 7.11 + 1.7));
    h += 0.05 * exp(-1.8 * x * x);
    return h;
}

vec3 evalGround(vec3 rd, vec3 sDir)
{
    float ss   = sunsetness(sDir);
    float band = exp(-40.0 * abs(rd.y));

    vec3 base  = vec3(0.020, 0.018, 0.050);
    vec3 warm  = vec3(0.85, 0.32, 0.13) * band * (0.25 + 0.75 * ss);
    vec3 cool  = vec3(0.03, 0.04, 0.09) * smoothstep(-0.65, -0.05, rd.y);

    return base + warm + cool;
}

vec3 evalBuildings(vec3 rd, vec3 sDir)
{
    float x = rd.x / max(rd.z, 0.08);
    float y = rd.y;
    float h = skylineHeight(x);

    float ss      = sunsetness(sDir);
    float topEdge = exp(-150.0 * max(h - y, 0.0));
    float facade  = 0.5 + 0.5 * sin(x * 26.0 + floor((x + 2.0) * 12.0) * 0.37);
    float shadow  = cloudShadowAt(vec2(x * 22.0, 35.0), sDir);

    vec3 base = vec3(0.050, 0.025, 0.070) + vec3(0.030, 0.010, 0.050) * facade;
    base *= mix(0.55, 1.00, shadow);
    base += vec3(0.78, 0.24, 0.09) * topEdge * (0.35 + 0.85 * ss);

    float haze = exp(-20.0 * max(y, 0.0));
    base = mix(base, vec3(0.25, 0.18, 0.30), 0.14 * haze);

    return base;
}

vec3 evalSkyAndClouds(vec3 rd, vec3 sDir, vec2 xi)
{
    vec3 Lsky = evalSkyBase(rd, sDir);
    float T   = 1.0;
    vec3  S   = vec3(0.0);

    float mu = clamp(dot(rd, sDir), 0.0, 1.0);

    vec2 c0 = marchCloudLayer(rd, sDir, 2.1, 2.6, 0.090, 0.60, 0.95, 1.7, 0.45, xi + 0.13);
    vec2 c1 = marchCloudLayer(rd, sDir, 4.0, 4.8, 0.060, 0.64, 0.78, 3.4, 0.50, xi + 0.31);
    vec2 c2 = marchCloudLayer(rd, sDir, 6.3, 7.2, 0.038, 0.67, 0.52, 6.2, 0.58, xi + 0.57);

    vec3 tintNear = vec3(1.65, 0.80, 0.42);
    vec3 tintFar  = vec3(0.95, 0.88, 1.02);
    vec3 cTint0   = mix(tintFar, tintNear, pow(mu, 0.55));
    vec3 cTint1   = mix(tintFar, tintNear, pow(mu, 0.80));
    vec3 cTint2   = mix(tintFar, tintNear, pow(mu, 1.20));

    S += T * c0.y * cTint0 * 5.5; T *= c0.x;
    S += T * c1.y * cTint1 * 4.6; T *= c1.x;
    S += T * c2.y * cTint2 * 3.6; T *= c2.x;

    return T * Lsky + S;
}

vec3 sampleOutdoor(vec3 rd, vec2 xi)
{
    vec3 sDir = sunDir();

    if (rd.z <= 0.02)
    {
        return vec3(0.0);
    }

    if (rd.y < 0.0)
    {
        return evalGround(rd, sDir);
    }

    float x = rd.x / max(rd.z, 0.08);
    if (rd.y < skylineHeight(x))
    {
        return evalBuildings(rd, sDir);
    }

    return evalSkyAndClouds(rd, sDir, xi);
}

float glassBase(vec2 uv)
{
    vec2 p = uv * 18.0;
    vec2 w = vec2(fbm(p * 0.45 + vec2(1.3, 4.7)),
                  fbm(p * 0.45 + vec2(8.1, 2.6)));
    p += 2.4 * (w - 0.5);

    float h = 0.55 * noise2(p) +
              0.24 * noise2(p * 2.13 + 13.7) +
              0.12 * noise2(p * 4.07 + 7.1) +
              0.07 * noise2(p * 8.21 + 1.9);

    h = smoothstep(0.22, 0.88, h);
    return h;
}

float glassHeightFront(vec2 uv)
{
    float h = glassBase(uv * 1.05 + vec2(0.10, -0.07));
    h += 0.08 * (noise2(uv * 42.0 + 4.0) - 0.5);
    return h;
}

float glassHeightBack(vec2 uv)
{
    float h = glassBase(uv * 1.01 + vec2(-0.11, 0.06));
    h += 0.05 * (noise2(uv * 38.0 + 17.0) - 0.5);
    return h;
}

vec3 normalFromHeightFront(vec2 uv)
{
    float e = 0.0022;
    float hL = glassHeightFront(uv - vec2(e, 0.0));
    float hR = glassHeightFront(uv + vec2(e, 0.0));
    float hD = glassHeightFront(uv - vec2(0.0, e));
    float hU = glassHeightFront(uv + vec2(0.0, e));

    vec2 g = vec2(hR - hL, hU - hD) * (0.5 / e) * GLASS_BUMP;
    return normalize(vec3(-g.x, -g.y, 1.0));
}

vec3 normalFromHeightBack(vec2 uv)
{
    float e = 0.0022;
    float hL = glassHeightBack(uv - vec2(e, 0.0));
    float hR = glassHeightBack(uv + vec2(e, 0.0));
    float hD = glassHeightBack(uv - vec2(0.0, e));
    float hU = glassHeightBack(uv + vec2(0.0, e));

    vec2 g = vec2(hR - hL, hU - hD) * (0.5 / e) * GLASS_BUMP;
    return normalize(vec3(-g.x, -g.y, 1.0));
}

void traceThroughGlass(
    vec3 rdCam,
    vec2 uvGlass,
    vec2 xi,
    out vec3 rdOut,
    out vec3 Tg,
    out float F)
{
    vec3 n0g = normalFromHeightFront(uvGlass);
    vec3 n0m = sampleGGXNormal(n0g, fract(xi + vec2(0.17, 0.73)), GLASS_ROUGHNESS);
    vec3 n0  = normalize(mix(n0g, n0m, 0.35));
    n0       = faceforward(n0, rdCam, n0);

    vec3 rdIn = refract(rdCam, n0, 1.0 / GLASS_IOR);
    float cos0 = clamp(dot(-rdCam, n0), 0.0, 1.0);
    F = fresnelSchlick(cos0, 1.0, GLASS_IOR);

    if (length(rdIn) < 1e-5)
    {
        rdOut = reflect(rdCam, n0);
        Tg    = vec3(0.0);
        F     = 1.0;
        return;
    }

    float h0 = glassHeightFront(uvGlass);
    float h1 = glassHeightBack(uvGlass);
    float d  = max(0.020, GLASS_THICKNESS + GLASS_HEIGHT_AMPL * (h1 - h0));

    vec2 uvBack = uvGlass + rdIn.xy / max(rdIn.z, 1e-3) * d;

    vec3 n1g = normalFromHeightBack(uvBack);
    vec3 n1m = sampleGGXNormal(n1g, fract(xi.yx + vec2(0.41, 0.19)), GLASS_ROUGHNESS);
    vec3 n1  = normalize(mix(n1g, n1m, 0.35));
    n1       = faceforward(n1, rdIn, n1);

    rdOut = refract(rdIn, n1, GLASS_IOR);
    if (length(rdOut) < 1e-5)
    {
        rdOut = reflect(rdIn, n1);
        F = 1.0;
    }

    float pathLen = d / max(rdIn.z, 1e-3);
    vec3 sigmaA   = vec3(0.018, 0.012, 0.008);
    Tg = exp(-sigmaA * pathLen);
}

vec3 evalInteriorReflection(vec3 rdCam)
{
    float w = 0.5 + 0.5 * rdCam.y;
    return mix(vec3(0.006, 0.007, 0.010), vec3(0.012, 0.013, 0.017), w);
}

vec3 sampleWindow(vec2 fragCoord, int sampleId)
{
    vec2 jitter = pixelJitter(fragCoord, sampleId);
    vec2 p      = ((fragCoord + jitter) - 0.5 * iResolution.xy) / iResolution.y;

    vec3 ro    = vec3(0.0, 0.0, -CAMERA_Z);
    vec3 rdCam = normalize(vec3(p, CAMERA_FOCAL));

    float tFront = -ro.z / max(rdCam.z, 1e-4);
    vec3  pFront = ro + rdCam * tFront;
    vec2  uv     = pFront.xy;

    vec2 xi = sampleXi(fragCoord, sampleId);

    vec3 rdOut;
    vec3 Tg;
    float F;
    traceThroughGlass(rdCam, uv, xi, rdOut, Tg, F);

    vec3 Lout  = sampleOutdoor(normalize(rdOut), xi);
    vec3 Lrefl = evalInteriorReflection(rdCam);

    vec3 L = (1.0 - F) * Tg * Lout + F * Lrefl;

    float vignette = 1.0 - smoothstep(0.15, 1.05, length(p));
    L *= 0.92 + 0.08 * vignette;

    return L;
}

vec3 renderPixel(vec2 fragCoord)
{
    vec3 sum = vec3(0.0);
    for (int s = 0; s < SAMPLES_PER_FRAME; ++s)
    {
        sum += sampleWindow(fragCoord, s);
    }
    return sum / float(SAMPLES_PER_FRAME);
}

vec3 acesFilm(vec3 x)
{
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
