import { defineConfig } from '@playwright/test';

const PORT = 4173;

// 视觉回归测试。基准图只在 Playwright 官方镜像里生成和比对，运行方式见根目录的 scripts/visual.mjs。
// Pixi 用 WebGL 绘制，容器里没有显卡，所以用 SwiftShader 软件渲染；软件渲染很慢，因此像素比固定为 1。
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  },
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixels: 20, animations: 'disabled' },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm build:web && pnpm exec vite preview --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
  },
});
