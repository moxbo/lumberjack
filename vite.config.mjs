import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: './',
  resolve: {
    dedupe: ['preact', 'preact/hooks', 'preact/compat'],
  },
  build: {
    // Optimize build for faster startup
    minify: 'esbuild',
    target: 'esnext',
    rollupOptions: {
      output: {
        // Code splitting: split rarely-used features into separate chunks
        manualChunks: (id) => {
          // Core app bundle
          if (id.includes('node_modules')) {
            // Keep core dependencies in main bundle for faster initial load
            if (id.includes('preact') || id.includes('@tanstack/react-virtual')) {
              return 'vendor';
            }
            // Split other dependencies
            return 'vendor-lazy';
          }
          // Split rarely-used dialogs and features
          if (id.includes('DCFilterDialog') || id.includes('DCFilterPanel')) {
            return 'dc-filter';
          }
          if (id.includes('/store/') && !id.includes('loggingStore')) {
            return 'store-utils';
          }
          if (id.includes('/utils/') && !id.includes('highlight') && !id.includes('msgFilter')) {
            return 'utils-lazy';
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
