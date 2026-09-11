import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径：Tauri 打包后从自定义协议加载资源，绝对路径会 404
  base: './',

  // Tauri 环境下不要把 Rust 侧的日志清屏
  clearScreen: false,

  server: {
    port: 8080,
    strictPort: true,
  },

  build: {
    // Tauri 的 WebView2/WKWebView 都支持现代语法，不需要降级
    target: 'esnext',
    // 素材一律走文件，不内联成 base64（否则图片会被塞进 JS 里膨胀）
    assetsInlineLimit: 0,
    // Phaser 单文件就有 1MB+，默认 500KB 的告警没意义
    chunkSizeWarningLimit: 2000,
  },
});
