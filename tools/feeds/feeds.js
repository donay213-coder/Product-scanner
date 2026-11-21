'use strict';
// Productbestanden ("feeds") van partnerprogramma's inlezen: Awin, TradeTracker, Daisycon, Google Shopping en
// vergelijkbare CSV/XML. Alles wordt één vorm: {shop, name, price, ean, url, inStock}.
// Geen afhankelijkheden: draait in een GitHub-taak met alleen Node.

const KNOWN = {
  'coolblue.nl': 'Coolblue', 'coolblue.be': 'Coolblue', 'bol.com': 'bol', 'praxis.nl': 'Praxis', 'gamma.nl': 'Gamma',
  'karwei.nl': 'Karwei', 'hornbach.nl': 'Hornbach', 'hubo.nl': 'Hubo', 'bauhaus.nl': 'Bauhaus', 'hema.nl': 'Hema',
  'blokker.nl': 'Blokker', 'xenos.nl': 'Xenos', 'action.com': 'Action', 'kruidvat.nl': 'Kruidvat', 'etos.nl': 'Etos',
  'mediamarkt.nl': 'MediaMarkt', 'intratuin.nl': 'Intratuin', 'expert.nl': 'Expert', 'wehkamp.nl': 'Wehkamp',
  'leenbakker.nl': 'Leen Bakker', 'kwantum.nl': 'Kwantum', 'ikea.com': 'IKEA', 'lidl.nl': 'Lidl', 'ah.nl': 'Albert Heijn',
  'jumbo.com': 'Jumbo', 'trekpleister.nl': 'Trekpleister', 'drogisterij.net': 'Drogisterij.net',
};
const FIELDS = {
  name: ['product_name', 'title', 'name', 'productname', 'product_title'],
  price: ['search_price', 'price', 'store_price', 'display_price', 'current_price', 'price_amount', 'amount', 'prijs'],
  sale: ['sale_price', 'actionprice', 'action_price', 'discount_price', 'price_sale', 'aanbiedingsprijs'],
  ean: ['ean', 'gtin', 'ean13', 'product_gtin', 'gtin13', 'upc', 'barcode', 'ean_code'],
  url: ['aw_deep_link', 'deeplink', 'deep_link', 'affiliate_link', 'trackinglink', 'tracking_link', 'url', 'link', 'producturl', 'product_url'],
  shop: ['merchant_name', 'advertiser_name', 'advertiser', 'shop', 'programname', 'program_name', 'store'],
  stock: ['in_stock', 'instock', 'availability', 'stock', 'stock_quantity', 'voorraad'],
  brand: ['brand_name', 'brand', 'merk', 'manufacturer'],
};

