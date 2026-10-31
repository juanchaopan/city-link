import cloud from 'wx-server-sdk';

// 官方写法就是传这个常量，但 SDK 的类型声明没有收录它的 symbol 类型。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });

/** 调用者的 openid。定时触发器没有用户，返回空字符串。 */
export function currentOpenid(): string {
  return cloud.getWXContext().OPENID ?? '';
}
