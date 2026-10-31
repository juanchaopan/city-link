// 给物业选外观。规格决定占地和玩法，外观只是同一规格里的不同样子，不影响面积、容量和结算。
// 同规格的相邻物业不要长得一样：按固定顺序逐个选，避开已经选好的邻居，种子相同结果就相同。

const NEIGHBOR_DISTANCE = 3.5;
const LOOKS = { rect: 2, diagonal: 2, bigTriangle: 2, triangle: 2 };

function hash(seed, a, b) {
  let h = Math.imul(seed ^ 0x2f0b4a87, 0x9e3779b1);
  h = Math.imul(h ^ a, 0x85ebca6b);
  h = Math.imul(h ^ b, 0xc2b2ae35);
  return (h ^ (h >>> 15)) >>> 0;
}

export function sizeGroup(parcel) {
  return `${parcel.shape}|${String(parcel.zone)}|${String(parcel.level)}|${String(parcel.spanU)}x${String(parcel.spanV)}`;
}

/** looksOf(parcel) 是这个规格一共有几种外观。返回每个物业的外观编号。 */
export function chooseLooks(parcels, seed, looksOf = (parcel) => LOOKS[parcel.shape] ?? 1) {
  const chosen = new Map();
  const groups = new Map();
  for (const parcel of parcels) {
    const key = sizeGroup(parcel);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(parcel);
  }
  for (const key of [...groups.keys()].sort()) {
    const members = groups.get(key);
    members.forEach((parcel, index) => {
      const total = looksOf(parcel);
      const taken = new Set();
      for (let i = 0; i < index; i += 1) {
        const other = members[i];
        if (Math.hypot(other.px - parcel.px, other.py - parcel.py) <= NEIGHBOR_DISTANCE) taken.add(chosen.get(other.id));
      }
      const start = hash(seed, Math.round(parcel.px * 2), Math.round(parcel.py * 2)) % total;
      let look = start;
      for (let step = 0; step < total; step += 1) {
        const candidate = (start + step) % total;
        if (!taken.has(candidate)) {
          look = candidate;
          break;
        }
      }
      chosen.set(parcel.id, look);
    });
  }
  return chosen;
}

/** 相邻且同规格同外观的物业对数，这个数越接近 0，街景越不重复。 */
export function repeatedNeighbors(parcels, lookOf) {
  let repeats = 0;
  let pairs = 0;
  for (let i = 0; i < parcels.length; i += 1) {
    for (let j = i + 1; j < parcels.length; j += 1) {
      const a = parcels[i];
      const b = parcels[j];
      if (sizeGroup(a) !== sizeGroup(b)) continue;
      if (Math.hypot(a.px - b.px, a.py - b.py) > NEIGHBOR_DISTANCE) continue;
      pairs += 1;
      if (lookOf(a) === lookOf(b)) repeats += 1;
    }
  }
  return { pairs, repeats };
}
