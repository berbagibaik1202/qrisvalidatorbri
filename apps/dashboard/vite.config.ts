import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({root:resolve('apps/dashboard'),plugins:[react()],server:{host:'127.0.0.1',port:5173,proxy:Object.fromEntries(['/api','/v1','/health'].map(path=>[path,{target:'http://127.0.0.1:3001',changeOrigin:false}]))},build:{outDir:resolve('dist/dashboard'),emptyOutDir:true}});
