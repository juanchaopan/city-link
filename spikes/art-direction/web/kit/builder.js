import * as THREE from 'three';

// 低多边形网格的累积器。所有几何都写在一个世界里：x、z 是格子方向，y 向上。
// 每个面只有一种颜色，非索引顶点保证硬边，这就是低多边形的外观。

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function hashString(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const scratch = new THREE.Color();

export function linear(hex) {
  scratch.set(hex);
  return [scratch.r, scratch.g, scratch.b];
}

export function shade([r, g, b], factor) {
  return [r * factor, g * factor, b * factor];
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export class Builder {
  constructor(seed = 1) {
    this.random = rng(seed);
    this.positions = [];
    this.colors = [];
    this.glowPositions = [];
    this.glowColors = [];
    this.ox = 0;
    this.oy = 0;
    this.oz = 0;
    this.rot = 0;
  }

  point([x, y, z]) {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [x * c + z * s + this.ox, y + this.oy, -x * s + z * c + this.oz];
  }

  direction([x, y, z]) {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [x * c + z * s, y, -x * s + z * c];
  }

  /** 在平移和旋转后的局部坐标里画。 */
  at(x, y, z, rot, draw) {
    const saved = [this.ox, this.oy, this.oz, this.rot];
    const world = this.point([x, y, z]);
    this.ox = world[0];
    this.oy = world[1];
    this.oz = world[2];
    this.rot += rot;
    draw(this);
    [this.ox, this.oy, this.oz, this.rot] = saved;
  }

  /** 凸多边形。hint 是外法线的大致方向，用它决定绕序，省得每个面都想顺逆时针。 */
  poly(points, color, hint = [0, 1, 0], glow = false) {
    const world = points.map((p) => this.point(p));
    const n = cross(sub(world[1], world[0]), sub(world[2], world[0]));
    const flip = dot(n, this.direction(hint)) < 0;
    const positions = glow ? this.glowPositions : this.positions;
    const colors = glow ? this.glowColors : this.colors;
    for (let i = 1; i < world.length - 1; i += 1) {
      const tri = flip ? [world[0], world[i + 1], world[i]] : [world[0], world[i], world[i + 1]];
      for (const p of tri) {
        positions.push(p[0], p[1], p[2]);
        colors.push(color[0], color[1], color[2]);
      }
    }
  }

  /** 中心在 (x, z)、底面在 y 的长方体。只画相机看得见的面和顶面，省掉背面。 */
  box(x, y, z, sx, sy, sz, color, options = {}) {
    const x0 = x - sx / 2;
    const x1 = x + sx / 2;
    const z0 = z - sz / 2;
    const z1 = z + sz / 2;
    const y1 = y + sy;
    const top = options.top ?? color;
    const px = options.px ?? color;
    const pz = options.pz ?? color;
    const glow = options.glow ?? false;
    this.poly(
      [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      top,
      [0, 1, 0],
      glow,
    );
    this.poly(
      [
        [x1, y, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y, z1],
      ],
      px,
      [1, 0, 0],
      glow,
    );
    this.poly(
      [
        [x0, y, z1],
        [x1, y, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      pz,
      [0, 0, 1],
      glow,
    );
    this.poly(
      [
        [x0, y, z0],
        [x0, y1, z0],
        [x0, y1, z1],
        [x0, y, z1],
      ],
      color,
      [-1, 0, 0],
      glow,
    );
    this.poly(
      [
        [x0, y, z0],
        [x1, y, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      color,
      [0, 0, -1],
      glow,
    );
  }

  /** 双坡屋顶，屋脊沿 x 方向；axis 为 'z' 时沿 z。 */
  gable(x, y, z, sx, sz, rise, roof, wall, axis = 'x', overhang = 0.02) {
    if (axis === 'z') {
      this.at(x, y, z, Math.PI / 2, (b) =>
        b.gable(0, 0, 0, sz, sx, rise, roof, wall, 'x', overhang),
      );
      return;
    }
    const x0 = x - sx / 2 - overhang;
    const x1 = x + sx / 2 + overhang;
    const z0 = z - sz / 2 - overhang;
    const z1 = z + sz / 2 + overhang;
    const y1 = y + rise;
    this.poly(
      [
        [x0, y, z1],
        [x1, y, z1],
        [x1, y1, z],
        [x0, y1, z],
      ],
      roof,
      [0, 1, 1],
    );
    this.poly(
      [
        [x0, y, z0],
        [x1, y, z0],
        [x1, y1, z],
        [x0, y1, z],
      ],
      shade(roof, 0.92),
      [0, 1, -1],
    );
    const gx0 = x - sx / 2;
    const gx1 = x + sx / 2;
    const gz0 = z - sz / 2;
    const gz1 = z + sz / 2;
    this.poly(
      [
        [gx1, y, gz0],
        [gx1, y, gz1],
        [gx1, y1, z],
      ],
      wall,
      [1, 0, 0],
    );
    this.poly(
      [
        [gx0, y, gz0],
        [gx0, y, gz1],
        [gx0, y1, z],
      ],
      wall,
      [-1, 0, 0],
    );
    this.poly(
      [
        [x0, y - 0.012, z1],
        [x1, y - 0.012, z1],
        [x1, y, z1],
        [x0, y, z1],
      ],
      shade(roof, 0.75),
      [0, 0, 1],
    );
  }

  cylinder(x, y, z, r0, r1, h, sides, color, top = color) {
    const ring = [];
    for (let i = 0; i < sides; i += 1) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    const cap = ring.map(([c, s]) => [x + c * r1, y + h, z + s * r1]);
    if (r1 > 0) this.poly(cap, top, [0, 1, 0]);
    for (let i = 0; i < sides; i += 1) {
      const [c0, s0] = ring[i];
      const [c1, s1] = ring[(i + 1) % sides];
      const mid = [(c0 + c1) / 2, 0.15, (s0 + s1) / 2];
      if (r1 > 0) {
        this.poly(
          [
            [x + c0 * r0, y, z + s0 * r0],
            [x + c1 * r0, y, z + s1 * r0],
            [x + c1 * r1, y + h, z + s1 * r1],
            [x + c0 * r1, y + h, z + s0 * r1],
          ],
          color,
          mid,
        );
      } else {
        this.poly(
          [
            [x + c0 * r0, y, z + s0 * r0],
            [x + c1 * r0, y, z + s1 * r0],
            [x, y + h, z],
          ],
          color,
          mid,
        );
      }
    }
  }

  /** 有棱角的不规则球，用来画树冠和灌木。 */
  blob(x, y, z, rx, ry, rz, color, variation = 0.08) {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const position = geometry.getAttribute('position');
    const offsets = new Map();
    const jittered = (i) => {
      const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
      if (!offsets.has(key)) offsets.set(key, 1 + (this.random() - 0.5) * 0.28);
      const k = offsets.get(key);
      return [
        x + position.getX(i) * rx * k,
        y + position.getY(i) * ry * k,
        z + position.getZ(i) * rz * k,
      ];
    };
    for (let i = 0; i < position.count; i += 3) {
      const a = jittered(i);
      const b = jittered(i + 1);
      const c = jittered(i + 2);
      const center = [
        (a[0] + b[0] + c[0]) / 3 - x,
        (a[1] + b[1] + c[1]) / 3 - y,
        (a[2] + b[2] + c[2]) / 3 - z,
      ];
      const tone = 1 + (this.random() - 0.5) * variation * 2;
      this.poly([a, b, c], shade(color, tone), center);
    }
    geometry.dispose();
  }

  meshes() {
    const result = [];
    const toGeometry = (positions, colors) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      return geometry;
    };
    if (this.positions.length > 0) {
      result.push({ geometry: toGeometry(this.positions, this.colors), glow: false });
    }
    if (this.glowPositions.length > 0) {
      result.push({ geometry: toGeometry(this.glowPositions, this.glowColors), glow: true });
    }
    return result;
  }
}
