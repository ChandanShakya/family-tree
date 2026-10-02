import { layoutTree, type LayoutLink, type LayoutPerson, type Orientation } from './layout.js';

// Runs layoutTree off the main thread for large trees (§7.6). Maps are sent
// as entry arrays; the main thread rebuilds them.
self.onmessage = (e: MessageEvent<{ persons: LayoutPerson[]; links: LayoutLink[]; orientation: Orientation }>) => {
	const r = layoutTree(e.data.persons, e.data.links, e.data.orientation);
	self.postMessage({ ...r, nodes: [...r.nodes], unions: [...r.unions] });
};
