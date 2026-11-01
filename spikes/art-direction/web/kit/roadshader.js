import * as THREE from 'three';
import { linear } from './builder.js';
import { ROAD_SPEC } from '../sim/network.js';
import { junctionRays } from '../sim/roadfield.js';

// 路面用距离场在片元里画。一格路的精灵会盖到邻格，所以拼接要靠下面四条规则，而不是靠相邻格碰巧对齐：
// 1. 路面分三层绘制，全图的人行道、路缘、车道各画一遍。后画的层永远盖住先画的层，
//    人行道和路缘因此不可能出现在车道上，不管相邻格怎么排列。
// 2. 裁剪按整条路做，不按线段做。否则弯道折线中间的端点会带着圆头越过格子边界。
// 3. 路口的圆角来自各方向沿直线延长后的平滑并集，只取比直路多出来的部分，垫在夹角里。
//    对向的两个方向算一条直线，直通的一侧不会鼓包。延长线到邻格中心为止，见 junctionRays。
// 4. 夹角里的这块垫片在路口这一格的精灵里，它旁边的直路在邻格的精灵里，两张精灵的边缘都是半透明的。
//    如果垫片刚好停在直路边上，两层半透明叠起来还是漏，下面一层的颜色会透出一条细线。
//    所以垫片往直路里多铺 PAD_OVERLAP，直路的抗锯齿边落在垫片的实色上。
// 斑马线和停车线不在这里，它们是单独一层精灵，位置由 sim/junctions.js 算好。
// 环岛的环路是一个圆环的距离，和进口做平滑并集，进出口自然带圆角。

export const MAX_SEGMENTS = 32;
const MAX_RAYS = 8;
const CLIP_OVERLAP = 0.016;
const PAD_OVERLAP = 0.03;
const RING_ROUND = 0.3;
const RING_MARK_LIMIT = 2.05;

export const LAYER = { walk: 0, curb: 1, deck: 2, both: 3 };

// 标线样式写在 uWidths.w：0 是两车道的中心虚线，1 是四车道的双黄线加车道线，2 是匝道，没有标线。
const MARKING = { road: 0, arterial: 1, ramp: 2 };

