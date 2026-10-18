import {useEffect, useMemo, useRef, useState} from 'react';
import {clock, STATUS_META} from '../mission/format.ts';
import {useMissionPlayback} from '../mission/useMissionPlayback.ts';

export type PaletteItem =
  | {kind: 'site'; id: string; title: string; detail: string; icon: string; status: string}
  | {kind: 'rover'; id: string; title: string; detail: string; color: string};

interface Props { onClose(): void; onPick(item: PaletteItem): void; }

/** ⌘K palette listing sites and rovers; arrow keys + Enter, or click. */
export function CommandPalette({onClose, onPick}: Props) {
  const {state, store} = useMissionPlayback();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const all: PaletteItem[] = [
      ...state.missions.map(m => ({kind: 'rover' as const, id: m.id, title: m.roverId, detail: `${m.id} · ${m.sites.length} sites`, color: m.color ?? '#C8642A'})),
      ...state.missions.flatMap(m => m.sites.map(s => {
        const status = store.siteStatus(s);
        return {kind: 'site' as const, id: s.id, title: s.label, icon: STATUS_META[status].icon, status,
          detail: `${s.area} · ${m.roverId} · ${STATUS_META[status].label}${s.arrivedAt ? ` · ${clock(s.arrivedAt)}` : ''}`};
      })),
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter(i => `${i.title} ${i.id} ${i.detail}`.toLowerCase().includes(q)) : all;
  }, [query, state.missions, state.statusKey, store]);

  const pick = (item?: PaletteItem) => { if (item) { onPick(item); onClose(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setCursor(c => Math.min(items.length - 1, c + 1));
    else if (e.key === 'ArrowUp') setCursor(c => Math.max(0, c - 1));
    else if (e.key === 'Enter') pick(items[cursor]);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault(); e.stopPropagation();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette card" role="dialog" aria-modal="true" aria-label="Find a site or rover" onMouseDown={e => e.stopPropagation()}>
        <input ref={input} className="mono" value={query} placeholder="Find a site or rover…" aria-label="Search sites and rovers"
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[cursor] ? `pal-${items[cursor].id}` : undefined}
          onChange={e => { setQuery(e.target.value); setCursor(0); }} onKeyDown={onKey} />
        <ul id="palette-list" role="listbox">
          {items.map((item, i) => (
            <li key={item.id} id={`pal-${item.id}`} role="option" aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)} onClick={() => pick(item)}>
              {item.kind === 'rover'
                ? <span className="pal-icon rover-swatch" style={{background: item.color}} aria-hidden="true" />
                : <span className="pal-icon mono" data-status={item.status} aria-hidden="true">{item.icon}</span>}
              <span className="pal-title mono">{item.title}</span>
              <span className="pal-detail">{item.detail}</span>
            </li>
          ))}
          {!items.length && <li className="muted pal-empty">No matching sites or rovers.</li>}
        </ul>
      </div>
    </div>
  );
}
