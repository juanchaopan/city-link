import { LayoutContainer } from '@pixi/layout/components';
import type { ConnectionState } from '../game/connection';
import { createWebPlatform } from '../platform/web';
import { createStage } from '../render/stage';
import { createStatusPill } from '../ui/status-pill';
import { createText } from '../ui/text';
import { tokens } from '../ui/tokens';

// 效果页：用固定内容展示视觉规范和界面组件，供人工查看和截图回归。
const CONNECTION_STATES: ConnectionState[] = ['connecting', 'online', 'offline', 'outdated'];
const SWATCH_SIZE = 40;

const { color, fontSize, space, radius } = tokens;

function section(title: string): LayoutContainer {
  const view = new LayoutContainer({
    layout: { flexDirection: 'column', alignItems: 'flex-start', gap: space.s },
  });
  view.addChild(createText(title, { fill: color.textSecondary, fontSize: fontSize.caption }));
  return view;
}

function swatch(value: number): LayoutContainer {
  return new LayoutContainer({
    layout: {
      width: SWATCH_SIZE,
      height: SWATCH_SIZE,
      borderRadius: radius.s,
      borderWidth: 1,
      borderColor: color.textSecondary,
      backgroundColor: value,
    },
  });
}

function colorSection(): LayoutContainer {
  const view = section('颜色');
  const row = new LayoutContainer({
    layout: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  });
  for (const value of Object.values(color)) row.addChild(swatch(value));
  view.addChild(row);
  return view;
}

function typeSection(): LayoutContainer {
  const view = section('字号');
  for (const [name, size] of Object.entries(fontSize)) {
    view.addChild(createText(`${name} 城市规划`, { fill: color.textPrimary, fontSize: size }));
  }
  return view;
}

function statusSection(): LayoutContainer {
  const view = section('连接状态');
  for (const state of CONNECTION_STATES) view.addChild(createStatusPill(state).view);
  return view;
}

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('页面里没有 #game 画布');

const platform = createWebPlatform(canvas, () => Promise.reject(new Error('效果页不访问服务端')));
const app = await createStage(platform, color.background);
const { width, height } = platform.viewport();

const page = new LayoutContainer({
  layout: { width, height, padding: space.l, flexDirection: 'column', gap: space.xl },
});
page.addChild(colorSection(), typeSection(), statusSection());
app.stage.addChild(page);

app.ticker.addOnce(() => {
  document.documentElement.dataset.ready = 'true';
});
