import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser',workers:1,use:{baseURL:'http://127.0.0.1:5174',headless:true},webServer:{command:'npx tsx tests/browser-server.ts',url:'http://127.0.0.1:5174',timeout:120000,reuseExistingServer:false},reporter:'list'});
