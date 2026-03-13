export async function v4GlassPipeline(device, canvas, shaderSource, config) {
    return {
        name: "v4_webgl2",
        async render(timestamp) {
            // Stub
        },
        getStats() {
            return { status: "Not yet integrated (requires WebGL2 context setup)" };
        },
        dispose() { },
    };
}
