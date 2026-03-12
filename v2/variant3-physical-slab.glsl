// RenderVariant3(pixel)
// Reduced-order physical slab with TIR and dispersion
// Most physically grounded version

RenderVariant3(pixel):
    u = WindowUV(pixel)

    for c in {R,G,B}:
        η = EtaForChannel(c)          // RGB triplet or Sellmeier sample
        p = FrontSurfacePoint(u)
        n = FrontNormal(u)

        ok, w = Refract(viewDir, n, etaAir / η)
        if not ok:
            O[c] = ReflectionTerm(u, c)
            continue

        surface = BACK
        pathLen = 0
        energy  = 1

        for bounce in 0 .. maxInternalBounces:
            t = SolveNextSurfaceIntersection(p, w, surface)
            p = p + t * w
            pathLen += t

            n = SurfaceNormal(surface, p.xy)

            ok, wExit = Refract(w, ExitNormal(surface, n), ExitEta(surface, η))
            if ok:
                w = wExit
                if surface == BACK:
                    break
            else:
                w = Reflect(w, n)
                energy *= TIRRetention(surface, u, c)
                surface = Opposite(surface)

        μ = ProjectBackground(w) - u
        Σ = UnresolvedMicroSpread(u, c)
        T = SampleEllipticalMip(bgPyramid[c], u + μ, Σ)

        F = FresnelPhysical(u, c)
        O[c] = (1 - F) * exp(-sigmaA[c] * pathLen) * energy * T
             + F * ReflectionTerm(u, c)

    return ToneMap(O)
