export const MIN_CITY_ZOOM=14, MAX_VISIBLE_TILES=96, CACHE_LIMIT=96;

export function visibleTileKeys(bounds,manifest) {
  const step=manifest.tileStep,[west,south,east,north]=bounds;
  const coverage=manifest.bounds;
  const w=Math.max(west,coverage[0]),s=Math.max(south,coverage[1]);
  const e=Math.min(east,coverage[2]),n=Math.min(north,coverage[3]);
  if(w>e||s>n)return [];
  const keys=[];
  for(let x=Math.floor(w/step);x<=Math.floor(e/step);x++)for(let y=Math.floor(s/step);y<=Math.floor(n/step);y++) {
    const key=`${x}_${y}`;if(Object.hasOwn(manifest.tiles,key))keys.push(key);
  }
  return keys;
}

export function mergeTiles(tiles) {
  const features=new Map();
  for(const tile of tiles)for(const feature of tile.features)features.set(feature.id,feature);
  return {type:'FeatureCollection',features:[...features.values()]};
}

// One in-flight view, bounded concurrency, bounded LRU cache, no stale map updates.
export function createTileLoader({fetchTile,onData,onStatus}) {
  const cache=new Map();let version=0,controller=null;
  function cancel(){version++;controller?.abort();controller=null;}
  return {
    cancel,
    async load(keys) {
      cancel();const request=version;controller=new AbortController();const signal=controller.signal;
      if(!keys.length){onData(mergeTiles([]));onStatus('No building features in this view. Pan back into Toronto.');return;}
      onStatus(`Loading ${keys.length} geographic tiles…`);
      let cursor=0;
      try {
        const results=new Array(keys.length);
        await Promise.all(Array.from({length:Math.min(6,keys.length)},async()=>{
          while(cursor<keys.length){
            const i=cursor++,key=keys[i];let data=cache.get(key);
            if(data)cache.delete(key);
            else data=await fetchTile(key,signal);
            if(signal.aborted)return;
            cache.set(key,data);while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
            results[i]=data;
          }
        }));
        if(request!==version||signal.aborted)return;
        const collection=mergeTiles(results);onData(collection);
        onStatus(`${collection.features.length.toLocaleString()} visible-area features · ${keys.length} tiles · Pan to explore`);
      }catch(error){if(request===version&&!signal.aborted){controller.abort();onData(mergeTiles([]));onStatus(`Could not load buildings: ${error.message}. Move the map to retry.`);}}
    },
    get cacheSize(){return cache.size;},
  };
}