function parsePrice(v) {
  let s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /,\d{3}$/.test(s) && s.indexOf(',') !== lc ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(s);
  return isFinite(n) && n > 0 && n < 1e6 ? Math.round(n * 100) / 100 : null;
}
const cleanEan = (v) => { const d = String(v || '').replace(/\D/g, ''); return [8, 12, 13, 14].includes(d.length) && !/^0+$/.test(d) ? d : ''; };
const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
function stockOf(v) {
  if (v == null || v === '') return true;
  const s = String(v).trim().toLowerCase();
  if (/^(0|false|no|nee|n|out of stock|out_of_stock|niet op voorraad|uitverkocht|discontinued)$/.test(s)) return false;
  return true;
}
function hostName(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
// Partnerlinks wijzen naar een trackingdomein; de echte winkel staat in een parameter.
function targetHost(u) {
  try {
    const p = new URL(u).searchParams;
    for (const k of ['u', 'url', 'ued', 'dl', 'r', 'redirect', 'target', 'murl', 'p']) {
      const v = p.get(k);
      if (v && /^https?:\/\//i.test(v)) return hostName(v);
    }
  } catch (e) { /* geen geldige link */ }
  return hostName(u);
}
function shopFromHost(h) {
  if (!h) return '';
  for (const [d, n] of Object.entries(KNOWN)) if (h === d || h.endsWith('.' + d)) return n;
  const base = h.split('.').slice(-2, -1)[0] || h;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
const shopClean = (s) => clean(s).replace(/\s+(NL|BE|Nederland|België)$/i, '').replace(/\.(nl|be|com)$/i, '');

// ---- CSV ----
function parseCSV(text) {
  const first = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"' && f === '') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/^g:/, ''));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}

// ---- XML ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlText = (s) => clean(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)));
function parseXML(text) {
  const recs = [];
  const re = /<(product|item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2], o = {};
    const props = /<property\b[^>]*name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/gi;
    let p;
    while ((p = props.exec(body))) { const k = p[1].toLowerCase(); if (!(k in o)) o[k] = xmlText(p[2]); }
    const tags = /<([\w:.-]+)(\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tags.exec(body))) {
      const k = t[1].toLowerCase().replace(/^g:/, '');
      if (k === 'properties') continue;
      // geneste tags (<images><image>…</image></images>): de eerste tekst erin
      if (!(k in o)) o[k] = /^\s*<(?!!\[CDATA)/.test(t[3]) ? xmlText((t[3].match(/>([^<]+)</) || [])[1] || '') : xmlText(t[3]);
    }
    recs.push(o);
  }
  return recs;
}

const pick = (o, keys) => { for (const k of keys) if (o[k] != null && String(o[k]).trim() !== '') return o[k]; return ''; };
function parseFeed(text, { name = '' } = {}) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  const raw = /^\s*</.test(t) ? parseXML(t) : parseCSV(t);
  const out = [];
  for (const o of raw) {
    let nm = clean(pick(o, FIELDS.name)).slice(0, 200);
    if (!nm) continue;
    const brand = clean(pick(o, FIELDS.brand));
    if (brand && !nm.toLowerCase().includes(brand.toLowerCase())) nm = `${brand} ${nm}`.slice(0, 200);
    const base = parsePrice(pick(o, FIELDS.price)), sale = parsePrice(pick(o, FIELDS.sale));
    const price = base && sale ? Math.min(base, sale) : base || sale;
    const url = clean(pick(o, FIELDS.url));
    const shop = name || shopClean(pick(o, FIELDS.shop)) || shopFromHost(targetHost(url));
    out.push({ shop, name: nm, price, ean: cleanEan(pick(o, FIELDS.ean)), url, inStock: stockOf(pick(o, FIELDS.stock)) });
  }
  return out;
}

// "Gamma|https://…" of alleen "https://…" (de naam is dan optioneel).
function parseSecret(s) {
  const v = String(s || '').trim(), i = v.indexOf('|');
  const name = i > -1 ? v.slice(0, i).trim() : '', url = (i > -1 ? v.slice(i + 1) : v).trim();
  return /^https?:\/\/\S+$/i.test(url) ? { name, url } : null;
}

// Eén catalogus voor de app: [naam, prijs in centen, winkel, EAN]; links apart (alleen nodig bij een tik).
// Grens zodat het bestand voor de telefoon (en voor GitHub) hanteerbaar blijft: ±400.000 producten ≈ 30 MB.
function capPerShop(list, max) {
  if (list.length <= max) return list;
  const by = new Map();
  for (const r of list) (by.get(r.shop) || by.set(r.shop, []).get(r.shop)).push(r);
  const groups = [...by.values()].sort((a, b) => a.length - b.length);
  let left = max, out = [];
  groups.forEach((g, i) => {
    const n = Math.min(g.length, Math.floor(left / (groups.length - i)));
    out = out.concat(g.sort((a, b) => (b.ean ? 1 : 0) - (a.ean ? 1 : 0)).slice(0, n));
    left -= n;
  });
  return out;
}
function buildCatalog(recs, { now = new Date().toISOString(), shard = 2000, max = 400000 } = {}) {
  const best = new Map();
  for (const r of recs) {
    if (!r || !r.inStock || !(r.price > 0) || !r.name || !r.shop) continue;
    const k = r.shop + '|' + (r.ean || r.name.toLowerCase());
    const b = best.get(k);
    if (!b || r.price < b.price) best.set(k, r);
  }
  const list = capPerShop([...best.values()], max).sort((a, b) => a.shop.localeCompare(b.shop, 'nl') || a.name.localeCompare(b.name, 'nl'));
  const shops = [...new Set(list.map((r) => r.shop))];
  const items = list.map((r) => [r.name, Math.round(r.price * 100), shops.indexOf(r.shop), r.ean]);
  const links = [];
  for (let i = 0; i < list.length; i += shard) links.push(list.slice(i, i + shard).map((r) => r.url));
  return { catalog: { v: 1, updated: now, shard, shops, items }, links };
}

module.exports = { parsePrice, parseFeed, parseSecret, buildCatalog, shopFromHost, targetHost };
