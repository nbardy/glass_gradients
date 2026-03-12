// BuildBackgroundHDR(time, seed)
// Generate low-frequency HDR background panorama

BuildBackgroundHDR(time, seed):
    sunDir = ComputeSunDirection(time)

    for each env texel with direction ω:
        φ, θ = AzimuthElevation(ω)

        sky = EvalSkyModel(ω, sunDir)          // Hosek-Wilkie or Bruneton-baked
        sun = EvalSunDisk(ω, sunDir)

        cloudT = 1
        cloudGlow = 0
        for each cloud layer i:
            uv_i = ProjectLayer(ω, altitude_i) + wind_i * time
            m_i  = SmoothCloudMask(uv_i, seed_i)   // low-pass only, no runtime volume march
            cloudT    *= 1 - α_i * m_i
            cloudGlow += β_i * m_i * SunsetTint(ω, sunDir, i)

        skyMask   = step(CityHorizon(φ, seed), θ)
        cityColor = ShadeCitySilhouette(φ, θ, sunDir, time, seed)

        env[ω] = skyMask * (sky + sun * cloudT + cloudGlow)
               + (1 - skyMask) * cityColor

    BuildMipPyramid(env)
    return env