const HEADER = `
  #define MAX_SEGMENTS ${String(MAX_SEGMENTS)}
  #define MAX_RAYS ${String(MAX_RAYS)}
  uniform vec4 uSegment[MAX_SEGMENTS];
  uniform vec4 uWidths[MAX_SEGMENTS];
  uniform vec4 uPath[MAX_SEGMENTS];
  uniform vec4 uFlags[MAX_SEGMENTS];
  uniform vec4 uClipA[MAX_SEGMENTS];
  uniform vec4 uClipB[MAX_SEGMENTS];
  uniform vec4 uRay[MAX_RAYS];
  uniform float uRayBack[MAX_RAYS];
  uniform float uRayReach[MAX_RAYS];
  uniform vec3 uRing;
  uniform int uCount;
  uniform int uRayCount;
  uniform int uLayer;
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
  float bestD = 1e3;
  float bestU = 0.0;
  float bestV = 0.0;
  int best = -1;
  for (int i = 0; i < uCount; i++) {
    bool outside = false;
    if (uClipA[i].z != 0.0 || uClipA[i].w != 0.0) outside = dot(p - uClipA[i].xy, uClipA[i].zw) > ${CLIP_OVERLAP.toFixed(3)};
    if (uClipB[i].z != 0.0 || uClipB[i].w != 0.0) outside = outside || dot(p - uClipB[i].xy, uClipB[i].zw) > ${CLIP_OVERLAP.toFixed(3)};
    if (outside) continue;
    vec2 a = uSegment[i].xy;
    vec2 b = uSegment[i].zw;
    vec2 ba = b - a;
    float len = length(ba);
    vec2 dir = ba / len;
    vec2 pa = p - a;
    float t = dot(pa, dir);
    float side = dot(pa, vec2(-dir.y, dir.x));
    float ct = t;
    if (uFlags[i].y < 0.5) ct = max(ct, 0.0);
    if (uFlags[i].z < 0.5) ct = min(ct, len);
    float d = length(p - (a + dir * ct));
    walk = min(walk, d - uWidths[i].x);
    deck = min(deck, d - uWidths[i].y);
    if (d < bestD) {
      bestD = d;
      best = i;
      bestU = uPath[i].x + ct;
      bestV = side;
    }
  }

  float roundWalk = 1e3;
  float roundDeck = 1e3;
  float rawWalk = 1e3;
  float rawDeck = 1e3;
  for (int i = 0; i < uRayCount; i++) {
    vec2 dir = uRay[i].xy;
    float t = clamp(dot(p, dir), -uRayBack[i], uRayReach[i]);
    float d = length(p - dir * t);
    rawWalk = min(rawWalk, d - uRay[i].z);
    rawDeck = min(rawDeck, d - uRay[i].w);
    roundWalk = smin(roundWalk, d - uRay[i].z, 0.24);
    roundDeck = smin(roundDeck, d - uRay[i].w, 0.36);
  }
  bool ringed = uRing.x > 0.0;
  if (ringed) {
    float around = abs(length(p) - uRing.x);
    walk = smin(walk, around - uRing.y, ${RING_ROUND.toFixed(2)});
    deck = smin(deck, around - uRing.z, ${RING_ROUND.toFixed(2)});
  }
  bool padWalk = uRayCount > 1 && roundWalk < 0.0 && rawWalk > -${PAD_OVERLAP.toFixed(3)};
  bool padDeck = uRayCount > 1 && roundDeck < 0.0 && rawDeck > -${PAD_OVERLAP.toFixed(3)};
  bool inWalk = walk < 0.0 || padWalk;
  bool inDeck = deck < 0.0 || padDeck;
  float edge = uRayCount > 1 ? min(deck, roundDeck) : deck;
  bool inCurb = inWalk && edge >= 0.0 && edge < 0.016;

  if (uLayer == 0 && !inWalk) discard;
  if (uLayer == 1 && !inCurb) discard;
  if (uLayer == 2 && !inDeck) discard;
  if (uLayer == 3 && !inWalk && !inDeck) discard;

  float highway = best >= 0 ? uWidths[best].z : 0.0;
  float marking = best >= 0 ? uWidths[best].w : 0.0;
  vec3 color = mix(uWalk, uShoulder, highway);
  if (uLayer == 1 || (uLayer == 3 && inCurb)) color = uCurb;
  bool ringMarks = !ringed || length(p) > ${RING_MARK_LIMIT.toFixed(2)};
  if (uLayer >= 2 && inDeck) {
    color = mix(uAsphalt, uHighway, highway);
    if (deck < 0.0 && best >= 0 && marking < 1.5 && ringMarks) {
      float pathLength = uPath[best].y;
      float crossAt = uPath[best].z;
      float halfDeck = uWidths[best].y;
      float period = pathLength / max(1.0, floor(pathLength / 0.25 + 0.5));
      float dash = abs(fract(bestU / period + 0.5) - 0.5) * period;
      bool junction = uRayCount > 1;
      bool marked = !junction || (crossAt > 0.0 && bestU > crossAt + 0.15);
      if (highway > 0.5) {
        if (!junction || bestU > 0.5) {
          if (abs(bestV) < 0.026) color = uMedian;
          else if (abs(abs(bestV) - 0.205) < 0.008 && dash < period * 0.25) color = uLine;
          else if (abs(abs(bestV) - 0.37) < 0.006) color = uLine;
        }
      } else if (marking > 0.5) {
        if (marked && abs(abs(bestV) - 0.016) < 0.006) color = uLine;
        else if (marked && abs(abs(bestV) - halfDeck * 0.52) < 0.006 && dash < period * 0.27) color = uLine;
      } else if (marked && abs(bestV) < 0.007 && dash < period * 0.27) color = uLine;
    }
  }
  diffuseColor.rgb = color;
  diffuseColor.a = 1.0;
`;

const unit = (a, b) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  return [dx / length, dz / length];
};

const blank = () => new THREE.Vector4(0, 0, 0, 0);

