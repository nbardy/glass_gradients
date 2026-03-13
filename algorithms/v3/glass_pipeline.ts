import { AlgoRenderer } from "../../core/renderer";

const vsSource = `#version 300 es
void main() {
    float x = -1.0 + float((gl_VertexID & 1) << 2);
    float y = -1.0 + float((gl_VertexID & 2) << 1);
    gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

export async function v3GlassPipeline(
  device: any,
  canvas: HTMLCanvasElement,
  shaderSource: string,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
  });

  if (!gl) {
    throw new Error("WebGL 2.0 Context Initialization Failed.");
  }

  const fsSource = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
out vec4 O_fragColor;
${shaderSource}
void main() {
    mainImage(O_fragColor, gl_FragCoord.xy);
}
`;

  function compileShader(type: number, source: string) {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error(gl!.getShaderInfoLog(shader));
      gl!.deleteShader(shader);
      throw new Error("Shader compilation failed");
    }
    return shader;
  }

  const vertexShader = compileShader(gl.VERTEX_SHADER, vsSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error("Program linking failed");
  }

  const iResolutionLoc = gl.getUniformLocation(program, "iResolution");
  const iTimeLoc = gl.getUniformLocation(program, "iTime");

  let lastTime = performance.now();
  let frameCount = 0;
  const stats = { fps: 0, frameMs: 0, status: "Running WebGL2" };

  return {
    name: "v3_glsl",
    async render(timestamp: number) {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      stats.frameMs = delta;
      stats.fps = delta > 0 ? 1000 / delta : 0;
      frameCount++;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl!.viewport(0, 0, width, height);

      gl!.useProgram(program);
      gl!.uniform3f(iResolutionLoc, width, height, 1.0);
      gl!.uniform1f(iTimeLoc, timestamp * 0.001);

      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
    },
  };
}