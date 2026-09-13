const base =
  'nSWtyNSxKYmw3LElybkNkNyxLaGhyNyxFblNiaE5yQSxDcHRuTXJ2bEQsQ2xsT2JzZG5DLFpiNCxBbnRQbHJNZ250MTAsUHNsY2s4LEJsbms1LENyc3NibnNB';
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const looksLikeShort = (txt) => /^[A-Za-z0-9]{2,}(,[A-Za-z0-9]{2,})+$/.test(txt.trim());
const looksLikeJson = (txt) => txt.includes('"Cards"') && txt.includes('"CardDefId"');

const best = [];
for (let i = 0; i <= base.length; i++) {
  for (const c of CHARS) {
    const s = base.slice(0, i) + c + base.slice(i);
    const buf = Buffer.from(s, 'base64');
    const txt = buf.toString('utf8');
    if (looksLikeShort(txt)) best.push({ tipo: 'insert', i, c, len: s.length, txt: txt.slice(0, 160) });
    if (looksLikeJson(txt)) best.push({ tipo: 'insert-json', i, c, len: s.length, txt: txt.slice(0, 160) });
  }
}
for (let i = 0; i < base.length; i++) {
  const s = base.slice(0, i) + base.slice(i + 1);
  for (const pad of ['', '=', '==']) {
    const buf = Buffer.from(s + pad, 'base64');
    const txt = buf.toString('utf8');
    if (looksLikeShort(txt)) best.push({ tipo: 'delete', i, pad, len: (s + pad).length, txt: txt.slice(0, 160) });
  }
}
console.log('candidatos encontrados:', best.length);
for (const b of best.slice(0, 8)) console.log(JSON.stringify(b));
