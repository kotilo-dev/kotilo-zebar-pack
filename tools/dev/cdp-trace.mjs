// Connects to the island page over the Chrome DevTools Protocol, instruments
// focus/blur/key/click events and prints them with console output for N ms.
const [, , wsUrl, durationMs = '6000'] = process.argv;
const ws = new WebSocket(wsUrl);
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
const t0 = Date.now();
const stamp = () => String(Date.now() - t0).padStart(5);

ws.addEventListener('open', () => {
  send('Runtime.enable');
  send('Log.enable');
  send('Runtime.evaluate', {
    expression: `(() => {
      if (window.__kotiloTrace) return 'already';
      window.__kotiloTrace = true;
      const log = (...a) => console.log('[trace]', ...a);
      window.addEventListener('blur', () => log('window blur, hasFocus=' + document.hasFocus()), true);
      window.addEventListener('focus', () => log('window focus'), true);
      document.addEventListener('focusout', (e) => log('focusout', e.target?.tagName, e.target?.className), true);
      window.addEventListener('keydown', (e) => log('keydown', e.key, 'trusted=' + e.isTrusted), true);
      window.addEventListener('mousedown', (e) => log('mousedown', e.clientX, e.clientY, e.target?.className), true);
      window.addEventListener('click', (e) => log('click', e.clientX, e.clientY, e.target?.className), true);
      window.addEventListener('resize', () => log('resize', innerWidth, innerHeight), true);
      new MutationObserver(() => {
        const cur = document.querySelector('.island-view.current');
        const name = cur ? [...cur.firstElementChild?.classList ?? []].join('.') : 'none';
        if (name !== window.__lastView) { window.__lastView = name; log('view ->', name); }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
      return 'installed';
    })()`,
  });
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, Number(durationMs));
});

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    console.log(stamp(), msg.params.type, text);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log(stamp(), 'EXCEPTION', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  } else if (msg.method === 'Log.entryAdded') {
    console.log(stamp(), 'log', msg.params.entry.level, msg.params.entry.text);
  } else if (msg.result?.result?.value) {
    console.log(stamp(), 'eval:', msg.result.result.value);
  }
});
