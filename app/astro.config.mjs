// @ts-check
import { defineConfig } from 'astro/config';
import solid from '@astrojs/solid-js';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { loadEnv } from 'vite';

// SynthHub PWA is a browser-native PWA (WebMIDI / WebUSB) served as static pages
// with Solid islands, plus one on-demand backend route (/api/firmware) that does
// the Music Tribe cloud lookup server-side so credentials never reach the client.
//
// Load the server-only CLOUD_* vars from .env into process.env so the API route
// can read them in dev + build. They use no PUBLIC_ prefix, so they are NEVER
// inlined into the client bundle.
const cloud = loadEnv(
  process.env.NODE_ENV ?? 'development',
  process.cwd(),
  'CLOUD_',
);
for (const [k, v] of Object.entries(cloud))
  if (v && !process.env[k]) process.env[k] = v;

export default defineConfig({
  site: 'https://synth-hub.elevatech.xyz',
  output: 'static',
  integrations: [solid(), sitemap()],

  server: { host: '0.0.0.0' },

  vite: {
    build: { target: 'es2022' },
    plugins: [basicSsl()],
  },

  adapter: node({
    mode: 'standalone',
  }),
});
