// vite.config.ts
import { sveltekit } from "file:///Users/ziqi/Desktop/ShuGu/node_modules/.pnpm/@sveltejs+kit@2.49.1_@sveltejs+vite-plugin-svelte@3.1.2_svelte@4.2.20_vite@5.4.21/node_modules/@sveltejs/kit/src/exports/vite/index.js";
import { defineConfig } from "file:///Users/ziqi/Desktop/ShuGu/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.25/node_modules/vite/dist/node/index.js";
import basicSsl from "file:///Users/ziqi/Desktop/ShuGu/node_modules/.pnpm/@vitejs+plugin-basic-ssl@1.2.0_vite@5.4.21/node_modules/@vitejs/plugin-basic-ssl/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [sveltekit(), basicSsl()],
  server: {
    port: 5173,
    host: true
  },
  optimizeDeps: {
    include: ["socket.io-client"]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvemlxaS9EZXNrdG9wL1NodUd1L2FwcHMvbWFuYWdlclwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL3ppcWkvRGVza3RvcC9TaHVHdS9hcHBzL21hbmFnZXIvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL3ppcWkvRGVza3RvcC9TaHVHdS9hcHBzL21hbmFnZXIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBzdmVsdGVraXQgfSBmcm9tICdAc3ZlbHRlanMva2l0L3ZpdGUnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgYmFzaWNTc2wgZnJvbSAnQHZpdGVqcy9wbHVnaW4tYmFzaWMtc3NsJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgICBwbHVnaW5zOiBbc3ZlbHRla2l0KCksIGJhc2ljU3NsKCldLFxuICAgIHNlcnZlcjoge1xuICAgICAgICBwb3J0OiA1MTczLFxuICAgICAgICBob3N0OiB0cnVlXG4gICAgfSxcbiAgICBvcHRpbWl6ZURlcHM6IHtcbiAgICAgICAgaW5jbHVkZTogWydzb2NrZXQuaW8tY2xpZW50J11cbiAgICB9XG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBb1MsU0FBUyxpQkFBaUI7QUFDOVQsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxjQUFjO0FBRXJCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQ3hCLFNBQVMsQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFDO0FBQUEsRUFDakMsUUFBUTtBQUFBLElBQ0osTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLGNBQWM7QUFBQSxJQUNWLFNBQVMsQ0FBQyxrQkFBa0I7QUFBQSxFQUNoQztBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
