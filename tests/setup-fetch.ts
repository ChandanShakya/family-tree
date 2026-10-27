// adapter-node 6 no longer reads ORIGIN; it derives the request origin from headers and assumes https.
// Tests talk plain http to spawned servers, so name a protocol header (inherited by spawned servers)
// and send it, plus the Origin a browser always sends on non-GET requests.
process.env.PROTOCOL_HEADER = 'x-forwarded-proto';

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.hostname !== 'localhost') return realFetch(input, init);
	const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
	if (!headers.has('x-forwarded-proto')) headers.set('x-forwarded-proto', 'http');
	const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
	if (method !== 'GET' && method !== 'HEAD' && !headers.has('origin')) headers.set('origin', url.origin);
	return realFetch(input, { ...init, headers });
};
