// Sidebar tabs for the capture studio. Panes stay in the DOM (main.js and its modules look elements up by id),
// so switching only toggles `hidden`.
const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
const KEY = 'studio.tab';

function select(tab, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
  try { localStorage.setItem(KEY, tab.id); } catch { /* storage unavailable: just don't remember */ }
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => select(tab));
  tab.addEventListener('keydown', e => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length], true); }
  });
});

let saved = null;
try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
select(tabs.find(t => t.id === saved) ?? tabs[0]);

// Clicking a pin in the 3D view opens the observation form; bring its tab forward so the form is visible.
const form = document.getElementById('observation-form');
new MutationObserver(() => { if (!form.hidden) select(document.getElementById('tab-notes')); })
  .observe(form, {attributes: true, attributeFilter: ['hidden']});
