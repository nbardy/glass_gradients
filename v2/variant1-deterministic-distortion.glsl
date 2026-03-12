// RenderVariant1(pixel)
// Deterministic distortion + mipmapped background
// Cheapest version - approximate local PSF as single Gaussian

RenderVariant1(pixel):
    u = WindowUV(pixel)

    for c in {R,G,B}:
        μ = MeanShiftFromSlope(u, c)
        Σ = BaseBlur(c) + FrontBackSlopeBlur(u, c)

        T = SampleEllipticalMip(bgPyramid[c], u + μ, Σ)

        F = FresnelApprox(u, c)
        O[c] = (1 - F) * T + F * ReflectionTerm(u, c)

    return ToneMap(O)
