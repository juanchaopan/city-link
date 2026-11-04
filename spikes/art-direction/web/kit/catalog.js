import { hashString } from './builder.js';
import { addHeadlightBeam, buildPiece, buildPierSprite, buildViaduct } from './interchange.js';
import { buildBlank, buildCrossing, buildRoundabout, buildStopLine } from './marks.js';
import { buildModule } from './modules.js';
import { buildObject } from './objects.js';
import { buildLamp, buildPole, faceVisible } from './signal.js';
import { buildBusStop, buildMetroHall, buildServiceIcon } from './signs.js';
import {
  buildBank,
  buildBridge,
  buildField,
  buildGround,
  buildMeadow,
  buildPlannedEnd,
  buildRoad,
  buildSkirt,
  buildSlopeRoad,
  buildWater,
  LAYER,
  waterLevel,
} from './tiles.js';
import { BLANK_LENGTHS } from '../sim/blanks.js';
import { SERVICES } from '../sim/services.js';
import { cornersOfShape } from '../sim/surface.js';

// 精灵的名字决定它的画法，生成器只需要知道名字。类别用来分别统计数量和耗时。
// 路面名字：rw、rc、rd 是人行道、路缘、车道三层，r 是三层合一，只用于界面缩略图；坡上的路加前缀 s。
// 路面名字的第二段是普通路方向位，有双向四车道时写成 普通路_四车道，第三段是高速方向位。
// 路面标记：xw 是斑马线，sl 是停车线，xb-种类-朝向-长度序号 是停车线以内的路面色底，rb 是整个环岛。
// 高架：ev-走向-起点高度-终点高度，高度是百分之一层。ixp-模板-序号 是立交的一小块，
// pr-高度-方向-横梁宽度 是一根桥墩，横梁宽度是百分之一格。
// 这三种用同一块画布，渲染目标不用反复换尺寸，烘焙时显存不会一阵一阵涨。
// 信号灯：pole-方向 是灯杆和灯箱，lamp-方向 是灯面。公共设施：si 图标牌，bs 公交站，ms 地铁站厅。
// 树林：forest-种类-棵数，影子烘在水平面上；坡上的树林名字后面带 bare，不烘影子。

const flags = (text) => [...text].map((c) => c === '1');
const STRUCTURE_BOX = { w: 480, h: 420, anchorY: 280 };

function box(span, tall) {
  const w = Math.ceil((span * 128 + 240) / 40) * 40;
  const below = Math.ceil((span * 40 + 80) / 40) * 40;
  const above = Math.ceil((span * 40 + tall) / 40) * 40;
  return { w, h: above + below, anchorY: above };
}

function propertyBox(key) {
  const parts = key.split('-');
  if (parts[0] === 'Q') {
    const legs = Number(parts[2]);
    return { group: '大三角物业', span: legs, tall: 340 };
  }
  if (parts[0] === 'S' || parts[0] === 'P') {
    const [w, h] = parts[2].split('x').map(Number);
    return { group: parts[0] === 'S' ? '公共服务' : '公园广场', span: Math.max(w, h), tall: 280 };
  }
  const [w, h] = parts[2].split('x').map(Number);
  const unit = parts[3] === 'a' ? 1 : 0.72;
  return {
    group: parts[3] === 'a' ? '直角物业' : '斜向物业',
    span: Math.max(w, h) * unit + 0.6,
    tall: 420,
  };
}

const ROAD_LAYERS = {
  r: LAYER.both,
  rw: LAYER.walk,
  rc: LAYER.curb,
  rd: LAYER.deck,
  srw: LAYER.walk,
  src: LAYER.curb,
  srd: LAYER.deck,
};

const MARK_BOX = { group: '路面标记', w: 240, h: 160, anchorY: 80, lit: false };

const gradeOf = (text) => text.split('_').map((value) => Number(value.replace('n', '-')) / 1000);

function cellOf(parts) {
  const [road, arterial = '0'] = parts[1].split('_');
  return {
    road: parseInt(road, 16),
    arterial: parseInt(arterial, 16),
    highway: parseInt(parts[2], 16),
  };
}

