import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 0, // no timeout — profiling all elements takes a while
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1920, height: 1080 },
    headless: false, // need real GPU for accurate perf measurement
    launchOptions: {
      args: [
        '--use-gl=angle',         // enable hardware-accelerated WebGL
        '--enable-gpu-rasterization',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
