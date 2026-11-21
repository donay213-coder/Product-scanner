'use strict';
// Dagelijkse import: leest de geheime links FEED_1 … FEED_30 (GitHub-geheimen), haalt de productbestanden op,
// en schrijft catalog.json + links/<n>.json naar de map die je opgeeft.
// Belangrijk: de links bevatten sleutels. Ze komen nooit in het logboek of in de uitvoer.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const F = require('./feeds');

async function defaultFetch(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000), headers: { 'User-Agent': 'Prijsscanner-catalogus/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
function toText(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  else if (buf[0] === 0x50 && buf[1] === 0x4b) throw new Error('zip wordt niet ondersteund, kies gzip of geen compressie');
  return buf.toString('utf8');
}
const safe = (e) => String((e && e.message) || e).replace(/https?:\/\/\S+/g, '[link]').slice(0, 120);

async function runImport({ env = process.env, fetchBuf = defaultFetch, outDir, now, log = console.log } = {}) {
  const keys = Object.keys(env).filter((k) => /^FEED_\d+$/.test(k) && String(env[k]).trim()).sort((a, b) => +a.slice(5) - +b.slice(5));
  const recs = [];
  let ok = 0, feeds = 0;
  for (const k of keys) {
    const sec = F.parseSecret(env[k]);
    if (!sec) { log(`${k}: geen geldige link (zet er alleen de link in, of Naam|link)`); continue; }
    feeds++;
    try {
      const r = F.parseFeed(toText(await fetchBuf(sec.url)), { name: sec.name });
      const by = {};
      for (const x of r) by[x.shop] = (by[x.shop] || 0) + 1;
      recs.push(...r);
      ok++;
      log(`${k}: ${Object.entries(by).map(([s, n]) => `${s} ${n} producten`).join(', ') || 'leeg bestand'}`);
    } catch (e) { log(`${k}: mislukt (${safe(e)})`); }
  }
  const { catalog, links } = F.buildCatalog(recs, now ? { now } : {});
  if (catalog.items.length < new Set(recs.filter((r) => r.inStock && r.price > 0).map((r) => r.shop + '|' + (r.ean || r.name.toLowerCase()))).size) log('Let op: te veel producten, per winkel is een deel weggelaten (producten met barcode gaan voor).');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'links'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog));
  links.forEach((l, i) => fs.writeFileSync(path.join(outDir, 'links', i + '.json'), JSON.stringify(l)));
  fs.writeFileSync(path.join(outDir, 'README.md'), '# Prijsscanner-catalogus\n\nDagelijks gemaakt uit de productbestanden van partnerprogramma\'s. Niet met de hand aanpassen.\n');
  log(`Klaar: ${catalog.items.length} producten van ${catalog.shops.length} winkels (${catalog.shops.join(', ') || 'geen'}).`);
  return { feeds, ok, products: catalog.items.length };
}

if (require.main === module) {
  runImport({ outDir: process.argv[2] || 'out' }).catch((e) => { console.error('Import mislukt:', safe(e)); process.exit(1); });
}
module.exports = { runImport };