export function specFor(key, P) {
  const parts = key.split('-');
  const kind = parts[0];
  const seed = hashString(key);
  if (kind === 'g') {
    const corners = cornersOfShape(parts[2]);
    return {
      group: '地表',
      w: 160,
      h: 170,
      anchorY: 110,
      lit: false,
      build: () => buildGround(corners, Number(parts[1]), P, seed),
    };
  }
  if (kind === 'w') {
    return {
      group: '水面和河岸',
      w: 160,
      h: 130,
      anchorY: 60,
      lit: false,
      build: () => buildWater(P, seed),
    };
  }
  if (kind === 'b') {
    return {
      group: '水面和河岸',
      w: 160,
      h: 150,
      anchorY: 60,
      lit: false,
      build: () => buildBank(flags(parts[1]), flags(parts[2]), P, seed),
    };
  }
  if (kind === 'sk') {
    return {
      group: '沙盘底座',
      w: 160,
      h: 170,
      anchorY: 60,
      lit: false,
      build: () => buildSkirt(parts[1], parts[2] === '1', P),
    };
  }
  if (kind === 'm') {
    return {
      group: '地表',
      w: 160,
      h: 120,
      anchorY: 60,
      lit: false,
      build: () => buildMeadow(P, seed),
    };
  }
  if (kind === 'f') {
    return {
      group: '农田',
      w: 160,
      h: 120,
      anchorY: 60,
      lit: false,
      build: () => buildField(Number(parts[1]), parts[2], P, seed),
    };
  }
  if (kind === 'r' || kind === 'rw' || kind === 'rc' || kind === 'rd') {
    const { build, extra } = buildRoad(cellOf(parts), P, ROAD_LAYERS[kind]);
    return { group: '线路', w: 400, h: 260, anchorY: 130, lit: false, build, extra };
  }
  if (kind === 'srw' || kind === 'src' || kind === 'srd') {
    const corners = cornersOfShape(parts[3]);
    const grade = parts[4] ? gradeOf(parts[4]) : null;
    const { build, extra } = buildSlopeRoad(cellOf(parts), corners, grade, P, ROAD_LAYERS[kind]);
    return { group: '坡上线路', w: 400, h: 340, anchorY: 200, lit: false, build, extra };
  }
  if (kind === 'xw' || kind === 'sl') {
    const draw = kind === 'xw' ? buildCrossing : buildStopLine;
    return { ...MARK_BOX, build: () => draw(parts[1], Number(parts[2]), P) };
  }
  if (kind === 'xb') {
    return {
      ...MARK_BOX,
      build: () => buildBlank(parts[1], Number(parts[2]), Number(parts[3]), P),
    };
  }
  if (kind === 'rb') {
    const { build, extra } = buildRoundabout(parseInt(parts[1], 16), parseInt(parts[2], 16), P);
    return { group: '环岛', w: 860, h: 520, anchorY: 280, lit: false, build, extra };
  }
  if (kind === 'br') {
    const { build, extra } = buildBridge(cellOf(parts), P);
    return {
      group: '桥',
      w: 320,
      h: 240,
      anchorY: 110,
      shadow: true,
      groundY: waterLevel,
      reach: 2,
      build,
      extra,
    };
  }
  if (kind === 'ev') {
    const { build } = buildViaduct(parts[1], Number(parts[2]) / 100, Number(parts[3]) / 100, P);
    return { group: '高架', ...STRUCTURE_BOX, shadow: true, reach: 2.2, build };
  }
  if (kind === 'ixp') {
    const { build, low } = buildPiece(parts[1], Number(parts[2]), P);
    if (low) return { group: '立交', ...STRUCTURE_BOX, lit: false, build };
    return { group: '立交', ...STRUCTURE_BOX, shadow: true, reach: 2.2, build };
  }
  if (kind === 'pr') {
    const wide = Number(parts[3]) / 100;
    return {
      group: '高架',
      ...STRUCTURE_BOX,
      shadow: true,
      reach: 2.2,
      build: () => buildPierSprite(Number(parts[1]), Number(parts[2]), wide, P),
    };
  }
  if (kind === 'Mp' || kind === 'Mb' || kind === 'Mr') {
    const group = { Mp: '模块·底座', Mb: '模块·楼身', Mr: '模块·屋顶' }[kind];
    const size =
      kind === 'Mp'
        ? { w: 760, h: 520, anchorY: 240 }
        : kind === 'Mb'
          ? { w: 300, h: 420, anchorY: 340 }
          : { w: 160, h: 140, anchorY: 100 };
    return {
      group,
      ...size,
      shadow: kind === 'Mp',
      reach: 3,
      lit: kind !== 'Mb' ? undefined : false,
      build: () => buildModule(key, P),
    };
  }
  if (kind === 'gate') {
    return {
      group: '道路收尾',
      w: 240,
      h: 200,
      anchorY: 110,
      shadow: true,
      reach: 1.2,
      build: () => buildPlannedEnd(parts[1], Number(parts[2]), P),
    };
  }
  if (kind === 'car' || kind === 'bus') {
    const rotation = Number(parts[kind === 'car' ? 2 : 1] ?? 0);
    const build = () => {
      const b = buildObject(key, P);
      addHeadlightBeam(b, rotation, kind === 'car' ? 0.1 : 0.18, P);
      return b;
    };
    return { group: '车船', w: 160, h: 110, anchorY: 60, lit: false, build };
  }
  if (kind === 'pole') {
    const dir = Number(parts[1]);
    return {
      group: '信号灯',
      w: 160,
      h: 150,
      anchorY: 110,
      lit: false,
      build: () => buildPole(dir, P),
    };
  }
  if (kind === 'lamp') {
    const dir = Number(parts[1]);
    return {
      group: '信号灯',
      w: 160,
      h: 150,
      anchorY: 110,
      lit: false,
      build: () => buildLamp(dir),
    };
  }
  if (kind === 'si') {
    return {
      group: '公共设施',
      w: 110,
      h: 110,
      anchorY: 55,
      lit: false,
      build: () => buildServiceIcon(parts[1], P),
    };
  }
  if (kind === 'bs') {
    return {
      group: '公共设施',
      w: 160,
      h: 130,
      anchorY: 90,
      shadow: true,
      reach: 1,
      build: () => buildBusStop(Number(parts[1]), P),
    };
  }
  if (kind === 'ms') {
    return {
      group: '公共设施',
      w: 240,
      h: 240,
      anchorY: 150,
      shadow: true,
      reach: 1.4,
      build: () => buildMetroHall(Number(parts[1]), P),
    };
  }
  if (kind === 'boat') {
    return {
      group: '车船',
      w: 220,
      h: 160,
      anchorY: 80,
      shadow: true,
      groundY: waterLevel,
      reach: 1.5,
      build: () => buildObject(key, P),
    };
  }
  if (kind === 'dock') {
    return {
      group: '码头',
      w: 320,
      h: 260,
      anchorY: 170,
      shadow: true,
      groundY: waterLevel,
      reach: 2,
      build: () => buildObject(key, P),
    };
  }
  if (kind === 'forest') {
    return {
      group: '树',
      w: 340,
      h: 330,
      anchorY: 220,
      shadow: parts[3] !== 'bare',
      reach: 2,
      build: () => buildObject(key, P),
    };
  }
  if (kind === 't' || kind === 'farmhouse') {
    return {
      group: kind === 't' ? '小三角' : '农舍',
      w: 340,
      h: 400,
      anchorY: 280,
      shadow: true,
      reach: 2,
      build: () => buildObject(key, P),
    };
  }
  const { group, span, tall } = propertyBox(key);
  return {
    group,
    ...box(span, tall),
    shadow: true,
    reach: 2.2 + span * 0.8,
    build: () => buildObject(key, P),
  };
}

