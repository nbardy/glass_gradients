// RenderBathroomGlass(pixel)
// Final hybrid version - best balance of physically honest, visually on-target, and realtime-friendly
// Combines:
// - Low-frequency deterministic slab optics
// - High-frequency unresolved relief via slope covariance
// - Anisotropic PSF from structure tensor
// - Halo compensation for internal multi-bounce
// - RGB dispersion
// - Deterministic ellipse sampling over mip pyramid

RenderBathroomGlass(pixel):
    u = WindowUV(pixel)

    for c in {R,G,B}:
        // 1) Mean path through resolved slab
        μ      = MeanShiftFromReducedSlab(u, c, hFrontLF, hBackLF, eta[c])
        pathLn = MeanPathLengthFromReducedSlab(u, c)

        // 2) Local spread from unresolved relief
        Af, Ab = SlabDirectionJacobians(u, c, hFrontLF, hBackLF, eta[c])
        Σmain  = ProjectToImage(
                    Af * Cf[u] * Af^T +
                    Ab * Cb[u] * Ab^T
                 ) + MicroSpread(c)

        // 3) Halo compensation
        Σhalo  = beta * Σmain + sigmaHalo^2 * I
        wHalo  = HaloWeight(u, c, Fresnel(u,c), LocalRoughness(u))

        // 4) Channel-separated dispersion
        uC     = u + μ + DispersionOffset(u, c)

        // 5) Filtered background samples
        Tmain  = SampleEllipticalPyramid(bgPyramid[c], uC, Σmain, tapsMain)
        Thalo  = SampleEllipticalPyramid(bgPyramid[c], uC, Σhalo, tapsHalo)
        T      = mix(Tmain, Thalo, wHalo)

        // 6) Reflection + absorption
        F      = Fresnel(u, c)
        A      = exp(-sigmaA[c] * pathLn)

        O[c]   = (1 - F) * A * T + F * ReflectionTerm(u, c)

    return ToneMap(O)
