// Evaluates one expression in the island page over CDP and prints the result.
const [, , wsUrl, expression] = process.argv;
const ws = new WebSocket(wsUrl);
ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })));
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id === 1) {
    console.log(JSON.stringify(msg.result?.result?.value ?? msg.result));
    ws.close();
    process.exit(0);
  }
});
setTimeout(() => process.exit(1), 3000);
