// RenderVariant2(pixel)
// Local anisotropic transmission kernel
// Best direct image-match for references - uses kernel mixture with halo

RenderVariant2(pixel):
    u = WindowUV(pixel)

    for c in {R,G,B}:
        μ       = MeanShiftFromSlope(u, c)
        Σmain   = KernelFromStructureTensor(u, c)
        Σhalo   = beta * Σmain + sigmaHalo^2 * I
        wHalo   = HaloWeight(u, c)

        Tmain   = SampleGaussianKernel(bgPyramid[c], u + μ, Σmain, tapsMain)
        Thalo   = SampleGaussianKernel(bgPyramid[c], u + μ, Σhalo, tapsHalo)
        T       = mix(Tmain, Thalo, wHalo)

        F       = FresnelApprox(u, c)
        O[c]    = (1 - F) * T + F * ReflectionTerm(u, c)

    return ToneMap(O)
