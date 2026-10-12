import { Config } from '@remotion/cli/config';

// ─────────────────────────────────────────────────────────────
// Remotion 渲染配置
//
// 版本锚定：remotion@4.0.534（--save-exact，禁 ^）。
// 4.0.x 必须显式 --gl=angle，否则 Chrome Headless Shell 可能产出空白 canvas。
// 此处把 angle 写进配置，保证 `npx remotion render` 漏参数时也不会静默出空片。
// ─────────────────────────────────────────────────────────────

Config.setVideoImageFormat('jpeg');
Config.setConcurrency(4);

// 4.0.x 必填项：不设则可能渲染出空白 canvas。
Config.setChromiumOpenGlRenderer('angle');
