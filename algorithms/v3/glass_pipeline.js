export async function v3GlassPipeline(device, canvas, shaderSource, config) {
    return {
        name: "v3_glsl",
        async render(timestamp) {
            // Stub
        },
        getStats() {
            return { status: "Not yet integrated (requires GLSL to WGSL transcription)" };
        },
        dispose() { },
    };
}
