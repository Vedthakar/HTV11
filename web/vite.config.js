import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// Two pages: the mission map (index.html, React + TS) and the capture studio (studio.html, vanilla JS).
export default defineConfig({
  plugins:[react()],
  build:{rollupOptions:{input:{main:'index.html',studio:'studio.html'}}},
  server:{proxy:{'/api':{target:process.env.HTV_BACKEND_URL || 'http://127.0.0.1:8008',ws:true}}},
});
