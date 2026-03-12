void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec3 curr = renderPixel(fragCoord);

    if (iFrame == 0)
    {
        fragColor = vec4(curr, 1.0);
        return;
    }

    vec4 prev = texelFetch(iChannel0, ivec2(fragCoord), 0);

#if SCENE_STATIC == 1
    float count = min(prev.a, 512.0);
    float nextCount = min(count + 1.0, 512.0);
    vec3 accum = mix(prev.rgb, curr, 1.0 / nextCount);
    fragColor = vec4(accum, nextCount);
#else
    float alpha = 0.08;
    vec3 accum = mix(prev.rgb, curr, alpha);
    fragColor = vec4(accum, 1.0);
#endif
}