function uniformsFor(paths, P, layer, ring) {
  const segment = [];
  const widths = [];
  const path = [];
  const flags = [];
  const clipA = [];
  const clipB = [];
  paths.forEach((entry, index) => {
    const spec = ROAD_SPEC[entry.kind];
    const { points } = entry;
    let total = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    }
    const startDir = unit(points[1], points[0]);
    const endDir = unit(points[points.length - 2], points[points.length - 1]);
    const first = points[0];
    const last = points[points.length - 1];
    const fast = entry.kind === 'highway' || entry.kind === 'express' || entry.kind === 'ramp';
    let start = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const walk = entry.widths ? entry.widths[i].walk : spec.walk;
      const deck = entry.widths ? entry.widths[i].deck : spec.deck;
      segment.push(new THREE.Vector4(ax, az, bx, bz));
      widths.push(new THREE.Vector4(walk / 2, deck / 2, fast ? 1 : 0, MARKING[entry.kind] ?? 0));
      path.push(new THREE.Vector4(start, total, entry.cross, 0));
      flags.push(
        new THREE.Vector4(
          index,
          entry.clipStart && i === 0 ? 1 : 0,
          entry.clipEnd && i === points.length - 2 ? 1 : 0,
          0,
        ),
      );
      clipA.push(
        entry.clipStart ? new THREE.Vector4(first[0], first[1], startDir[0], startDir[1]) : blank(),
      );
      clipB.push(
        entry.clipEnd ? new THREE.Vector4(last[0], last[1], endDir[0], endDir[1]) : blank(),
      );
      start += Math.hypot(bx - ax, bz - az);
    }
  });
  const count = segment.length;
  if (count > MAX_SEGMENTS)
    throw new Error(
      `路面有 ${String(count)} 段，着色器最多 ${String(MAX_SEGMENTS)} 段，多出来的路面画不出来`,
    );
  while (segment.length < MAX_SEGMENTS) {
    segment.push(blank());
    widths.push(blank());
    path.push(blank());
    flags.push(blank());
    clipA.push(blank());
    clipB.push(blank());
  }
  const rays = junctionRays(paths);
  const rayData = rays.map((ray) => new THREE.Vector4(ray.dx, ray.dz, ray.walk, ray.deck));
  const rayBack = rays.map((ray) => ray.back);
  const rayReach = rays.map((ray) => ray.reach);
  while (rayData.length < MAX_RAYS) {
    rayData.push(blank());
    rayBack.push(0);
    rayReach.push(0);
  }
  const vec3 = (hex) => new THREE.Vector3(...linear(hex));
  return {
    uSegment: { value: segment },
    uWidths: { value: widths },
    uPath: { value: path },
    uFlags: { value: flags },
    uClipA: { value: clipA },
    uClipB: { value: clipB },
    uRay: { value: rayData },
    uRayBack: { value: rayBack },
    uRayReach: { value: rayReach },
    uRing: {
      value: ring ? new THREE.Vector3(ring.radius, ring.walk, ring.deck) : new THREE.Vector3(),
    },
    uCount: { value: count },
    uRayCount: { value: rays.length },
    uLayer: { value: layer },
    uAsphalt: { value: vec3(P.road.asphalt) },
    uHighway: { value: vec3(P.road.highway) },
    uWalk: { value: vec3(P.road.walk) },
    uShoulder: { value: vec3(P.road.shoulder) },
    uCurb: { value: vec3(P.road.curb) },
    uLine: { value: vec3(P.road.line) },
    uMedian: { value: vec3(P.road.median) },
  };
}

function roadMaterial(paths, P, layer, ring) {
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const uniforms = uniformsFor(paths, P, layer, ring);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <color_fragment>', BODY);
  };
  material.customProgramCacheKey = () => 'road-distance-field-layered';
  return material;
}

/** 路面网格。平地是一块平板；坡上按 deckHeight 起伏，路面横向保持水平。 */
export function roadMesh(paths, P, deckHeight, layer, span = 3.6, resolution = 120, ring = null) {
  const steps = deckHeight ? resolution : 1;
  const geometry = new THREE.PlaneGeometry(span, span, steps, steps);
  geometry.rotateX(-Math.PI / 2);
  if (deckHeight) {
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      position.setY(i, deckHeight(position.getX(i), position.getZ(i)));
    }
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, roadMaterial(paths, P, layer, ring));
  mesh.frustumCulled = false;
  return mesh;
}
