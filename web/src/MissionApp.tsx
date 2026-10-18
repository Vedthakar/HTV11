import type * as maplibregl from 'maplibre-gl';
import {useCallback, useEffect, useRef, useState} from 'react';
import {CommandPalette, type PaletteItem} from './components/CommandPalette.tsx';
import {Compass, resetNorth} from './components/Compass.tsx';
import {MissionTitle, TopBar} from './components/Hud.tsx';
import {MapView} from './components/MapView.tsx';
import {MissionLog} from './components/MissionLog.tsx';
import {ReportsPanel} from './components/ReportsPanel.tsx';
import {SiteDetailPanel} from './components/SiteDetailPanel.tsx';
import {TelemetryCard} from './components/TelemetryCard.tsx';
import type {MissionMapController} from './map/MissionMapController.ts';
import {surveyMission} from './mission/survey-mission.ts';
import {MOCK_MISSIONS} from './mission/mock-mission.ts';
import {MissionStore} from './mission/store.ts';
import {isSiteReached} from './mission/track.ts';
import {MissionStoreContext} from './mission/useMissionPlayback.ts';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function MissionApp() {
  const [view]=useState<'map'|'scan'>('map');
  const [building,setBuilding]=useState<{key:string;label:string}|null>(null);
  const studio=useRef<HTMLIFrameElement>(null);
  useEffect(()=>{const receive=(e:Event)=>setBuilding((e as CustomEvent).detail);window.addEventListener('rover:building-selected',receive);return()=>window.removeEventListener('rover:building-selected',receive);},[]);
  useEffect(()=>{if(building)studio.current?.contentWindow?.postMessage({type:'rover:select-building',target:building},location.origin);},[building]);
  useEffect(()=>{if(view==='map')requestAnimationFrame(()=>map?.resize());},[view]);
  const [store] = useState(() => new MissionStore(MOCK_MISSIONS));
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  useEffect(()=>{
    const load=(event:Event)=>{try{store.loadSurvey(surveyMission((event as CustomEvent).detail));}catch(error){console.error('Survey simulation could not start',error);}};
    const stop=()=>store.stopSurvey();
    window.addEventListener('rover:survey-planned',load);window.addEventListener('rover:survey-cleared',stop);
    return()=>{window.removeEventListener('rover:survey-planned',load);window.removeEventListener('rover:survey-cleared',stop);};
  },[store]);
  const controller = useRef<MissionMapController | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);

  useEffect(() => {
    store.start();
    if (import.meta.env.DEV) (window as unknown as {missionStore: MissionStore}).missionStore = store;
    return () => store.destroy();
  }, [store]);

  const openSite = useCallback((id: string) => {
    const found = store.findSite(id);
    // In replay a site's flag is hidden until the rover gets there, so jump the clock to its arrival.
    if (found && store.getSnapshot().mode === 'replay' && !isSiteReached(found.site, store.time) && found.site.arrivedAt) {
      if (store.getSnapshot().activeId !== found.mission.id) store.setActive(found.mission.id);
      store.seek(found.site.arrivedAt);
    }
    store.select(id);
    controller.current?.flyToSite(id);
  }, [store]);

  const onPick = useCallback((item: PaletteItem) => {
    if (item.kind === 'site') openSite(item.id);
    else { store.setActive(item.id); controller.current?.flyToRover(item.id); }
  }, [store, openSite]);

  const recentre = useCallback(() => { store.setFollow(true); }, [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if(view==='scan')return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (e.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (reportsOpen) setReportsOpen(false);
        else store.select(null);
        return;
      }
      if (paletteOpen || reportsOpen || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const onButton = e.target instanceof HTMLButtonElement || (e.target as HTMLElement)?.getAttribute?.('role') === 'slider';
      if (e.key === ' ' && !onButton) { e.preventDefault(); store.toggle(); }
      else if (e.key === 'ArrowRight' && !onButton) { e.preventDefault(); store.seekBy(30_000); }
      else if (e.key === 'ArrowLeft' && !onButton) { e.preventDefault(); store.seekBy(-30_000); }
      else if (e.key.toLowerCase() === 'n' && map) resetNorth(map);
      else if (e.key.toLowerCase() === 'f') store.setFollow(!store.getSnapshot().follow);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [store, map, paletteOpen, reportsOpen, view]);

  return (
    <MissionStoreContext.Provider value={store}>
      <div className="integrated-app">
        <div className="mission-app" style={{display:view==='map'?'block':'none'}}>
        <MapView onReady={(m, c) => { controller.current = c; setMap(m); }} />
        <MissionTitle />
        <TopBar onSearch={() => setPaletteOpen(true)} onReports={() => setReportsOpen(true)} onRecentre={recentre} />
        <MissionLog onFocusSite={id => controller.current?.flyToSite(id)} />
        <Compass map={map} />
        <TelemetryCard />
        <SiteDetailPanel />
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onPick={onPick} />}
        {reportsOpen && <ReportsPanel onClose={() => setReportsOpen(false)} onOpen={openSite} />}
      </div>
      <iframe ref={studio} title="Capture scan viewer" src="/studio.html?embedded=1" className="integrated-studio" hidden={view!=='scan'} onLoad={()=>{if(building)studio.current?.contentWindow?.postMessage({type:'rover:select-building',target:building},location.origin);}} />
      </div>
    </MissionStoreContext.Provider>
  );
}