/** 烘焙一张精灵。 */
export function bakeKey(baker, key, P) {
  const spec = specFor(key, P);
  return { spec, result: baker.bake(spec) };
}

const ROTATIONS = [0, 1, 2, 3, 4, 5, 6, 7];
const MARK_KINDS = ['road', 'arterial'];
const MARK_FACINGS = [0, 1, 2, 3];

/** 一批不进示例城市、但要进图集的精灵：主界面的缩略图、信号灯、动态车流用的八个方向的车、全部路面标记和公共设施。 */
export const EXTRA_KEYS = [
  'r-11-0',
  'r-0-11',
  'r-22-0',
  'br-11-0',
  ...ROTATIONS.map((dir) => `pole-${String(dir)}`),
  ...ROTATIONS.filter(faceVisible).map((dir) => `lamp-${String(dir)}`),
  ...SERVICES.map(({ id }) => `si-${id}`),
  ...ROTATIONS.filter((dir) => dir % 2 === 0).map((dir) => `bs-${String(dir)}`),
  ...[0, 1, 2, 3].map((side) => `ms-${String(side)}`),
  ...[0, 1, 2, 3].flatMap((color) =>
    ROTATIONS.map((rotation) => `car-${String(color)}-${String(rotation)}`),
  ),
  ...ROTATIONS.map((rotation) => `bus-${String(rotation)}`),
  ...MARK_KINDS.flatMap((kind) => MARK_FACINGS.map((dir) => `xw-${kind}-${String(dir)}`)),
  ...MARK_KINDS.flatMap((kind) => ROTATIONS.map((dir) => `sl-${kind}-${String(dir)}`)),
  ...MARK_KINDS.flatMap((kind) =>
    MARK_FACINGS.flatMap((dir) =>
      BLANK_LENGTHS.map((_, index) => `xb-${kind}-${String(dir)}-${String(index)}`),
    ),
  ),
];
