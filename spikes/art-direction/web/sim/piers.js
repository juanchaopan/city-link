// 桥墩选位。桥墩的底部不能落在任何比它低的路面上：候选点按固定间距取，压到路面就沿桥向前后挪，挪不开这一跨就加长。
// 这里只算位置，不依赖图形库，素材和检查用的是同一份结果。
// 一条环形匝道会从自己头顶经过，所以比高度时逐段看，不看这条路是不是桥墩自己这一条。

const PIER_MIN = 0.55;
const PIER_RADIUS = 0.06;
const MARGIN = 0.05;
const HEIGHT_GAP = 0.3;
const SLIDE_STEP = 0.1;
const SLIDE_MAX = 0.7;

function stations(points) {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(
      along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  }
  return along;
}

function sample(points, along, s) {
  let i = 0;
  while (i < points.length - 2 && along[i + 1] < s) i += 1;
  const t = (s - along[i]) / (along[i + 1] - along[i] || 1);
  const [ax, az, ah] = points[i];
  const [bx, bz, bh] = points[i + 1];
  const length = Math.hypot(bx - ax, bz - az) || 1;
  return {
    x: ax + (bx - ax) * t,
    z: az + (bz - az) * t,
    h: ah + (bh - ah) * t,
    nx: -(bz - az) / length,
    nz: (bx - ax) / length,
  };
}

/** 平面上离这一点最近的、高度低于 top 的路段有多远。 */
function lowerDistance(points, x, z, top) {
  let distance = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az, ah] = points[i];
    const [bx, bz, bh] = points[i + 1];
    if (Math.min(ah, bh) >= top) continue;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return distance;
}

/** 这一点的桥墩会压到哪条路面。top 是桥墩顶的高度，比它低出 HEIGHT_GAP 的路面才算在桥墩下面。 */
export function pierBlocker(x, z, top, surfaces) {
  return surfaces.find(
    ({ points, half }) =>
      lowerDistance(points, x, z, top - HEIGHT_GAP) < half + PIER_RADIUS + MARGIN,
  );
}

function slideOffsets() {
  const offsets = [0];
  for (let d = SLIDE_STEP; d <= SLIDE_MAX + 1e-6; d += SLIDE_STEP) offsets.push(d, -d);
  return offsets;
}

/** 一条高架线的桥墩。surfaces 是全部路面：{ points, half }。 */
export function pierSpots({ id, points, wide, spacing }, surfaces) {
  const along = stations(points);
  const total = along[along.length - 1];
  const piers = [];
  for (let s = spacing / 2; s < total; s += spacing) {
    for (const offset of slideOffsets()) {
      const station = Math.max(0, Math.min(total, s + offset));
      const spot = sample(points, along, station);
      if (spot.h < PIER_MIN) continue;
      if (pierBlocker(spot.x, spot.z, spot.h, surfaces)) continue;
      piers.push({ ...spot, station, wide, line: id });
      break;
    }
  }
  return piers;
}

/** 最长的一跨：相邻桥墩的里程差。 */
export function longestSpan(piers) {
  let longest = 0;
  for (let i = 1; i < piers.length; i += 1)
    longest = Math.max(longest, piers[i].station - piers[i - 1].station);
  return longest;
}
