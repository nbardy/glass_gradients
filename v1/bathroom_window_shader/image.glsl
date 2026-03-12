void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec3 col = texelFetch(iChannel0, ivec2(fragCoord), 0).rgb;

    col *= 1.18;

    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, 1.08);
    col = acesFilm(col);
    col = pow(col, vec3(1.0 / 2.2));

    fragColor = vec4(col, 1.0);
}
