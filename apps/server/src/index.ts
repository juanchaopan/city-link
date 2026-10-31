import { currentOpenid } from './adapters/cloudbase/caller';
import { createGameHandler } from './app';

interface CloudContext {
  request_id?: string;
}

const handle = createGameHandler({ now: () => Date.now() });

/** 云函数入口：客户端请求都从这里进入，按 action 路由。 */
export const main = (event: unknown, context: CloudContext) =>
  handle(event, { openid: currentOpenid(), requestId: context.request_id ?? 'unknown' });
