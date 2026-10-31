import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], worker: { format: 'es' }, test: { include: ['test/**/*.test.ts'], testTimeout: 60000 } });
