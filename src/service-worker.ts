/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

// §7.4: precache the static shell (build assets + static files) and an offline page, nothing else.
// /api/*, /photos/* and every HTML page go to the network and are never stored, so a shared device
// cannot keep another person's data. There is no offline mutation queue.
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `shell-${version}`;
const OFFLINE = '/offline.html';
// A Set: a duplicate URL (the offline page is also a static file) makes cache.addAll reject and the install fail.
const SHELL_PATHS = new Set([...build, ...files.filter((f) => !f.endsWith('.map') && !f.startsWith('/media/')) /* the demo video is not part of the shell */, OFFLINE]);
const SHELL = [...SHELL_PATHS];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== location.origin) return;
	// Shell assets: cache first.
	if (SHELL_PATHS.has(url.pathname)) {
		event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
		return;
	}
	// Pages: network only; when the network is down, the offline page (read-only fallback).
	if (req.mode === 'navigate') {
		event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()));
	}
	// Everything else (API, photos, data): untouched, straight to the network.
});
