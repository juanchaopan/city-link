import { LayoutContainer } from '@pixi/layout/components';
import type { ConnectionState } from '../game/connection';
import { createText } from './text';
import { tokens } from './tokens';

const { color, fontSize, radius, space } = tokens;

const appearance: Record<ConnectionState, { label: string; fill: number }> = {
  connecting: { label: '连接中', fill: color.surface },
  online: { label: '已连接', fill: color.success },
  offline: { label: '未同步，可继续建造', fill: color.warning },
  outdated: { label: '请更新小游戏', fill: color.danger },
};

export interface StatusPill {
  readonly view: LayoutContainer;
  show(state: ConnectionState): void;
}

export function createStatusPill(initial: ConnectionState): StatusPill {
  const view = new LayoutContainer();
  const label = createText('', { fill: color.textPrimary, fontSize: fontSize.body });
  view.addChild(label);

  const show = (state: ConnectionState) => {
    const { label: text, fill } = appearance[state];
    label.text = text;
    view.layout = {
      paddingLeft: space.m,
      paddingRight: space.m,
      paddingTop: space.xs,
      paddingBottom: space.xs,
      borderRadius: radius.s,
      backgroundColor: fill,
    };
  };

  show(initial);
  return { view, show };
}
