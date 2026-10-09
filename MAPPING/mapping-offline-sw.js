/* PDR-APP Mapping · Service Worker offline-first */
const VERSION='pdr-mapping-sw-v100-1';
const SHELL='pdr-mapping-shell-v1';
const RUNTIME='pdr-mapping-runtime-v1';

const STATIC_ASSETS=[
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate.css',
  'https://cdn.jsdelivr.net/npm/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate.umd.min.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js',
  'https://static.wixstatic.com/media/63e6ec_6f519a0e397d4f6fbe3f82ce81606614~mv2.png/v1/fill/w_529,h_173,al_c,q_85,usm_0.66_1.00_0.01,enc_auto/PDR-1.png'
];

async function cacheStaticAssets(){
  const cache=await caches.open(SHELL);
  await Promise.allSettled(STATIC_ASSETS.map(async url=>{
    try{
      const req=new Request(url,{mode:'no-cors',cache:'reload'});
      const res=await fetch(req);
      await cache.put(url,res.clone());
    }catch(_){ }
  }));
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    await cacheStaticAssets();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keep=new Set([SHELL,RUNTIME]);
    for(const key of await caches.keys()){
      if((key.startsWith('pdr-mapping-'))&&!keep.has(key))await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  const d=event.data||{};
  if(d.type==='CACHE_URL'&&d.url){
    event.waitUntil((async()=>{
      try{
        const cache=await caches.open(SHELL);
        const req=new Request(d.url,{credentials:'same-origin',cache:'reload'});
        const res=await fetch(req);
        if(res.ok)await cache.put(req,res.clone());
      }catch(_){ }
    })());
  }
});

function esSupabaseDatos(url){
  return /\.supabase\.co$/i.test(url.hostname) && (
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/realtime/')
  );
}

function esTileOnlineNoCacheable(url){
  const h=url.hostname.toLowerCase();
  return h.includes('google.') || h.includes('googleapis.') ||
         h.includes('openstreetmap.org') ||
         h.includes('openfreemap.org') ||
         h.includes('maps.igac.gov.co');
}

async function cacheFirst(request){
  const cached=await caches.match(request) || await caches.match(request.url);
  if(cached)return cached;
  const res=await fetch(request);
  if(res && (res.ok || res.type==='opaque')){
    const cache=await caches.open(RUNTIME);
    cache.put(request,res.clone()).catch(()=>{});
  }
  return res;
}

async function networkFirst(request){
  const cache=await caches.open(SHELL);
  try{
    const res=await fetch(request);
    if(res && res.ok)await cache.put(request,res.clone());
    return res;
  }catch(e){
    const cached=await cache.match(request) || await caches.match(request);
    if(cached)return cached;
    throw e;
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  const url=new URL(request.url);

  // Datos transaccionales nunca se cachean: la app usa su propia caché local.
  if(esSupabaseDatos(url))return;

  // Mapas online se gestionan explícitamente en IndexedDB desde MAPPING.
  if(esTileOnlineNoCacheable(url))return;

  if(request.mode==='navigate'){
    event.respondWith(networkFirst(request));
    return;
  }

  const esEstatico=STATIC_ASSETS.includes(request.url) ||
    ['script','style','font'].includes(request.destination) ||
    (/\/storage\/v1\/object\/public\/modelos-ia\//.test(url.pathname));

  if(esEstatico){
    event.respondWith(cacheFirst(request));
  }
});
