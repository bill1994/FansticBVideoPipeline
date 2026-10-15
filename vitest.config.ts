import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 缓存落在仓库内，避免依赖系统临时目录（受限环境下可能不可写）。
  cacheDir: '.vitest-cache',
  test: {
    // ⚠️ 含 `.tsx`：渲染期模板组件是 React 组件，测试需 JSX 渲染断言
    // （见 tests/template-render.test.tsx「渲染去重回归测试」）。
    // 纯逻辑测试（校验器 / 对齐 / 字幕纯函数）仍是 `.test.ts`。
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    reporters: ['default'],
    // 校验器是纯函数、测试极快；串行跑可避免多 worker 并发写缓存时的偶发竞态。
    fileParallelism: false,
  },
});
