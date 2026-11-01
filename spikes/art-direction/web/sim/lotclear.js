// 锐角路口的小地块让路。地块按网格的原子算，路口的圆角是平滑并集，会超出网格，
// 所以半格大小的小三角尖角可能伸进人行道甚至车道。这种地块放不下东西，改成空地：不放建筑、没有容量、没有出入口。

const MARGIN = 0.03;
const STEPS = 6;

function touchesRoad(polygon, field) {
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    for (let k = 0; k < STEPS; k += 1) {
      const t = k / STEPS;
      if (field.walk(ax + (bx - ax) * t, ay + (by - ay) * t) < MARGIN) return true;
    }
  }
  return false;
}

/** 返回被腾空的地块数。 */
export function clearLots(parcels, field) {
  let cleared = 0;
  for (const parcel of parcels) {
    const small =
      parcel.shape === 'triangle' || (parcel.shape === 'green' && parcel.use !== 'lawn');
    if (!small || !parcel.polygon || !touchesRoad(parcel.polygon, field)) continue;
    parcel.shape = 'green';
    parcel.use = 'bare';
    parcel.capacity = 0;
    parcel.access = -1;
    cleared += 1;
  }
  return cleared;
}
