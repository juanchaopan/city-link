import * as THREE from 'three';

// 把一份低多边形几何烘焙成等距精灵。
// 相机是严格的 2:1 正交投影，高度一层正好 32 像素，所以格子边界落在整数像素上，几何上不会有缝。
// 光照是多次渲染累加：太阳分成若干方向得到柔和阴影，天空光分成半球上的很多方向得到接触阴影。
// 渲染目标是超采样的半浮点纹理，一张就可能占几百 MB，所以任何时候只留当前尺寸的一套。

export const TILE_W = 128;
export const SCALE = TILE_W / Math.SQRT2;
export const LEVEL = 1 / Math.sqrt(6);
const SUPER = 2;
const SUN_SAMPLES = 12;
const SKY_SAMPLES = 28;
const MSAA_SAMPLES = 4;
const MSAA_MAX_PIXELS = 1000000;

const QUAD_VERTEX = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const ADD_FRAGMENT = `
  uniform sampler2D source;
  uniform float weight;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(source, vUv) * weight; }
`;

// 累加结果是预乘透明度的线性颜色，两组光各自权重为 1，所以 alpha 的总和是 2。
const FINAL_FRAGMENT = `
  uniform sampler2D source;
  uniform float saturation;
  uniform float contrast;
  varying vec2 vUv;
  vec3 encode(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec4 sum = texture2D(source, vUv);
    float alpha = sum.a * 0.5;
    if (alpha < 0.002) { gl_FragColor = vec4(0.0); return; }
    vec3 color = sum.rgb / alpha;
    float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = max(mix(vec3(grey), color, saturation), vec3(0.0));
    color = encode(min(color, vec3(1.0)));
    color = clamp((color - 0.5) * contrast + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

function hemisphere(count) {
  const directions = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 0.08 + 0.92 * ((i + 0.5) / count);
    const radius = Math.sqrt(1 - y * y);
    const angle = golden * i;
    directions.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  return directions;
}

function cone(center, spread, count) {
  const base = new THREE.Vector3(...center).normalize();
  const u = new THREE.Vector3(0, 1, 0).cross(base).normalize();
  const v = base.clone().cross(u).normalize();
  const directions = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const r = Math.sqrt((i + 0.5) / count) * spread;
    const a = golden * i;
    directions.push(
      base
        .clone()
        .addScaledVector(u, Math.cos(a) * r)
        .addScaledVector(v, Math.sin(a) * r)
        .normalize(),
    );
  }
  return directions;
}

export class Baker {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.01;

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.addMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: ADD_FRAGMENT,
      uniforms: { source: { value: null }, weight: { value: 1 } },
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.finalMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: FINAL_FRAGMENT,
      uniforms: {
        source: { value: null },
        saturation: { value: 1 },
        contrast: { value: 1 },
      },
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.addMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.invisible = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.targets = null;
    this.targetSize = '';
    this.shadowBaseline = new Map();
  }

  /** 当前尺寸的渲染目标。尺寸一变就释放上一套；超大的精灵只靠超采样抗锯齿，不再叠多重采样。 */
  targetsFor(w, h) {
    const key = `${String(w)}x${String(h)}`;
    if (key === this.targetSize) return this.targets;
    this.renderer.setRenderTarget(null);
    if (this.targets) {
      this.targets.scene.dispose();
      this.targets.sum.dispose();
      this.targets.out.dispose();
    }
    const options = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const float = { ...options, type: THREE.HalfFloatType };
    const samples = w * h > MSAA_MAX_PIXELS ? 0 : MSAA_SAMPLES;
    this.targets = {
      scene: new THREE.WebGLRenderTarget(w * SUPER, h * SUPER, { ...float, samples }),
      sum: new THREE.WebGLRenderTarget(w * SUPER, h * SUPER, { ...float, depthBuffer: false }),
      out: new THREE.WebGLRenderTarget(w, h, { ...options, depthBuffer: false }),
      pixels: new Uint8Array(w * h * 4),
    };
    this.targetSize = key;
    return this.targets;
  }

  usePalette(palette) {
    this.palette = palette;
    this.sunDirections = cone(palette.sun.direction, palette.sun.spread, SUN_SAMPLES);
    this.skyDirections = hemisphere(SKY_SAMPLES);
    this.finalMaterial.uniforms.saturation.value = palette.grade.saturation;
    this.finalMaterial.uniforms.contrast.value = palette.grade.contrast;
    this.shadowBaseline.clear();
  }

  camera(w, h, anchorY, focus) {
    const camera = new THREE.OrthographicCamera(
      -w / 2 / SCALE,
      w / 2 / SCALE,
      anchorY / SCALE,
      -(h - anchorY) / SCALE,
      0.1,
      100,
    );
    const elevation = Math.tan(Math.PI / 6) * Math.SQRT2;
    camera.position.set(focus[0] + 20, focus[1] + 20 * elevation, focus[2] + 20);
    camera.lookAt(focus[0], focus[1], focus[2]);
    return camera;
  }

  accumulate(scene, camera, targets, reach, focus) {
    const { palette, light, renderer } = this;
    const span = reach + 1.5;
    light.shadow.camera.left = -span;
    light.shadow.camera.right = span;
    light.shadow.camera.top = span;
    light.shadow.camera.bottom = -span;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 40;
    light.shadow.camera.updateProjectionMatrix();
    light.target.position.set(focus[0], focus[1], focus[2]);
    scene.add(light, light.target);

    renderer.setRenderTarget(targets.sum);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();

    const pass = (direction, color, intensity, weight) => {
      light.position.set(
        focus[0] + direction.x * 20,
        focus[1] + direction.y * 20,
        focus[2] + direction.z * 20,
      );
      light.color.set(color);
      light.intensity = intensity;
      renderer.setRenderTarget(targets.scene);
      renderer.clear();
      renderer.render(scene, camera);
      this.quad.material = this.addMaterial;
      this.addMaterial.uniforms.source.value = targets.scene.texture;
      this.addMaterial.uniforms.weight.value = weight;
      renderer.setRenderTarget(targets.sum);
      renderer.autoClear = false;
      renderer.render(this.quadScene, this.quadCamera);
      renderer.autoClear = true;
    };

    for (const direction of this.sunDirections) {
      pass(direction, palette.sun.color, Math.PI * palette.sun.energy, 1 / SUN_SAMPLES);
    }
    for (const direction of this.skyDirections) {
      pass(direction, palette.sky.color, Math.PI * 2 * palette.sky.energy, 1 / SKY_SAMPLES);
    }
    scene.remove(light, light.target);
  }

  resolve(targets, w, h) {
    this.quad.material = this.finalMaterial;
    this.finalMaterial.uniforms.source.value = targets.sum.texture;
    this.renderer.setRenderTarget(targets.out);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.readRenderTargetPixels(targets.out, 0, 0, w, h, targets.pixels);
    this.renderer.setRenderTarget(null);
    const flipped = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row += 1) {
      const from = (h - 1 - row) * w * 4;
      flipped.set(targets.pixels.subarray(from, from + w * 4), row * w * 4);
    }
    return flipped;
  }

  sceneFor(parts, castAndReceive) {
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(
      this.palette.bounce.sky,
      this.palette.bounce.ground,
      this.palette.bounce.energy * Math.PI,
    );
    scene.add(hemi);
    for (const { geometry, glow } of parts) {
      const mesh = new THREE.Mesh(geometry, glow ? this.glow : this.solid);
      mesh.castShadow = castAndReceive && !glow;
      mesh.receiveShadow = castAndReceive && !glow;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    return scene;
  }

  baselineFor(w, h, anchorY, focus, reach, groundY) {
    if (this.shadowBaseline.has(reach)) return this.shadowBaseline.get(reach);
    const targets = this.targetsFor(w, h);
    const camera = this.camera(w, h, anchorY, focus);
    const scene = this.sceneFor([], false);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.white);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = groundY;
    scene.add(plane);
    this.accumulate(scene, camera, targets, reach, focus);
    const pixels = this.resolve(targets, w, h);
    const value = pixels[(Math.floor(h / 2) * w + Math.floor(w / 2)) * 4 + 1] / 255;
    plane.geometry.dispose();
    this.shadowBaseline.set(reach, value);
    return value;
  }

  /** 物体投在地面上的阴影：地面白板加不可见的投影体，亮度差就是阴影浓度。 */
  shadowLayer({ parts, w, h, anchorY, focus, reach, groundY }) {
    const baseline = this.baselineFor(w, h, anchorY, focus, reach, groundY);
    const targets = this.targetsFor(w, h);
    const camera = this.camera(w, h, anchorY, focus);
    const scene = this.sceneFor([], false);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.white);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = groundY;
    plane.receiveShadow = true;
    scene.add(plane);
    for (const { geometry, glow } of parts) {
      if (glow) continue;
      const caster = new THREE.Mesh(geometry, this.invisible);
      caster.castShadow = true;
      caster.frustumCulled = false;
      scene.add(caster);
    }
    this.accumulate(scene, camera, targets, reach, focus);
    const pixels = this.resolve(targets, w, h);
    plane.geometry.dispose();
    return { pixels, baseline };
  }

  /** 夜间亮窗层：实体只写深度，窗户只有在不被遮挡时才出现。 */
  glowLayer({ parts, w, h, anchorY, focus }) {
    const targets = this.targetsFor(w, h);
    const camera = this.camera(w, h, anchorY, focus);
    const scene = new THREE.Scene();
    for (const { geometry, glow } of parts) {
      const mesh = new THREE.Mesh(geometry, glow ? this.glow : this.depthOnly);
      mesh.frustumCulled = false;
      mesh.renderOrder = glow ? 1 : 0;
      scene.add(mesh);
    }
    this.renderer.setRenderTarget(targets.scene);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.quad.material = this.addMaterial;
    this.addMaterial.uniforms.source.value = targets.scene.texture;
    this.addMaterial.uniforms.weight.value = 2;
    this.renderer.setRenderTarget(targets.sum);
    this.renderer.clear();
    this.renderer.autoClear = false;
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.autoClear = true;
    return this.resolve(targets, w, h);
  }

  /**
   * 烘焙一张精灵。返回裁掉透明边后的像素和格子中心在图内的位置。
   * spec: { w, h, anchorY, build(), extra(), focus, reach, shadow, groundY, lit }
   * lit 为 false 时不算阴影，地表用这个模式，相邻格的光照才完全一致。
   * 配色要求单独的亮窗层时，额外返回 glow。
   */
  bake(spec) {
    const { w, h, anchorY } = spec;
    const focus = spec.focus ?? [0, 0, 0];
    const reach = spec.reach ?? 2;
    const parts = spec.build().meshes();
    const separateGlow = this.palette.window.layer === true;
    const colorParts = separateGlow ? parts.filter((part) => !part.glow) : parts;
    const extras = spec.extra?.() ?? [];
    const targets = this.targetsFor(w, h);
    const camera = this.camera(w, h, anchorY, focus);
    const scene = this.sceneFor(colorParts, spec.lit !== false);
    for (const mesh of extras) scene.add(mesh);
    this.accumulate(scene, camera, targets, reach, focus);
    let pixels = this.resolve(targets, w, h);

    if (spec.shadow) {
      const layer = this.shadowLayer({
        parts: colorParts,
        w,
        h,
        anchorY,
        focus,
        reach,
        groundY: spec.groundY ?? 0,
      });
      pixels = compositeShadow(pixels, layer, this.palette.shadow);
    }
    const result = trim(pixels, w, h, anchorY);
    if (separateGlow && parts.some((part) => part.glow)) {
      result.glow = trim(this.glowLayer({ parts, w, h, anchorY, focus }), w, h, anchorY, true);
    }
    for (const { geometry } of parts) geometry.dispose();
    for (const mesh of extras) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    return result;
  }
}

function compositeShadow(object, { pixels: ground, baseline }, shadow) {
  const out = new Uint8ClampedArray(object.length);
  const tint = shadow.color;
  for (let i = 0; i < object.length; i += 4) {
    const lit = ground[i + 1] / 255;
    const amount = Math.min(1, Math.max(0, 1 - lit / baseline)) * shadow.strength;
    const objectAlpha = object[i + 3] / 255;
    const shadowAlpha = ground[i + 3] > 0 ? amount : 0;
    const alpha = objectAlpha + shadowAlpha * (1 - objectAlpha);
    if (alpha <= 0) continue;
    const under = shadowAlpha * (1 - objectAlpha);
    out[i] = (object[i] * objectAlpha + tint[0] * under) / alpha;
    out[i + 1] = (object[i + 1] * objectAlpha + tint[1] * under) / alpha;
    out[i + 2] = (object[i + 2] * objectAlpha + tint[2] * under) / alpha;
    out[i + 3] = alpha * 255;
  }
  return out;
}

function trim(pixels, w, h, anchorY, allowEmpty = false) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (pixels[(y * w + x) * 4 + 3] > 2) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    if (allowEmpty) return null;
    throw new Error('精灵是空的');
  }
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const data = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y += 1) {
    const from = ((y + minY) * w + minX) * 4;
    data.set(pixels.subarray(from, from + tw * 4), y * tw * 4);
  }
  return { data, w: tw, h: th, ax: w / 2 - minX, ay: anchorY - minY };
}
