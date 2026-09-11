import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径：Tauri 打包后从自定义协议加载资源，绝对路径会 404
  base: './',

  // Tauri 环境下不要把 Rust 侧的日志清屏
  clearScreen: false,

  server: {
    port: 8080,
    strictPort: true,
    watch: {
      // src-tauri 里是 Rust 的编译产物：几 GB、几十万个文件。
      // Vite 的文件监视器盯着它，HMR 会被拖到几乎不可用
      ignored: ['**/src-tauri/**'],
    },
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
