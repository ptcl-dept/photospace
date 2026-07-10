import * as THREE from "three";
import { loadPackage, GLSL_SNIPPETS } from "photospace-runtime";

/**
 * runtime/loader.ts で読み込んだ1パッケージ(photo.avif/depth.png/mask.png/normal.png/meta.json)
 * だけを使い、Three.jsのShaderMaterialでカーソル追従の波紋エフェクトを再現する受け入れ検証シーン。
 * meta.jsonのcamera.fovDeg/farRange/sky.thresholdだけでシェーダーが書けることの証明。
 */
async function main(): Promise<void> {
  const hint = document.getElementById("hint")!;
  const pkg = await loadPackage("/sample/source/");
  hint.textContent = "runtime/loader.ts で /sample/source/ を読み込み済み — マウスで波紋エフェクトを操作";

  const app = document.getElementById("app")!;
  const aspect = pkg.meta.source.width / pkg.meta.source.height;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const photoTexture = new THREE.Texture(pkg.photo);
  photoTexture.needsUpdate = true;
  photoTexture.colorSpace = THREE.SRGBColorSpace;

  const depthTexture = new THREE.DataTexture(
    pkg.depth,
    pkg.depthWidth,
    pkg.depthHeight,
    THREE.RedFormat,
    THREE.FloatType,
  );
  depthTexture.magFilter = THREE.NearestFilter;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.generateMipmaps = false;
  // depth.pngは上から下(row0=最上段)の並びのまま復元されるため、Y反転はしない。
  // 反転補正はdsp()内の 1.0-uv.y で行う(現行ビューワと同じ方式)。
  depthTexture.flipY = false;
  depthTexture.needsUpdate = true;

  const uniforms = {
    uImg: { value: photoTexture },
    uDep: { value: depthTexture },
    uDRes: { value: new THREE.Vector2(pkg.depthWidth, pkg.depthHeight) },
    uCur: { value: new THREE.Vector2(0.5, 0.5) },
    uT: { value: 0 },
    uTanF: { value: Math.tan((pkg.meta.camera.fovDeg * Math.PI) / 360) },
    uFar: { value: pkg.meta.camera.farRange },
    uSky: { value: pkg.meta.sky.threshold },
    uRad: { value: 1.0 },
    uAspect: { value: aspect },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    glslVersion: THREE.GLSL3,
    vertexShader: `
      out vec2 vUv;
      void main() {
        vUv = vec2(uv.x, 1.0 - uv.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uImg, uDep;
      uniform vec2 uDRes, uCur;
      uniform float uT, uTanF, uFar, uSky, uRad, uAspect;
      in vec2 vUv;
      out vec4 fragColor;

      ${GLSL_SNIPPETS.unpackAndSampleDepth}
      ${GLSL_SNIPPETS.worldPosition}

      void main() {
        vec2 uv = vUv;
        float d0 = dsp(uDep, uDRes, uv);
        vec3 alb = texture(uImg, uv).rgb;
        bool sky = d0 < uSky;
        vec3 pos = wpos(uv, d0, uAspect, uTanF, uFar);
        float z = -pos.z;
        vec3 n = normalize(cross(dFdx(pos), dFdy(pos)));
        if (dot(n, -pos) < 0.) n = -n;
        float rel = length(vec2(dFdx(z), dFdy(z))) / z;
        float edge = 1.0 - smoothstep(0.05, 0.15, rel);

        float dc = dsp(uDep, uDRes, uCur);
        vec3 pc = wpos(uCur, dc, uAspect, uTanF, uFar);
        float on = dc < uSky ? 0.0 : 1.0;
        float dn = length(pos - pc) / uRad;

        vec3 col = alb;
        if (!sky) {
          float w = sin(dn * 13.0 - uT * 5.0) * exp(-dn * 1.15);
          col += max(w, 0.0) * 0.5 * edge * on * vec3(0.85, 0.95, 1.1);
        }
        float m = smoothstep(0.012, 0.005, length((uv - uCur) * vec2(uAspect, 1.0)));
        col = mix(col, vec3(1.0), m * 0.9);
        fragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(mesh);

  function resize(): void {
    const maxW = window.innerWidth;
    const maxH = window.innerHeight;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    renderer.setSize(w, h);
  }
  resize();
  addEventListener("resize", resize);

  renderer.domElement.addEventListener("pointermove", (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    uniforms.uCur.value.set(
      Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    );
  });

  const start = performance.now();
  function animate(): void {
    uniforms.uT.value = (performance.now() - start) * 0.001;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

main().catch((e) => {
  const message = `読み込みに失敗しました: ${(e as Error).message}`;
  document.getElementById("app")!.textContent = message;
  document.getElementById("hint")!.textContent = message;
});
