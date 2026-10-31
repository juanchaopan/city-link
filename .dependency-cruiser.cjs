// 架构规则：共用库的依赖方向、客户端五层、服务端模块化单体。
// 说明见 docs/architecture/overview.md 和 .claude/rules/。由 scripts/arch-check.mjs 运行（pnpm arch），违反任何一条，自检和 CI 都会失败。
const client = '^apps/client/src';
const server = '^apps/server/src';
const pixi = 'node_modules/(pixi[.]js|@pixi|yoga-layout)/';
const cloudSdk = 'node_modules/wx-server-sdk/';

const clientEntries = [`${client}/main[.]web[.]ts$`, `${client}/gallery/`];

module.exports = {
  forbidden: [
    {
      name: 'no-unresolvable',
      comment: '解析不了的依赖会让下面的规则失效，通常是忘了声明，或者引用了不允许的包。',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'libs-independent-of-apps',
      comment: '共用库是最底层，不能依赖 apps。',
      severity: 'error',
      from: { path: '^libs/' },
      to: { path: '^apps/' },
    },
    {
      name: 'libs-platform-free',
      comment: '共用库要在手机和云函数两端运行，不能依赖 Pixi 或云开发 SDK。',
      severity: 'error',
      from: { path: '^libs/' },
      to: { path: [pixi, cloudSdk] },
    },
    {
      name: 'protocol-independent',
      comment: 'libs/protocol 不依赖其他库。',
      severity: 'error',
      from: { path: '^libs/protocol/' },
      to: { path: '^libs/(sim|terrain)/' },
    },
    {
      name: 'terrain-independent',
      comment: 'libs/terrain 不依赖其他库。',
      severity: 'error',
      from: { path: '^libs/terrain/' },
      to: { path: '^libs/(protocol|sim)/' },
    },
    {
      name: 'sim-depends-on-protocol-only',
      comment: 'libs/sim 只能依赖 libs/protocol。',
      severity: 'error',
      from: { path: '^libs/sim/' },
      to: { path: '^libs/terrain/' },
    },
    {
      name: 'client-platform-is-lowest',
      comment: 'platform 是客户端最底层，只能依赖 libs/protocol。',
      severity: 'error',
      from: { path: `${client}/platform/` },
      to: { path: [`${client}/(net|game|render|ui|gallery)/`, '^libs/(sim|terrain)/'] },
    },
    {
      name: 'client-platforms-isolated',
      comment: '微信实现和网页实现互不依赖，只共用 platform 的接口。',
      severity: 'error',
      from: { path: `${client}/platform/(web|wx)/` },
      to: { path: `${client}/platform/(web|wx)/`, pathNot: `${client}/platform/$1/` },
    },
    {
      name: 'client-net-below-game',
      comment: 'net 只能依赖 platform 和 libs/protocol。',
      severity: 'error',
      from: { path: `${client}/net/` },
      to: { path: [`${client}/(game|render|ui|gallery)/`, '^libs/(sim|terrain)/'] },
    },
    {
      name: 'client-game-below-render',
      comment: 'game 不依赖绘制、界面和平台，这样模拟可以脱离画面运行和测试。',
      severity: 'error',
      from: { path: `${client}/game/` },
      to: { path: [`${client}/(platform|render|ui|gallery)/`, pixi] },
    },
    {
      name: 'client-game-terrain-types-only',
      comment: 'game 只用 libs/terrain 的类型，地形由服务端生成。',
      severity: 'error',
      from: { path: `${client}/game/` },
      to: { path: '^libs/terrain/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'client-render-below-ui',
      comment: 'render 只读 game 的状态，不依赖 net 和 ui。',
      severity: 'error',
      from: { path: `${client}/render/` },
      to: { path: `${client}/(net|ui|gallery)/` },
    },
    {
      name: 'client-ui-through-game',
      comment: 'ui 通过 game 和 render 的展示接口工作，不直接访问 net 和 platform。',
      severity: 'error',
      from: { path: `${client}/ui/` },
      to: { path: `${client}/(net|platform|gallery)/` },
    },
    {
      name: 'client-server-boundary',
      comment: '只有网页入口和效果页能引用服务端，而且只能引用内存后端入口。',
      severity: 'error',
      from: { path: `${client}/` },
      to: { path: '^apps/server/', pathNot: `${server}/memory[.]ts$` },
    },
    {
      name: 'client-memory-backend-entries-only',
      comment: '内存后端只进网页版，不能进微信包。',
      severity: 'error',
      from: { path: `${client}/`, pathNot: clientEntries },
      to: { path: '^apps/server/' },
    },
    {
      name: 'server-independent-of-client',
      comment: '服务端不依赖客户端。',
      severity: 'error',
      from: { path: '^apps/server/' },
      to: { path: '^apps/client/' },
    },
    {
      name: 'server-handler-through-services',
      comment: 'handler 只调用模块公开接口和 libs/protocol，不跳过 service。',
      severity: 'error',
      from: { path: `${server}/handler/` },
      to: { path: [`${server}/adapters/`, '/repository/', '^libs/(sim|terrain)/'] },
    },
    {
      name: 'server-service-not-up',
      comment: 'service 不依赖 handler 和具体的 adapters。',
      severity: 'error',
      from: { path: '/modules/[^/]+/service/' },
      to: { path: [`${server}/handler/`, `${server}/adapters/`] },
    },
    {
      name: 'server-repository-is-interface',
      comment: 'repository 只定义数据访问接口，不依赖 service、handler 和 adapters。',
      severity: 'error',
      from: { path: '/modules/[^/]+/repository/' },
      to: { path: ['/service/', `${server}/handler/`, `${server}/adapters/`] },
    },
    {
      name: 'server-adapters-implement-repositories',
      comment: 'adapters 只实现 repository 接口，不依赖 service 和 handler。',
      severity: 'error',
      from: { path: `${server}/adapters/` },
      to: { path: ['/service/', `${server}/handler/`] },
    },
    {
      name: 'server-modules-public-interface',
      comment: '模块之间只能通过对方的 index.ts 调用，不能访问对方内部。',
      severity: 'error',
      from: { path: `${server}/modules/([^/]+)/` },
      to: { path: `${server}/modules/[^/]+/.+/`, pathNot: `${server}/modules/$1/` },
    },
    {
      name: 'server-sdk-in-cloudbase-adapter',
      comment: '云开发 SDK 只能出现在 adapters/cloudbase。',
      severity: 'error',
      from: { path: '^apps/', pathNot: `${server}/adapters/cloudbase/` },
      to: { path: cloudSdk },
    },
    {
      name: 'no-circular',
      comment: '不允许循环依赖。',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        '[.]test[.]ts$',
        '[.]config[.]ts$',
        '/dist/',
        '^apps/client/(e2e|vite)/',
        '^apps/server/scripts/',
      ],
    },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'browser', 'default', 'types'],
      extensions: ['.ts', '.mjs', '.js', '.json'],
    },
  },
};
