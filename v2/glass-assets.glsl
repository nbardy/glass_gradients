// GenerateGlassAssets(uv, seed)
// Generate height maps, normal maps, and slope covariance

GenerateGlassAssets(uv, seed):
    P  = PebbleField(uv, seed)                 // stationary master pattern
    P  = RemapPebbleContrast(P)

    hFront     = ampFront * P
    hFrontLF   = LowPass(hFront, λsplit)
    hFrontHF   = hFront - hFrontLF

    Q          = PebbleField(uv + offset, seed + 17)
    hBack      = baseThickness
               + ampBack * (corr * P + (1 - corr) * Q)

    hBackLF    = LowPass(hBack, λsplit)
    hBackHF    = hBack - hBackLF

    nFront     = NormalFromHeight(hFrontLF)
    nBack      = NormalFromHeight(hBackLF)

    Cf         = NeighborhoodSlopeCovariance(hFrontHF)
    Cb         = NeighborhoodSlopeCovariance(hBackHF)

    return hFrontLF, hBackLF, nFront, nBack, Cf, Cb
