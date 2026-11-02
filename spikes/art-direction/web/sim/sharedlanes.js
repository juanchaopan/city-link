// 共用一段路面的 lane。丁字立交的两条匝道在地面路口前并成一条路，也从同一个路口出发走一段才分开；
// 匝道并入主线、从主线分出去时，匝道和主线也有一段贴在一起。
// 每条 lane 只看自己的队伍时，这一段上的车会叠在一起，所以这一段算一支队：按到共用端点的距离排，
// 后面的车跟着前面的车，不管前车是哪条 lane。并成一条之前留一段 APPROACH，两边的车交替进来，不会到了并口才发现撞上。
// 过了端点 BODY 以内的车还算在队里，后车要给它留出车身。
//
// 一支队 stretch：fromTail 为真时共用段在端点之前，为假时在端点之后；ends 是每条 lane 上端点的里程，
// reach 是每条 lane 上共用段的长度。

const TOUCH = 0.2;
const STEP = 0.05;
const APPROACH = 0.8;
const BODY = 0.3;

/** 从共用端点量起，两条 lane 靠得比车身还近的长度。 */
function sharedLength([a, endA], [b, endB], fromTail, pointAt) {
  const room = (lane, end) => (fromTail ? end : lane.path.length - end);
  const limit = Math.min(room(a, endA), room(b, endB));
  const at = (lane, end, distance) =>
    pointAt(lane.path, fromTail ? end - distance : end + distance);
  let reach = 0;
  for (let distance = 0; distance <= limit; distance += STEP) {
    const p = at(a, endA, distance);
    const q = at(b, endB, distance);
    if (Math.hypot(p.x - q.x, p.y - q.y) > TOUCH || Math.abs(p.h - q.h) > TOUCH) break;
    reach = distance;
  }
  return reach;
}

/** members 是几对 [lane, 端点里程]。全都分得开时没有共用段，返回 null。 */
function stretchOf(members, fromTail, pointAt) {
  const reach = new Map(
    members.map((member) => [
      member[0],
      Math.max(
        ...members
          .filter((other) => other !== member)
          .map((other) => sharedLength(member, other, fromTail, pointAt)),
      ),
    ]),
  );
  if (Math.max(...reach.values()) === 0) return null;
  return { fromTail, reach, ends: new Map(members) };
}

function byCell(lanes, cellOf) {
  const groups = new Map();
  for (const lane of lanes) {
    const cell = cellOf(lane);
    if (cell === undefined) continue;
    if (!groups.has(cell)) groups.set(cell, []);
    groups.get(cell).push(lane);
  }
  return [...groups.values()].filter((members) => members.length > 1);
}

/** lanes 带着量好的 path。返回全部共用段。 */
export function sharedStretches(lanes, pointAt) {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const stretches = [];
  const add = (members, fromTail) => stretches.push(stretchOf(members, fromTail, pointAt));
  for (const members of byCell(lanes, ({ toCell }) => toCell)) {
    add(
      members.map((lane) => [lane, lane.path.length]),
      true,
    );
  }
  for (const members of byCell(lanes, ({ fromCell }) => fromCell)) {
    add(
      members.map((lane) => [lane, 0]),
      false,
    );
  }
  for (const lane of lanes) {
    if (lane.merge) {
      const main = laneById.get(lane.merge.lane);
      const members = [
        [lane, lane.path.length],
        [main, main.path.along[lane.merge.at]],
      ];
      add(members, true);
    }
    for (const exit of lane.exits ?? []) {
      const members = [
        [lane, lane.path.along[exit.at]],
        [laneById.get(exit.lane), 0],
      ];
      add(members, false);
    }
  }
  return stretches.filter(Boolean);
}

/** 车到共用端点的距离，过了端点是负的。 */
export function distanceToEnd({ fromTail, ends }, car) {
  const end = ends.get(car.lane);
  return fromTail ? end - car.s : car.s - end;
}

/** 这辆车算不算这支队里的：在共用段上，或者快要并进来，或者刚过端点。走远了就不算了。 */
export function inStretch(stretch, car) {
  if (car.mode !== 'lane' || !stretch.reach.has(car.lane)) return false;
  const distance = distanceToEnd(stretch, car);
  const window = stretch.reach.get(car.lane) + (stretch.fromTail ? APPROACH : 0);
  return distance > -BODY && distance < window;
}
