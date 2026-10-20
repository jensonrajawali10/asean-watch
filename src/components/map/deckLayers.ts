// The deck.gl layer builders App hands to MapView (fires heat grid, ash plume). Loaded with a dynamic
// import, so deck.gl is not in the entry chunk and is not fetched before the first paint: it arrives
// with the map, which needs it anyway.
export { buildFireLayers } from './fireLayers';
export { buildPlumeLayers } from './plumeLayers';
