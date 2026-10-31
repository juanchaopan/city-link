import * as THREE from 'three';
import { linear } from './builder.js';
import { ROAD_SPEC } from '../sim/network.js';

// 路面用距离场在片元里画，而不是拼多边形：
// 人行道、路缘和斑马线都是到中线距离的函数，所以弯道、斜路和路口都是连续的，路口内角有自然的圆角。

const MAX_SEGMENTS = 32;

const HEADER = `
  #define MAX_SEGMENTS ${String(MAX_SEGMENTS)}
  uniform vec4 uSegment[MAX_SEGMENTS];
  uniform vec4 uWidths[MAX_SEGMENTS];
  uniform vec4 uPath[MAX_SEGMENTS];
  uniform vec4 uFlags[MAX_SEGMENTS];
  uniform int uCount;
  uniform vec3 uAsphalt, uHighway, uWalk, uShoulder, uCurb, uLine, uMedian;
  varying vec2 vXZ;
  float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
  }
`;

const BODY = `
  vec2 p = vXZ;
  float walk = 1e3;
  float deck = 1e3;
  float pathWalk = 1e3;
  float pathDeck = 1e3;
  float current = -1.0;
  float bestD = 1e3;
  float bestU = 0.0;
  float bestV = 0.0;
  int best = -1;
  for (int i = 0; i < uCount; i++) {
    if (uFlags[i].x != current) {
      if (current >= 0.0) {
        walk = smin(walk, pathWalk, 0.12);
        deck = smin(deck, pathDeck, 0.12);
      }
      current = uFlags[i].x;
      pathWalk = 1e3;
      pathDeck = 1e3;
    }
    vec2 a = uSegment[i].xy;
    vec2 b = uSegment[i].zw;
    vec2 ba = b - a;
    float len = length(ba);
    vec2 dir = ba / len;
    vec2 pa = p - a;
    float t = dot(pa, dir);
    float side = dot(pa, vec2(-dir.y, dir.x));
    bool clipLow = uFlags[i].y > 0.5;
    bool clipHigh = uFlags[i].z > 0.5;
    if (clipLow && t < -0.016) continue;
    if (clipHigh && t > len + 0.016) continue;
    float ct = t;
    if (!clipLow) ct = max(ct, 0.0);
    if (!clipHigh) ct = min(ct, len);
    float d = length(p - (a + dir * ct));
    pathWalk = min(pathWalk, d - uWidths[i].x);
    pathDeck = min(pathDeck, d - uWidths[i].y);
    if (d < bestD) {
      bestD = d;
      best = i;
      bestU = uPath[i].x + ct;
      bestV = side;
    }
  }
  if (current >= 0.0) {
    walk = smin(walk, pathWalk, 0.12);
    deck = smin(deck, pathDeck, 0.12);
  }
  if (best < 0 || walk > 0.0) discard;

  float highway = uWidths[best].z;
  vec3 ground = mix(uAsphalt, uHighway, highway);
  vec3 side = mix(uWalk, uShoulder, highway);
  vec3 color = side;
  if (deck < 0.014) color = uCurb;
  if (walk > -0.008) color = mix(side, uCurb, 0.45);
  if (deck < 0.0) {
    color = ground;
    float pathLength = uPath[best].y;
    float cross = uPath[best].z;
    float halfDeck = uWidths[best].y;
    float period = pathLength / max(1.0, floor(pathLength / 0.25 + 0.5));
    float dash = abs(fract(bestU / period + 0.5) - 0.5) * period;
    bool junction = cross >= 0.0;
    bool marked = !junction || bestU > cross + 0.15;
    if (highway > 0.5) {
      bool markHere = !junction || bestU > 0.46;
      if (markHere) {
        if (abs(bestV) < 0.026) color = uMedian;
        else if (abs(abs(bestV) - 0.205) < 0.008 && dash < period * 0.25) color = uLine;
        else if (abs(abs(bestV) - 0.37) < 0.006) color = uLine;
      }
    } else {
      if (marked && abs(bestV) < 0.007 && dash < period * 0.27) color = uLine;
      if (junction && cross > 0.0 && cross < 0.39 && bestU > cross && bestU < cross + 0.09 && abs(bestV) < halfDeck - 0.03) {
        if (fract((bestV + 10.0) / 0.074) < 0.5) color = uLine;
      }
    }
  }
  diffuseColor.rgb = color;
  diffuseColor.a = 1.0;
`;

function uniformsFor(paths, P) {
  const segment = [];
  const widths = [];
  const path = [];
  const flags = [];
  paths.forEach((entry, index) => {
    const spec = ROAD_SPEC[entry.kind];
    let total = 0;
    for (let i = 0; i < entry.points.length - 1; i += 1) {
      const [ax, az] = entry.points[i];
      const [bx, bz] = entry.points[i + 1];
      total += Math.hypot(bx - ax, bz - az);
    }
    let start = 0;
    for (let i = 0; i < entry.points.length - 1; i += 1) {
      const [ax, az] = entry.points[i];
      const [bx, bz] = entry.points[i + 1];
      segment.push(new THREE.Vector4(ax, az, bx, bz));
      widths.push(
        new THREE.Vector4(spec.walk / 2, spec.deck / 2, entry.kind === 'highway' ? 1 : 0, 0),
      );
      path.push(new THREE.Vector4(start, total, entry.cross, 0));
      flags.push(
        new THREE.Vector4(
          index,
          entry.clipStart && i === 0 ? 1 : 0,
          entry.clipEnd && i === entry.points.length - 2 ? 1 : 0,
          0,
        ),
      );
      start += Math.hypot(bx - ax, bz - az);
    }
  });
  const count = segment.length;
  while (segment.length < MAX_SEGMENTS) {
    segment.push(new THREE.Vector4());
    widths.push(new THREE.Vector4());
    path.push(new THREE.Vector4());
    flags.push(new THREE.Vector4());
  }
  const vec3 = (hex) => new THREE.Vector3(...linear(hex));
  return {
    uSegment: { value: segment },
    uWidths: { value: widths },
    uPath: { value: path },
    uFlags: { value: flags },
    uCount: { value: count },
    uAsphalt: { value: vec3(P.road.asphalt) },
    uHighway: { value: vec3(P.road.highway) },
    uWalk: { value: vec3(P.road.walk) },
    uShoulder: { value: vec3(P.road.shoulder) },
    uCurb: { value: vec3(P.road.curb) },
    uLine: { value: vec3(P.road.line) },
    uMedian: { value: vec3(P.road.median) },
  };
}

export function roadMaterial(paths, P) {
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const uniforms = uniformsFor(paths, P);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <color_fragment>', BODY);
  };
  material.customProgramCacheKey = () => 'road-distance-field';
  return material;
}

/** 路面网格。平地是一块平板；坡上按 deckHeight 起伏，路面横向保持水平。 */
export function roadMesh(paths, P, deckHeight) {
  const span = 3;
  const steps = deckHeight ? 96 : 1;
  const geometry = new THREE.PlaneGeometry(span, span, steps, steps);
  geometry.rotateX(-Math.PI / 2);
  if (deckHeight) {
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      position.setY(i, deckHeight(position.getX(i), position.getZ(i)));
    }
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, roadMaterial(paths, P));
  mesh.frustumCulled = false;
  return mesh;
}
