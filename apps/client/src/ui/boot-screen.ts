import { LayoutContainer } from '@pixi/layout/components';
import type { Container } from 'pixi.js';
import type { ConnectionState } from '../game/connection';
import type { Store } from '../game/store';
import { createStatusPill } from './status-pill';
import { createText } from './text';
import { tokens } from './tokens';

export interface BootScreenSize {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
}

/** 启动画面：游戏名和服务端连接状态。 */
export function createBootScreen(
  size: BootScreenSize,
  connection: Store<ConnectionState>,
): Container {
  const root = new LayoutContainer({
    layout: {
      width: size.width,
      height: size.height,
      paddingTop: size.insetTop,
      paddingBottom: size.insetBottom,
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: tokens.space.l,
    },
  });
  const title = createText('城市首席规划师', {
    fill: tokens.color.textPrimary,
    fontSize: tokens.fontSize.display,
    fontWeight: 'bold',
  });
  const status = createStatusPill(connection.get());

  root.addChild(title, status.view);
  connection.subscribe((state) => {
    status.show(state);
  });
  return root;
}
