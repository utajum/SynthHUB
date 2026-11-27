// GET /sw.js, generated at build: the worker with this build's id, so every
// deploy ships a new worker and drops the previous cache.
import type { APIRoute } from 'astro';
import source from '../lib/service-worker.js?raw';

export const prerender = true;

const BUILD = Date.now().toString(36);

export const GET: APIRoute = () =>
  new Response(source.replaceAll('__BUILD__', BUILD), {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
