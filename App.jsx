import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { createClient } from '@supabase/supabase-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Navigation, Compass, Search, Mic, Home, Briefcase, Fuel, Coffee, Zap, Car, Plus, Trash2,
  Eye, EyeOff, Mail, Lock, User, ChevronRight, ChevronUp, ChevronDown, Clock, MapPin, Route,
  Sparkles, Send, Leaf, TrendingDown, Gauge, X, Check, ArrowUp, CornerUpRight, CornerUpLeft,
  LogOut, Bell, Volume2, ShieldCheck, HelpCircle, LocateFixed, Warehouse, Flag, ArrowLeftRight,
  Wallet, Pencil, AlertTriangle, Info, Mountain, Timer, ArrowRight, Loader2, Wind, Droplet, Cloud, CloudOff, RotateCw, RotateCcw, ArrowUpRight, ArrowUpLeft,
} from 'lucide-react';

/* =========================================================================
   ROUTIER — Yapay zeka asistanlı, araca göre maliyet hesaplayan navigasyon
   Harita: MapLibre GL + OpenFreeMap (OpenStreetMap verisi, ücretsiz, anahtarsız)
   Rota: OSRM (OpenStreetMap tabanlı, ücretsiz). Ağ yoksa detaylı SVG haritaya geçer.
   ========================================================================= */

const C = {
  orange: '#FF8A5B', orangeDark: '#E87344', orangeSoft: '#FFF1EB', orangeBorder: '#FFD8C7',
  ink: '#1E2022', gray: '#6B7280', line: '#ECEEF2', green: '#10B981', greenSoft: '#ECFDF5',
  amber: '#F59E0B', red: '#EF4444', redSoft: '#FEF2F2',
};

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

/* ----------------------------- Supabase -----------------------------
   Ayarlar index.html'in yanındaki config.js dosyasından okunur:
   window.ROUTIER_CONFIG = { supabaseUrl: 'https://xxxx.supabase.co', supabaseAnonKey: 'eyJ...' }
   Ayar yoksa uygulama yerel (cihaz içi) modda çalışır.
---------------------------------------------------------------------- */
const CFG = (typeof window !== 'undefined' && window.ROUTIER_CONFIG) || {};
const supabase = (() => {
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return null;
  try {
    return createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  } catch (e) {
    return null;
  }
})();
const redirectUrl = () => (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : undefined);
const newId = () => {
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  } catch (e) { /* yok say */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};
const PROVIDER_LABEL = { email: 'E-posta', google: 'Google', apple: 'Apple', anonymous: 'Misafir', guest: 'Misafir' };

function sessionFromUser(user) {
  const m = user.user_metadata || {};
  const provider = user.is_anonymous ? 'anonymous' : (user.app_metadata && user.app_metadata.provider) || 'email';
  const composed = [m.first_name, m.last_name].filter(Boolean).join(' ');
  let name = composed || m.full_name || m.name || '';
  if (!name) {
    if (provider === 'anonymous') name = 'Misafir Sürücü';
    else if (provider === 'apple') name = 'Apple Kullanıcısı';
    else name = (user.email || 'Sürücü').split('@')[0];
  }
  return { id: user.id, name, email: user.email || '', provider, remote: true, avatar: m.avatar_url || m.picture || '' };
}

function authErrorTr(err) {
  const msg = (err && err.message) || '';
  if (/Invalid login credentials/i.test(msg)) return 'E-posta veya şifre hatalı.';
  if (/Email not confirmed/i.test(msg)) return 'E-posta adresin henüz onaylanmadı. Gelen kutunu kontrol et.';
  if (/already registered|already exists/i.test(msg)) return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.';
  if (/Password should be/i.test(msg)) return 'Şifre en az 6 karakter olmalı.';
  if (/rate limit|too many/i.test(msg)) return 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.';
  if (/provider is not enabled|Unsupported provider/i.test(msg)) return 'Bu giriş yöntemi henüz Supabase panelinde etkinleştirilmemiş.';
  if (/Anonymous sign-ins are disabled/i.test(msg)) return 'Misafir girişi Supabase panelinde kapalı.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.';
  return msg || 'Beklenmeyen bir hata oluştu.';
}

/* Veri katmanı: tüm çağrılar Supabase'e gider; hata olursa yerel kopya korunur */
const vehicleFromRow = (r) => ({ id: r.id, brand: r.brand, model: r.model, year: r.year, fuelType: r.fuel_type, consumption: Number(r.consumption), price: Number(r.fuel_price) });
const cloud = {
  async loadAll(userId) {
    const [prof, veh, trp] = await Promise.all([
      supabase.from('profiles').select('active_vehicle_id, settings').eq('id', userId).maybeSingle(),
      supabase.from('vehicles').select('*').order('created_at', { ascending: true }),
      supabase.from('trips').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    if (veh.error) throw veh.error;
    const list = (veh.data || []).map(vehicleFromRow);
    const activeId = prof.data && list.some((v) => v.id === prof.data.active_vehicle_id) ? prof.data.active_vehicle_id : (list[0] ? list[0].id : null);
    const trips = (trp.data || []).map((t) => ({ id: t.id, dest: t.destination, km: Number(t.distance_km), min: t.duration_min, cost: Number(t.cost), amount: Number(t.fuel_amount), unit: t.fuel_unit, saved: Number(t.saved), completed: t.completed }));
    return { garage: { list, activeId }, trips, settings: prof.data ? prof.data.settings : null };
  },
  async addVehicle(userId, v) {
    const { error } = await supabase.from('vehicles').insert({ id: v.id, user_id: userId, brand: v.brand, model: v.model, year: v.year, fuel_type: v.fuelType, consumption: v.consumption, fuel_price: v.price });
    if (error) throw error;
  },
  async deleteVehicle(id) {
    const { error } = await supabase.from('vehicles').delete().eq('id', id);
    if (error) throw error;
  },
  async updatePrice(id, price) {
    const { error } = await supabase.from('vehicles').update({ fuel_price: price }).eq('id', id);
    if (error) throw error;
  },
  async setActive(userId, vehicleId) {
    const { error } = await supabase.from('profiles').update({ active_vehicle_id: vehicleId }).eq('id', userId);
    if (error) throw error;
  },
  async saveSettings(userId, settings) {
    const { error } = await supabase.from('profiles').update({ settings }).eq('id', userId);
    if (error) throw error;
  },
  async addTrip(userId, rec) {
    const { error } = await supabase.from('trips').insert({
      user_id: userId, vehicle_id: rec.vehicleId, destination: rec.dest, route_type: rec.routeType, distance_km: Number(rec.km.toFixed(2)),
      duration_min: rec.min, fuel_amount: Number(rec.amount.toFixed(3)), fuel_unit: rec.unit, cost: Number(rec.cost.toFixed(2)), saved: Number(rec.saved.toFixed(2)), completed: rec.completed,
    });
    if (error) throw error;
  },
};

/* ----------------------------- Güvenli localStorage ----------------------------- */
const store = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* sandbox: yok say */ }
  },
  del(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) { /* sandbox: yok say */ }
  },
};
const garageKey = (id) => `routier_garage_${id}`;
const tripsKey = (id) => `routier_trips_${id}`;

/* ----------------------------- Sabit veriler ----------------------------- */
const FUELS = {
  Benzin: { unit: 'L', price: 43.8, cons: 6.2, icon: Fuel },
  Dizel: { unit: 'L', price: 45.2, cons: 5.1, icon: Droplet },
  LPG: { unit: 'L', price: 24.5, cons: 8.4, icon: Wind },
  Hibrit: { unit: 'L', price: 43.8, cons: 4.3, icon: Leaf },
  Elektrik: { unit: 'kWh', price: 8.9, cons: 16.5, icon: Zap },
};
const BRANDS = ['Volkswagen', 'Renault', 'Fiat', 'Toyota', 'Hyundai', 'Ford', 'Honda', 'Togg', 'Tesla', 'BMW', 'Mercedes-Benz', 'Peugeot', 'Opel', 'Dacia', 'Skoda', 'Kia'];
const YEARS = Array.from({ length: 27 }, (_, i) => 2026 - i);

/* ----------------------------- Konumlar ----------------------------- */
const DEMO_ORIGIN = { name: 'Bostancı', sub: 'Kadıköy, İstanbul', coord: [29.096, 40.953] };
const DEMO_HOME = { name: 'Ev', sub: 'Atatürk Mah., Ataşehir (örnek adres)', coord: [29.1235, 40.9925], demo: true };
const DEMO_WORK = { name: 'Levent Plaza', sub: 'Büyükdere Cd. No:185, Levent (örnek adres)', coord: [29.0107, 41.081], demo: true };
const PRESET_PLACES = [
  { name: 'Taksim Meydanı', sub: 'Beyoğlu, İstanbul', coord: [28.9869, 41.037] },
  { name: 'Kadıköy İskelesi', sub: 'Kadıköy, İstanbul', coord: [29.0228, 40.9927] },
  { name: 'Kanyon AVM', sub: 'Levent, Beşiktaş, İstanbul', coord: [29.0109, 41.078] },
  { name: 'Beşiktaş İskelesi', sub: 'Beşiktaş, İstanbul', coord: [29.007, 41.0422] },
  { name: 'Üsküdar Meydanı', sub: 'Üsküdar, İstanbul', coord: [29.0153, 41.026] },
  { name: 'Maslak', sub: 'Sarıyer, İstanbul', coord: [29.0207, 41.1086] },
  { name: 'Ataşehir Bulvarı', sub: 'Ataşehir, İstanbul', coord: [29.1235, 40.9925] },
  { name: 'Bostancı Sahil', sub: 'Kadıköy, İstanbul', coord: [29.096, 40.953] },
  { name: 'Sabiha Gökçen Havalimanı', sub: 'Pendik, İstanbul', coord: [29.3092, 40.8986] },
  { name: 'İstanbul Havalimanı', sub: 'Arnavutköy, İstanbul', coord: [28.7519, 41.2608] },
];
const sameCoord = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
const trLower = (s) => String(s || '').toLocaleLowerCase('tr-TR');

/* ----------------------------- Ağ yardımcıları ----------------------------- */
const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM_TABLE = 'https://router.project-osrm.org/table/v1/driving/';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

async function fetchJSON(url, opts = {}, ms = 9000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const tm = setTimeout(() => { if (ctrl) ctrl.abort(); }, ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(tm);
  }
}

/* ----------------------------- Adres arama (Photon / Nominatim) ----------------------------- */
function placeFromPhoton(f) {
  const p = f.properties || {};
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || street || p.district || p.city || 'Konum';
  const parts = [p.name && street ? street : null, p.district || p.locality, p.city || p.county, p.country && p.countrycode !== 'TR' ? p.country : null];
  const sub = parts.filter((x, i) => x && parts.indexOf(x) === i && x !== name).join(', ');
  return { name, sub, coord: f.geometry.coordinates };
}
async function geocode(q, near) {
  const params = new URLSearchParams({ q, limit: '8' });
  if (near) { params.set('lat', String(near[1])); params.set('lon', String(near[0])); }
  try {
    const j = await fetchJSON(`${PHOTON}/api/?${params}`, {}, 7000);
    return { items: (j.features || []).map(placeFromPhoton), offline: false };
  } catch (e) {
    try {
      const j = await fetchJSON(`${NOMINATIM}/search?format=jsonv2&limit=8&accept-language=tr&q=${encodeURIComponent(q)}`, {}, 7000);
      return {
        items: j.map((r) => {
          const bits = String(r.display_name || '').split(',').map((s) => s.trim());
          return { name: r.name || bits[0], sub: bits.slice(1, 4).join(', '), coord: [Number(r.lon), Number(r.lat)] };
        }),
        offline: false,
      };
    } catch (e2) {
      const t = trLower(q);
      return { items: PRESET_PLACES.filter((p) => trLower(`${p.name} ${p.sub}`).includes(t)), offline: true };
    }
  }
}
async function reverseGeocode(coord) {
  try {
    const j = await fetchJSON(`${PHOTON}/reverse?lat=${coord[1]}&lon=${coord[0]}`, {}, 6000);
    if (j.features && j.features.length) return { ...placeFromPhoton(j.features[0]), coord };
  } catch (e) { /* çevrimdışı */ }
  return { name: 'Seçilen nokta', sub: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`, coord };
}

/* ----------------------------- Yönlendirme adımları (Türkçe) ----------------------------- */
const MOD_TR = { uturn: 'U dönüşü yapın', 'sharp right': 'Keskin sağa dönün', right: 'Sağa dönün', 'slight right': 'Hafif sağa yönelin', straight: 'Düz devam edin', 'slight left': 'Hafif sola yönelin', left: 'Sola dönün', 'sharp left': 'Keskin sola dönün' };
const MOD_ICON = { uturn: RotateCcw, 'sharp right': CornerUpRight, right: CornerUpRight, 'slight right': ArrowUpRight, straight: ArrowUp, 'slight left': ArrowUpLeft, left: CornerUpLeft, 'sharp left': CornerUpLeft };
function describeStep(s, legIndex, legCount) {
  const m = s.maneuver || {};
  const name = s.name || s.ref || '';
  const on = name ? `: ${name}` : '';
  const mod = m.modifier || 'straight';
  const left = mod.includes('left');
  switch (m.type) {
    case 'depart': return { icon: ArrowUp, text: name ? `${name} boyunca ilerleyin` : 'Rotaya başlayın' };
    case 'arrive': return legIndex < legCount - 1 ? { icon: Flag, text: 'Durağa varıyorsunuz', stopArrive: true } : { icon: Flag, text: 'Hedefinize varıyorsunuz', arrive: true };
    case 'roundabout': case 'rotary': return { icon: RotateCw, text: `Döner kavşaktan ${m.exit || 1}. çıkışı kullanın${on}` };
    case 'exit roundabout': case 'exit rotary': return { icon: ArrowUpRight, text: `Döner kavşaktan çıkın${on}` };
    case 'merge': return { icon: left ? ArrowUpLeft : ArrowUpRight, text: `Yola katılın${on}` };
    case 'on ramp': return { icon: MOD_ICON[mod] || ArrowUpRight, text: `Bağlantı yoluna girin${on}` };
    case 'off ramp': return { icon: MOD_ICON[mod] || ArrowUpRight, text: `${left ? 'Soldaki' : 'Sağdaki'} çıkışı kullanın${on}` };
    case 'fork': return { icon: left ? ArrowUpLeft : ArrowUpRight, text: `Yol ayrımında ${left ? 'soldan' : 'sağdan'} devam edin${on}` };
    case 'continue': case 'new name': case 'notification':
      return { icon: MOD_ICON[mod] || ArrowUp, text: mod === 'straight' || !MOD_TR[mod] ? `Devam edin${on}` : `${MOD_TR[mod]}${on}` };
    default: return { icon: MOD_ICON[mod] || ArrowUp, text: `${MOD_TR[mod] || 'Devam edin'}${on}` };
  }
}

/* ----------------------------- Rota adayları ----------------------------- */
function candidateFromOsrm(r, noMotorway) {
  const steps = [];
  let acc = 0;
  r.legs.forEach((leg, li) => leg.steps.forEach((s) => {
    steps.push({ startDist: acc, dist: s.distance, dur: s.duration, ...describeStep(s, li, r.legs.length) });
    acc += s.distance;
  }));
  const total = r.distance || acc || 1;
  return {
    coords: r.geometry.coordinates,
    distance: r.distance,
    duration: r.duration,
    steps: steps.map((s) => ({ ...s, at: Math.min(1, s.startDist / total) })),
    summary: r.legs.map((l) => l.summary).filter(Boolean).join(' • '),
    noMotorway,
    source: 'osrm',
  };
}
async function osrmCandidates(points, { alternatives = false, exclude = null } = {}) {
  const path = points.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(';');
  const p = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'true' });
  if (alternatives && points.length === 2) p.set('alternatives', '3');
  if (exclude) p.set('exclude', exclude);
  const j = await fetchJSON(`${OSRM}${path}?${p}`, {}, 10000);
  if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.code || 'NoRoute');
  return j.routes.map((r) => candidateFromOsrm(r, !!exclude));
}
// Ağ yoksa: noktalar arasında kavisli tahmini rotalar
function synthCandidates(points) {
  const variants = [{ k: 0.08, v: 42, ex: false }, { k: -0.14, v: 50, ex: false }, { k: 0.22, v: 36, ex: true }];
  return variants.map(({ k, v, ex }) => {
    let coords = [];
    const legEnds = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const c = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * k, (a[1] + b[1]) / 2 + (b[0] - a[0]) * k];
      const seg = [];
      for (let s = 0; s <= 24; s += 1) {
        const t = s / 24;
        const u = 1 - t;
        seg.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
      }
      coords = coords.concat(i ? seg.slice(1) : seg);
      legEnds.push(coords.length - 1);
    }
    const cum = [0];
    for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + distM(coords[i - 1], coords[i]));
    const distance = cum[cum.length - 1] * 1.08;
    const steps = [{ at: 0, dist: 0, dur: 0, icon: ArrowUp, text: 'Rotaya başlayın' }, { at: 0.5, dist: 0, dur: 0, icon: ArrowUp, text: 'Rota boyunca devam edin' }];
    legEnds.slice(0, -1).forEach((idx) => steps.push({ at: cum[idx] / cum[cum.length - 1], icon: Flag, text: 'Durağa varıyorsunuz', stopArrive: true }));
    steps.push({ at: 1, icon: Flag, text: 'Hedefinize varıyorsunuz', arrive: true });
    steps.sort((x, y) => x.at - y.at);
    return { coords, distance, duration: distance / (v / 3.6), steps, summary: '', noMotorway: ex, source: 'offline' };
  });
}
// Varsayılan demo rotası (çevrimdışı önizleme için elle çizilmiş)
const DEMO_STEPS = [
  { at: 0, icon: ArrowUp, text: 'Bağdat Caddesi boyunca ilerleyin' },
  { at: 0.12, icon: CornerUpRight, text: 'Sağa dönün: D-100 bağlantı yolu' },
  { at: 0.32, icon: ArrowUp, text: 'D-100 üzerinde Avrupa yönüne devam edin' },
  { at: 0.55, icon: ArrowUp, text: 'Devam edin: 15 Temmuz Şehitler Köprüsü' },
  { at: 0.72, icon: CornerUpRight, text: 'Sağdaki çıkışı kullanın: Zincirlikuyu' },
  { at: 0.88, icon: CornerUpLeft, text: 'Sola dönün: Büyükdere Caddesi' },
  { at: 1, icon: Flag, text: 'Hedefinize varıyorsunuz', arrive: true },
];
const DEMO_CANDIDATES = [
  { role: 'eco', factor: 0.84, distance: 29100, duration: 37 * 60, summary: 'D-100 • 15 Temmuz Köprüsü', coords: [[29.096, 40.953], [29.085, 40.97], [29.07, 40.985], [29.056, 41.0], [29.05, 41.015], [29.045, 41.03], [29.034, 41.045], [29.02, 41.056], [29.012, 41.067], [29.0107, 41.081]] },
  { role: 'fast', factor: 1.04, distance: 28400, duration: 31 * 60, summary: 'O-1 • Altunizade', coords: [[29.096, 40.953], [29.1, 40.97], [29.1, 40.98], [29.088, 40.996], [29.07, 41.01], [29.052, 41.023], [29.04, 41.038], [29.034, 41.045], [29.02, 41.056], [29.012, 41.067], [29.0107, 41.081]] },
  { role: 'scenic', factor: 0.97, distance: 32000, duration: 42 * 60, summary: 'Kadıköy • Üsküdar sahili', coords: [[29.096, 40.953], [29.07, 40.966], [29.045, 40.975], [29.027, 40.988], [29.015, 41.01], [29.016, 41.027], [29.03, 41.04], [29.034, 41.045], [29.02, 41.056], [29.012, 41.067], [29.0107, 41.081]] },
].map((c) => ({ ...c, coords: chaikin(c.coords, 3), steps: DEMO_STEPS, source: 'demo' }));

/* Ortalama hıza göre tüketim çarpanı: içten yanmalı ~65 km/s, elektrikli ~35 km/s civarında en verimli */
function speedFactor(v, ev) {
  const f = ev ? 0.85 + 0.00008 * (v - 35) ** 2 : 0.9 + 0.00012 * (v - 65) ** 2;
  return clamp(f, 0.82, 1.5);
}
const ROUTE_META = {
  eco: { title: 'En Ekonomik', tag: 'Routier Eco', icon: Leaf },
  fast: { title: 'En Hızlı', tag: 'En kısa süre', icon: Zap },
  scenic: { title: 'Alternatif / Manzara', tag: 'Alternatif', icon: Mountain },
};
function classifyRoutes(cands, ev) {
  if (!cands || !cands.length) return [];
  const mk = (c, id, factor, same) => ({
    id,
    ...ROUTE_META[id],
    tag: id === 'scenic' && c.noMotorway ? 'Otoyolsuz' : ROUTE_META[id].tag,
    via: c.summary || (c.noMotorway ? 'Şehir içi yollar' : 'Önerilen yol'),
    min: Math.max(1, Math.round(c.duration / 60)),
    km: Math.max(0.1, Math.round(c.distance / 100) / 10),
    factor,
    avgSpeed: (c.distance / 1000) / Math.max(c.duration / 3600, 1e-3),
    coords: c.coords,
    steps: c.steps,
    source: c.source,
    sameAsFast: !!same,
  });
  if (cands[0].role) return cands.map((c) => mk(c, c.role, c.factor, false));
  const uniq = [];
  cands.forEach((c) => {
    if (!uniq.some((u) => Math.abs(u.distance - c.distance) / Math.max(u.distance, 1) < 0.015 && Math.abs(u.duration - c.duration) / Math.max(u.duration, 1) < 0.02)) uniq.push(c);
  });
  const rich = uniq.map((c) => {
    const km = c.distance / 1000;
    const v = km / Math.max(c.duration / 3600, 1e-3);
    const f = speedFactor(v, ev);
    return { ...c, f, fuel: km * f };
  });
  const fast = rich.reduce((a, b) => (b.duration < a.duration ? b : a));
  const eco = rich.reduce((a, b) => (b.fuel < a.fuel ? b : a));
  const rest = rich.filter((c) => c !== fast && c !== eco);
  const scenic = rest.find((c) => c.noMotorway) || rest.sort((a, b) => b.distance - a.distance)[0] || null;
  const out = [mk(eco, 'eco', eco.f, eco === fast), mk(fast, 'fast', fast.f, false)];
  if (scenic) out.push(mk(scenic, 'scenic', scenic.f, false));
  return out;
}

/* ----------------------------- Rota üzerindeki duraklar (Overpass + OSRM table) ----------------------------- */
const POI_KINDS = {
  fuel: { title: 'Rotadaki Benzinlikler', tag: 'fuel', radius: 700, icon: Fuel, label: 'Akaryakıt istasyonu', demo: ['Opet', 'Petrol Ofisi', 'Shell', 'BP', 'Total'] },
  cafe: { title: 'Rotadaki Kafeler', tag: 'cafe', radius: 400, icon: Coffee, label: 'Kafe', demo: ['Kahve Dünyası', 'Starbucks', 'Espressolab', 'Simit Sarayı', 'Gloria Jean\'s'] },
  charge: { title: 'Rotadaki Şarj İstasyonları', tag: 'charging_station', radius: 1200, icon: Zap, label: 'Şarj istasyonu', demo: ['ZES', 'Eşarj', 'Trugo', 'Voltrun', 'Sharz.net'] },
};
function sampleLine(coords, n) {
  if (coords.length <= n) return coords;
  const step = (coords.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => coords[Math.round(i * step)]);
}
function distToLine(p, line) {
  const kx = 111320 * Math.cos(toRad(p[1]));
  const ky = 110540;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const ax = (line[i][0] - p[0]) * kx; const ay = (line[i][1] - p[1]) * ky;
    const bx = (line[i + 1][0] - p[0]) * kx; const by = (line[i + 1][1] - p[1]) * ky;
    const dx = bx - ax; const dy = by - ay;
    const L = dx * dx + dy * dy;
    const t = L ? clamp(-(ax * dx + ay * dy) / L, 0, 1) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
function poiName(tags, K) {
  return tags.name || tags.brand || tags.operator || K.label;
}
function poiSub(tags, kind) {
  const bits = [];
  if (tags.brand && tags.name && tags.brand !== tags.name) bits.push(tags.brand);
  if (kind === 'fuel') {
    if (tags['fuel:lpg'] === 'yes') bits.push('LPG var');
    if (tags['fuel:diesel'] === 'yes') bits.push('Dizel');
  }
  if (kind === 'charge') {
    if (tags.operator && tags.operator !== tags.name) bits.push(tags.operator);
    if (tags.capacity) bits.push(`${tags.capacity} soket`);
  }
  if (tags['addr:street']) bits.push(tags['addr:street']);
  if (tags.opening_hours === '24/7') bits.push('7/24 açık');
  return bits.join(' • ');
}
async function findStops(kind, baseCoords, from, to) {
  const K = POI_KINDS[kind];
  const sample = sampleLine(baseCoords, 40);
  try {
    const line = sample.map(([x, y]) => `${y.toFixed(5)},${x.toFixed(5)}`).join(',');
    const q = `[out:json][timeout:20];(node["amenity"="${K.tag}"](around:${K.radius},${line});way["amenity"="${K.tag}"](around:${K.radius},${line}););out center 80;`;
    let els = null;
    for (let i = 0; i < OVERPASS.length && !els; i += 1) {
      try {
        const j = await fetchJSON(OVERPASS[i], { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 20000);
        els = j.elements || [];
      } catch (e) { /* sıradaki sunucu */ }
    }
    if (!els) throw new Error('overpass');
    const ranked = els
      .map((e) => ({ coord: [e.lon ?? (e.center && e.center.lon), e.lat ?? (e.center && e.center.lat)], tags: e.tags || {} }))
      .filter((p) => p.coord[0] != null)
      .map((p) => ({ ...p, off: distToLine(p.coord, sample) }))
      .sort((a, b) => a.off - b.off)
      .slice(0, 12);
    if (!ranked.length) return { items: [], offline: false };
    // Sapma = (başlangıç→durak) + (durak→varış) − (başlangıç→varış), gerçek yol ağı üzerinden
    try {
      const all = [from, to, ...ranked.map((p) => p.coord)];
      const idx = ranked.map((_, i) => i + 2);
      const url = `${OSRM_TABLE}${all.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';')}?sources=${[0, ...idx].join(';')}&destinations=${[1, ...idx].join(';')}&annotations=distance,duration`;
      const t = await fetchJSON(url, {}, 12000);
      ranked.forEach((p, i) => {
        const k = i + 1;
        const D = t.distances; const T = t.durations;
        if (D[0][k] == null || D[k][0] == null) { p.addKm = Infinity; return; }
        p.addKm = Math.max(0, (D[0][k] + D[k][0] - D[0][0]) / 1000);
        p.addMin = Math.max(0, (T[0][k] + T[k][0] - T[0][0]) / 60);
        p.fromStartKm = D[0][k] / 1000;
      });
    } catch (e) {
      ranked.forEach((p) => { p.addKm = (p.off * 2.6) / 1000; p.addMin = (p.addKm / 30) * 60; });
    }
    return {
      items: ranked.filter((p) => Number.isFinite(p.addKm)).sort((a, b) => a.addKm - b.addKm).slice(0, 6)
        .map((p) => ({ name: poiName(p.tags, K), sub: poiSub(p.tags, kind), coord: p.coord, kind, addKm: p.addKm, addMin: p.addMin, fromStartKm: p.fromStartKm })),
      offline: false,
    };
  } catch (e) {
    // Çevrimdışı önizleme: rota boyunca örnek duraklar
    const lineM = makeLine(baseCoords);
    const items = [0.28, 0.5, 0.7].map((f, i) => {
      const a = lineM.atDist(lineM.total * f);
      const b = lineM.atDist(lineM.total * f + 60);
      const off = 120 + i * 140;
      const coord = offsetPoint(a, (bearingOf(a, b) + 90) % 360, off);
      const addKm = (off * 2.4) / 1000;
      return { name: `${K.demo[i]} (örnek)`, sub: 'Çevrimdışı örnek durak', coord, kind, addKm, addMin: (addKm / 28) * 60, fromStartKm: (lineM.total * f) / 1000 };
    }).sort((x, y) => x.addKm - y.addKm);
    return { items, offline: true };
  }
}

const WEEK = [
  { d: 'Pzt', v: 142 }, { d: 'Sal', v: 96 }, { d: 'Çar', v: 188 }, { d: 'Per', v: 121 },
  { d: 'Cum', v: 214 }, { d: 'Cmt', v: 78 }, { d: 'Paz', v: 54 },
];

/* ----------------------------- Yardımcılar ----------------------------- */
const fmt = (n, d = 2) => Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt1 = (n) => fmt(n, 1);
const tl = (n) => `${fmt(n)} ₺`;
const vName = (v) => (v ? `${v.model}` : '');
const clockPlus = (min) => {
  const d = new Date(Date.now() + min * 60000);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

function calcTrip(route, vehicle) {
  if (!vehicle || !route) return null;
  const unit = FUELS[vehicle.fuelType]?.unit || 'L';
  // (Mesafe / 100) × Tüketim × Birim fiyat — rota verim katsayısı trafik/eğim etkisini yansıtır
  const amount = (route.km / 100) * vehicle.consumption * route.factor;
  return { amount, cost: amount * vehicle.price, unit };
}

const toRad = (x) => (x * Math.PI) / 180;
function distM(a, b) {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingOf(a, b) {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function chaikin(coords, it = 3) {
  let pts = coords;
  for (let k = 0; k < it; k += 1) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
function boundsOf(lists) {
  let minX = 180; let minY = 90; let maxX = -180; let maxY = -90;
  lists.forEach((l) => l.forEach(([x, y]) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }));
  return [[minX, minY], [maxX, maxY]];
}
function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

/* ----------------------------- Marka logoları ----------------------------- */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
function AppleLogo() {
  return (
    <svg width="17" height="17" viewBox="0 0 384 512" aria-hidden="true" fill="#1E2022">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}
/* Routier logosu (vektör) */
const LOGO_ORANGE = '#FF8560';
const LOGO_INK = '#23262B';
const LOGO_MARK_D = 'M9035 24910 c-380 -24 -1007 -95 -1092 -125 -7 -2 -81 -16 -165 -30 -84 -15 -223 -44 -308 -66 -85 -21 -195 -48 -245 -59 -49 -11 -133 -33 -185 -50 -52 -16 -149 -45 -215 -65 -156 -47 -443 -147 -570 -197 -55 -22 -131 -53 -170 -68 -322 -127 -875 -403 -1150 -574 -55 -34 -126 -77 -158 -94 -32 -18 -109 -67 -172 -110 -63 -42 -129 -86 -145 -97 -17 -11 -70 -49 -118 -84 -48 -35 -123 -89 -167 -119 -201 -140 -513 -394 -660 -538 -33 -32 -125 -118 -205 -190 -136 -123 -230 -217 -325 -324 -22 -25 -89 -100 -150 -166 -214 -235 -353 -398 -427 -503 -29 -41 -78 -104 -108 -141 -30 -37 -82 -108 -115 -156 -90 -133 -241 -364 -268 -409 -190 -318 -262 -447 -390 -695 -38 -74 -73 -139 -77 -145 -4 -5 -31 -64 -60 -130 -28 -66 -55 -124 -59 -130 -4 -5 -15 -28 -24 -50 -9 -22 -55 -134 -102 -250 -145 -352 -355 -1016 -410 -1295 -8 -41 -24 -113 -36 -160 -11 -47 -26 -125 -34 -174 -8 -49 -21 -119 -29 -155 -118 -526 -171 -1604 -107 -2191 33 -309 111 -840 158 -1070 88 -437 95 -467 158 -700 152 -563 231 -811 382 -1200 25 -63 64 -166 88 -227 24 -62 60 -148 79 -191 20 -44 36 -82 36 -86 0 -3 40 -101 90 -217 49 -115 90 -213 90 -218 0 -4 16 -37 35 -73 19 -36 48 -101 65 -144 17 -43 112 -242 211 -442 98 -200 179 -364 179 -366 0 -9 302 -571 332 -617 20 -31 73 -125 117 -208 45 -84 92 -169 105 -189 13 -20 51 -91 86 -157 35 -66 76 -138 91 -160 74 -110 74 -174 -1 -390 -67 -192 -195 -782 -220 -1015 -6 -58 -13 -114 -15 -125 -50 -239 -52 -1000 -5 -1410 6 -44 14 -124 20 -177 9 -93 57 -357 118 -653 32 -155 125 -495 177 -650 52 -151 130 -372 158 -445 95 -250 281 -654 400 -872 46 -84 112 -207 147 -273 35 -66 84 -149 109 -185 25 -36 76 -118 113 -182 169 -295 448 -664 448 -593 0 7 -141 389 -180 490 -72 183 -131 366 -245 760 -53 183 -68 240 -82 310 -6 28 -29 127 -52 220 -50 205 -88 390 -136 670 -46 264 -53 325 -106 845 -40 407 3 1318 80 1693 11 50 29 148 41 217 12 69 38 186 57 260 19 74 48 185 63 245 15 61 43 155 63 210 140 398 147 417 224 585 57 125 199 399 238 460 23 36 64 103 90 150 75 134 231 354 460 647 226 290 573 645 840 858 27 22 79 67 115 99 199 180 389 323 790 590 364 242 487 320 760 481 204 121 266 158 320 195 30 21 83 51 117 68 34 18 106 58 160 90 54 33 127 74 163 92 36 18 162 88 280 155 118 67 285 160 370 207 85 47 184 103 220 126 36 22 125 78 198 124 241 150 828 545 902 607 25 20 61 48 80 61 19 13 55 41 80 61 25 21 83 68 130 105 409 327 711 674 977 1124 196 330 328 911 299 1310 -4 47 -11 146 -16 220 -9 133 -41 309 -81 445 -11 39 -27 95 -36 125 -17 62 -49 130 -62 130 -16 0 -18 -14 -52 -342 -85 -831 -442 -1453 -1134 -1978 -60 -46 -132 -102 -160 -125 -27 -23 -75 -57 -105 -76 -30 -18 -109 -70 -175 -114 -118 -79 -321 -205 -332 -205 -3 0 -37 -20 -77 -44 -64 -39 -324 -177 -466 -247 -30 -15 -140 -70 -245 -122 -104 -52 -224 -109 -265 -126 -41 -17 -106 -47 -145 -66 -85 -42 -265 -125 -270 -125 -3 0 -158 -72 -345 -160 -187 -88 -342 -160 -345 -160 -2 0 -76 -34 -165 -75 -174 -81 -189 -84 -235 -57 -37 23 -348 347 -401 417 -21 28 -54 68 -73 90 -130 144 -424 635 -516 860 -29 72 -63 152 -75 179 -34 80 -90 254 -111 346 -20 85 -34 151 -70 329 -178 863 65 2009 583 2755 40 58 88 127 106 153 32 46 55 76 215 268 172 208 540 532 750 661 51 31 114 73 142 93 76 55 325 183 528 271 167 72 452 162 648 204 600 130 1279 108 1849 -59 328 -97 607 -204 764 -293 66 -39 144 -81 171 -96 28 -14 88 -52 135 -85 47 -33 117 -82 155 -110 532 -373 998 -980 1297 -1690 46 -110 188 -529 188 -556 0 -10 18 -93 41 -184 86 -351 134 -733 154 -1231 16 -384 -47 -990 -141 -1355 -12 -49 -36 -142 -53 -206 -47 -183 -158 -511 -216 -634 -7 -16 -34 -82 -58 -145 -24 -64 -62 -149 -84 -190 -22 -41 -80 -151 -128 -243 -48 -93 -134 -239 -192 -325 -58 -87 -126 -191 -152 -232 -66 -105 -273 -380 -521 -694 -82 -103 -134 -165 -235 -279 -44 -50 -114 -129 -155 -176 -849 -962 -1086 -1503 -990 -2264 65 -521 345 -990 833 -1395 37 -32 91 -76 120 -100 302 -251 950 -569 1507 -738 80 -24 174 -54 210 -65 83 -27 351 -95 410 -104 25 -4 99 -20 165 -36 230 -55 414 -80 459 -63 36 14 252 309 503 684 93 140 188 282 210 315 49 73 283 436 386 600 42 66 93 145 114 175 41 58 118 181 241 385 40 66 96 156 124 200 52 82 141 237 233 405 28 52 85 151 127 220 100 166 318 555 420 750 76 144 215 412 282 545 67 131 306 631 306 639 0 4 22 52 50 109 27 56 67 145 88 197 22 52 61 145 86 205 26 61 70 164 97 230 28 66 64 149 79 185 105 238 365 982 406 1160 8 36 28 108 44 160 33 111 98 374 135 545 14 66 34 152 45 190 21 76 31 127 85 454 20 118 38 218 40 222 7 11 43 311 62 524 26 285 26 1121 0 1405 -22 243 -93 772 -121 905 -8 39 -22 115 -31 170 -9 55 -23 120 -30 145 -8 25 -21 81 -29 125 -23 121 -81 342 -136 515 -27 85 -58 182 -68 215 -32 98 -168 465 -197 530 -14 33 -42 101 -60 150 -184 499 -771 1521 -1111 1935 -29 36 -99 121 -154 190 -179 222 -240 293 -358 420 -249 265 -732 722 -915 863 -34 27 -87 70 -117 96 -100 87 -423 325 -575 425 -82 54 -168 111 -190 126 -165 113 -548 327 -875 487 -406 201 -690 314 -1160 464 -323 104 -372 118 -525 154 -82 19 -184 44 -225 55 -122 31 -410 88 -485 95 -38 3 -99 12 -135 20 -360 77 -1318 126 -1835 95z M17316 24798 c-22 -59 -63 -187 -92 -287 -154 -528 -300 -668 -879 -851 -191 -60 -220 -72 -223 -98 -4 -28 18 -38 323 -143 523 -181 624 -290 803 -864 84 -273 116 -310 152 -177 36 132 177 506 222 588 140 257 226 314 738 489 289 99 291 106 44 189 -607 206 -755 332 -878 751 -31 106 -121 380 -141 428 -14 34 -52 21 -69 -25z M10979 12800 c-30 -22 -72 -60 -94 -83 -46 -49 -169 -152 -260 -218 -35 -25 -85 -64 -111 -86 -90 -75 -657 -501 -859 -646 -77 -55 -169 -124 -205 -152 -36 -28 -103 -77 -150 -109 -78 -52 -182 -126 -304 -216 -26 -19 -71 -52 -99 -73 -29 -20 -72 -53 -97 -72 -25 -19 -103 -77 -175 -130 -184 -135 -357 -269 -445 -345 -41 -36 -100 -85 -130 -110 -30 -24 -100 -87 -155 -139 -55 -53 -127 -121 -160 -152 -439 -407 -830 -930 -1063 -1419 -40 -85 -82 -171 -92 -191 -46 -85 -188 -489 -216 -614 -9 -38 -20 -78 -25 -87 -20 -37 -86 -363 -98 -485 -6 -54 -18 -154 -27 -223 -89 -712 72 -1749 394 -2530 17 -41 55 -138 85 -215 64 -164 211 -489 263 -584 20 -36 66 -122 102 -191 150 -290 396 -724 468 -825 23 -33 68 -105 99 -160 32 -55 76 -124 99 -155 22 -30 64 -89 91 -130 105 -155 326 -459 520 -715 66 -87 140 -185 164 -219 24 -34 63 -83 87 -109 24 -26 64 -78 90 -115 61 -86 179 -232 319 -397 61 -71 151 -182 199 -245 98 -127 216 -254 258 -276 43 -22 82 1 173 101 44 48 112 122 151 164 39 42 111 123 159 181 84 100 190 221 390 443 50 55 132 150 183 211 52 61 145 170 207 241 134 153 447 521 490 575 17 21 86 104 154 185 68 81 160 193 205 248 45 55 118 145 163 201 45 55 123 155 174 221 51 66 117 149 149 185 31 36 84 103 118 150 35 47 83 109 107 138 70 82 53 133 -55 167 -14 4 -75 31 -135 60 -61 29 -144 67 -185 85 -124 54 -662 342 -731 391 -15 10 -37 23 -50 28 -54 22 -484 300 -682 442 -147 105 -213 154 -377 280 -948 734 -1652 1776 -1799 2665 -43 261 -46 298 -45 544 2 469 74 828 252 1240 131 306 379 735 550 952 31 40 70 91 86 113 94 128 716 813 975 1075 187 188 398 413 441 470 18 25 61 74 95 110 33 36 78 88 100 115 21 28 56 68 76 90 42 45 177 231 227 313 52 85 43 92 -39 32z';
const LOGO_WORD_D = 'M23925 7849 c-480 -47 -796 -377 -795 -833 1 -456 314 -764 831 -817 547 -56 989 316 989 832 0 441 -322 778 -782 819 -124 11 -116 11 -243 -1z M563 7050 c-12 -5 -26 -18 -32 -29 -15 -27 -15 -6380 -1 -6433 6 -20 18 -39 28 -43 26 -12 867 -18 1191 -10 258 7 285 9 302 26 18 18 19 51 19 902 0 844 1 885 18 900 30 28 1203 25 1248 -2 18 -11 74 -80 130 -161 54 -77 124 -176 154 -218 57 -78 116 -162 247 -352 40 -58 91 -132 114 -165 23 -33 65 -91 94 -130 29 -38 104 -146 168 -240 64 -93 148 -215 187 -270 39 -55 96 -137 126 -182 38 -55 66 -86 87 -95 26 -10 185 -13 813 -13 813 0 814 0 814 40 0 13 -109 179 -250 380 -46 66 -107 154 -136 195 -214 312 -421 613 -579 840 -33 47 -87 126 -122 175 -124 179 -159 230 -228 324 -138 188 -138 194 4 256 184 80 414 247 600 435 313 315 510 710 578 1155 26 171 26 622 0 780 -103 626 -438 1157 -942 1492 -351 233 -832 390 -1335 434 -169 15 -3263 24 -3297 9z m3044 -1243 c270 -36 411 -84 580 -195 176 -115 329 -337 390 -562 40 -152 41 -471 1 -621 -63 -232 -197 -434 -382 -573 -132 -99 -342 -183 -556 -222 -150 -28 -1528 -34 -1552 -7 -28 31 -31 2152 -3 2183 l19 21 691 -4 c561 -3 713 -7 812 -20z M19575 6781 c-45 -19 -44 -10 -47 -629 -3 -538 -5 -593 -20 -608 -15 -15 -54 -17 -357 -20 -209 -2 -349 -7 -361 -14 -29 -16 -31 -56 -28 -602 3 -471 4 -509 21 -525 16 -16 49 -18 373 -23 276 -4 357 -8 363 -18 12 -20 20 -1333 11 -1777 -15 -649 18 -880 171 -1203 134 -284 334 -496 616 -652 581 -321 1527 -336 2139 -33 180 88 179 83 103 295 -28 79 -79 222 -114 318 -34 96 -87 245 -117 330 -82 232 -75 227 -196 165 -494 -252 -987 -128 -1108 280 -26 86 -35 2232 -9 2271 l15 24 611 2 c591 3 611 4 625 22 21 29 21 1093 0 1122 -14 18 -35 19 -619 24 -577 5 -606 6 -626 24 -21 19 -21 22 -21 601 0 657 6 614 -81 625 -79 10 -1320 11 -1344 1z M9240 5639 c-160 -10 -360 -37 -485 -65 -74 -17 -311 -89 -407 -123 -101 -37 -329 -155 -452 -236 -576 -374 -900 -826 -1074 -1495 -92 -352 -110 -625 -66 -1019 37 -337 164 -704 355 -1026 303 -509 857 -911 1509 -1094 41 -12 98 -28 125 -36 314 -90 997 -110 1370 -40 276 52 675 201 925 347 573 332 990 880 1139 1493 12 50 29 117 37 150 65 254 69 789 8 1055 -8 35 -22 97 -30 137 -189 914 -948 1652 -1944 1888 -251 60 -663 86 -1010 64z m505 -1229 c669 -128 1055 -679 1022 -1460 -11 -246 -47 -387 -152 -588 -227 -435 -623 -677 -1105 -675 -756 3 -1248 501 -1277 1293 -17 463 91 814 327 1064 153 161 280 242 495 314 245 81 453 97 690 52z M28048 5640 c-58 -4 -130 -13 -160 -19 -29 -5 -89 -15 -133 -22 -180 -26 -495 -129 -693 -227 -591 -294 -1003 -747 -1212 -1333 -71 -199 -82 -232 -102 -314 -101 -418 -103 -878 -6 -1315 72 -327 279 -735 507 -1000 102 -119 119 -136 241 -242 379 -329 891 -566 1435 -662 410 -72 1135 -54 1441 37 575 170 818 299 1182 625 89 80 117 121 106 154 -14 47 -753 798 -784 798 -13 0 -48 -19 -79 -42 -383 -290 -753 -418 -1207 -418 -630 0 -1088 248 -1319 715 -73 147 -85 193 -60 218 15 16 159 17 1871 17 1191 0 1862 4 1874 10 30 16 38 59 51 277 18 301 -9 667 -61 828 -5 17 -23 84 -40 150 -193 751 -805 1391 -1555 1625 -38 12 -95 30 -125 40 -260 88 -774 131 -1172 100z m481 -1106 c386 -56 633 -187 824 -437 127 -165 247 -470 213 -539 l-12 -23 -1167 -3 c-794 -1 -1174 1 -1188 8 -38 21 -18 120 63 312 130 308 346 512 648 615 218 73 424 96 619 67z M34585 5610 c-404 -48 -843 -260 -1142 -552 -128 -125 -131 -120 -132 242 -1 124 -5 230 -9 237 -19 31 -70 33 -707 33 -618 0 -644 -1 -666 -19 l-24 -19 -3 -2475 c-2 -2428 -2 -2475 17 -2498 l19 -24 684 -3 c458 -3 692 0 710 7 48 18 48 12 48 1233 0 1182 4 1317 41 1508 106 543 384 824 957 970 166 42 296 54 494 47 189 -7 197 -5 199 61 8 379 -4 1239 -18 1254 -22 24 -259 23 -468 -2z M13148 5561 c-26 -4 -51 -10 -55 -15 -4 -4 -8 -701 -8 -1549 1 -1690 2 -1733 65 -2027 46 -213 149 -460 262 -631 283 -427 742 -715 1318 -829 285 -56 720 -56 944 1 374 95 716 269 938 477 150 140 148 143 148 -184 0 -222 1 -232 21 -250 34 -31 1315 -23 1342 8 24 28 27 4950 3 4984 -14 18 -35 19 -698 22 -720 3 -750 2 -762 -41 -3 -12 -6 -602 -6 -1312 0 -1396 -1 -1433 -55 -1637 -69 -268 -233 -513 -431 -647 -212 -142 -392 -189 -684 -178 -496 19 -794 279 -902 787 l-22 105 -6 1447 c-3 795 -8 1449 -12 1453 -3 4 -24 11 -45 16 -43 10 -1283 10 -1355 0z M23330 5559 c-13 -6 -28 -15 -32 -22 -4 -7 -8 -1124 -8 -2483 l0 -2471 23 -21 23 -22 685 -3 c376 -1 696 1 711 5 18 6 30 18 37 40 7 23 10 780 8 2490 -2 2344 -3 2458 -20 2475 -21 21 -1376 32 -1427 12z';
function LogoMark({ height = 32 }) {
  return (
    <svg height={height} width={(height * 1830) / 2490} viewBox="40 50 1830 2490" aria-hidden="true">
      <g transform="translate(0 2560) scale(0.1 -0.1)"><path fill={LOGO_ORANGE} d={LOGO_MARK_D} /></g>
    </svg>
  );
}
function LogoFull({ width = 200 }) {
  return (
    <svg width={width} height={(width * 880) / 890} viewBox="355 360 890 880" role="img" aria-label="Routier">
      <g transform="translate(560 360) scale(0.25)"><g transform="translate(0 2560) scale(0.1 -0.1)"><path fill={LOGO_ORANGE} d={LOGO_MARK_D} /></g></g>
      <g transform="translate(355 1025) scale(0.25)"><g transform="translate(0 840) scale(0.1 -0.1)"><path fill={LOGO_INK} d={LOGO_WORD_D} /></g></g>
    </svg>
  );
}

/* ----------------------------- Global stiller ----------------------------- */
function GlobalStyles() {
  return (
    <style>{`
      .rt-num{font-variant-numeric:tabular-nums}
      .rt-noscroll::-webkit-scrollbar{display:none}.rt-noscroll{scrollbar-width:none}
      @keyframes rt-wave{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
      @keyframes rt-dash{to{stroke-dashoffset:-40}}
      @keyframes rt-pulse{0%{transform:scale(.6);opacity:.7}100%{transform:scale(2.2);opacity:0}}
      @keyframes rt-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
      @keyframes rt-fade{from{opacity:0}to{opacity:1}}
      @keyframes rt-glow{0%,100%{box-shadow:0 8px 24px rgba(255,138,91,.45)}50%{box-shadow:0 8px 34px rgba(255,138,91,.75)}}
      @keyframes rt-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
      .rt-up{animation:rt-up .32s cubic-bezier(.2,.8,.2,1) both}
      .rt-fade{animation:rt-fade .2s ease both}
      .rt-glow{animation:rt-glow 2.6s ease-in-out infinite}
      .rt-dash{animation:rt-dash 1.1s linear infinite}
      .rt-dot{animation:rt-blink 1.2s infinite}
      .maplibregl-ctrl-attrib{display:none!important}
            .rt-pin-start{width:18px;height:18px;border-radius:50%;background:#fff;border:5px solid #1E2022;box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .rt-carwrap{width:64px;height:104px;position:relative;pointer-events:none}
      .rt-car-pulse{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(255,138,91,.28);animation:rt-pulse 1.8s ease-out infinite}
      .rt-car-inner{position:absolute;inset:0;transition:transform .2s ease-out;filter:drop-shadow(0 3px 6px rgba(232,115,68,.35))}
      .rt-sig-l,.rt-sig-r{opacity:0}
      .rt-pin-stop{width:30px;height:30px;border-radius:50%;background:#FF8A5B;border:3px solid #fff;display:grid;place-items:center;box-shadow:0 3px 10px rgba(232,115,68,.4)}
      .maplibregl-canvas{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
      .rt-carwrap.sig-l .rt-sig-l,.rt-carwrap.sig-r .rt-sig-r{animation:rt-sig .55s steps(1) infinite}
      @keyframes rt-sig{0%{opacity:1}50%{opacity:0}}
      .rt-car-pulse-svg{transform-box:fill-box;transform-origin:center;animation:rt-pulse 1.8s ease-out infinite}
      @media (prefers-reduced-motion:reduce){.rt-dash,.rt-glow,.rt-up{animation:none}}
    `}</style>
  );
}

/* =========================================================================
   AUTH
   ========================================================================= */
function Field({ icon: Icon, right, ...props }) {
  return (
    <label className="flex h-[52px] items-center gap-3 rounded-2xl border border-[#ECEEF2] bg-[#FAFAFA] px-4 transition focus-within:border-[#FFD8C7] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#FFF1EB]">
      {Icon && <Icon size={18} className="shrink-0 text-[#6B7280]" />}
      <input {...props} className="h-full w-full min-w-0 bg-transparent text-[16px] text-[#1E2022] outline-none placeholder:text-[#9CA3AF]" />
      {right}
    </label>
  );
}

function AuthScreen({ onAuth }) {
  const online = !!supabase;
  const [mode, setMode] = useState('register');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);


  const finish = (s) => {
    setBusy(true);
    setTimeout(() => onAuth(s), 450);
  };

  // Supabase: oturum açıldığında App, onAuthStateChange ile devralır
  const run = async (fn) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (err) {
      setError(authErrorTr(err));
    } finally {
      setBusy(false);
    }
  };
  const social = (provider, mock) => {
    if (!online) { finish(mock); return; }
    run(async () => {
      const { error: err } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectUrl() } });
      if (err) throw err;
      setBusy(true); // sağlayıcının sayfasına yönlendiriliyor
    });
  };
  const guest = () => {
    if (!online) { finish({ id: 'guest', name: 'Misafir Sürücü', email: '', provider: 'guest' }); return; }
    run(async () => {
      const { error: err } = await supabase.auth.signInAnonymously({ options: { data: { full_name: 'Misafir Sürücü' } } });
      if (err) throw err;
    });
  };
  const forgot = () => {
    const mail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(mail)) { setInfo(''); setError('Önce e-posta adresini yaz.'); return; }
    if (!online) { setInfo(`Sıfırlama bağlantısı ${mail} adresine gönderildi.`); return; }
    run(async () => {
      const { error: err } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: redirectUrl() });
      if (err) throw err;
      setInfo(`Sıfırlama bağlantısı ${mail} adresine gönderildi.`);
    });
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    const mail = email.trim().toLowerCase();
    if (mode === 'register') {
      if (!first.trim() || !last.trim()) return setError('Lütfen isim ve soyisim girin.');
      if (!/^\S+@\S+\.\S+$/.test(mail)) return setError('Geçerli bir e-posta adresi girin.');
      if (pass.length < 6) return setError('Şifre en az 6 karakter olmalı.');
      if (online) {
        run(async () => {
          const { data, error: err } = await supabase.auth.signUp({
            email: mail, password: pass,
            options: { data: { first_name: first.trim(), last_name: last.trim(), full_name: `${first.trim()} ${last.trim()}` }, emailRedirectTo: redirectUrl() },
          });
          if (err) throw err;
          if (!data.session) {
            setMode('login');
            setInfo(`Onay bağlantısı ${mail} adresine gönderildi. E-postanı onayladıktan sonra giriş yap.`);
          }
        });
        return undefined;
      }
      const users = store.get('routier_users', {});
      users[mail] = { first: first.trim(), last: last.trim() };
      store.set('routier_users', users);
      finish({ id: mail, name: `${first.trim()} ${last.trim()}`, email: mail, provider: 'email' });
    } else {
      if (!/^\S+@\S+\.\S+$/.test(mail)) return setError('Geçerli bir e-posta adresi girin.');
      if (pass.length < 6) return setError('Şifre en az 6 karakter olmalı.');
      if (online) {
        run(async () => {
          const { error: err } = await supabase.auth.signInWithPassword({ email: mail, password: pass });
          if (err) throw err;
        });
        return undefined;
      }
      const users = store.get('routier_users', {});
      const u = users[mail];
      const derived = mail.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toLocaleUpperCase('tr-TR'));
      finish({ id: mail, name: u ? `${u.first} ${u.last}` : derived, email: mail, provider: 'email' });
    }
    return undefined;
  };

  return (
    <div className="rt-noscroll relative h-full overflow-y-auto bg-white">
      <svg className="pointer-events-none absolute inset-x-0 top-0 h-[260px] w-full" viewBox="0 0 430 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="430" height="260" fill="#F8F6F4" />
        <path d="M-20 210 C 80 160, 120 60, 230 90 S 380 40, 460 10" stroke="#FFD8C7" strokeWidth="2" fill="none" strokeDasharray="6 8" />
        <path d="M-20 240 C 120 200, 200 150, 300 170 S 420 120, 460 100" stroke="#ECEEF2" strokeWidth="10" fill="none" />
        <circle cx="230" cy="90" r="5" fill="#FFD8C7" />
        <rect y="200" width="430" height="60" fill="url(#rtfade)" />
        <defs><linearGradient id="rtfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" /></linearGradient></defs>
      </svg>

      <div className="relative px-6 pb-10 pt-[max(56px,calc(env(safe-area-inset-top)+28px))]">
        <div className="flex flex-col items-center text-center">
          <h1 className="sr-only">Routier</h1>
          <LogoFull width={190} />
          <p className="mt-3 text-[15px] text-[#6B7280]">Akıllı ve tasarruflu yolculuklara başla</p>
        </div>

        <div className="mt-8 grid grid-cols-2 rounded-full bg-[#F8F6F4] p-1 ring-1 ring-[#ECEEF2]">
          {[['register', 'Hesap Oluştur'], ['login', 'Giriş Yap']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setMode(k); setError(''); setInfo(''); }}
              className={`h-11 rounded-full text-[14px] font-semibold transition ${mode === k ? 'bg-white text-[#1E2022] shadow-[0_4px_14px_rgba(0,0,0,0.06)]' : 'text-[#6B7280]'}`}>
              {l}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
          {mode === 'register' && (
            <div className="grid grid-cols-2 gap-3">
              <Field icon={User} placeholder="İsim" value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" />
              <Field placeholder="Soyisim" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" />
            </div>
          )}
          <Field icon={Mail} type="email" inputMode="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Field icon={Lock} type={show ? 'text' : 'password'} placeholder="Şifre" value={pass} onChange={(e) => setPass(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            right={(
              <button type="button" onClick={() => setShow((s) => !s)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#6B7280] hover:bg-[#F8F6F4]" aria-label={show ? 'Şifreyi gizle' : 'Şifreyi göster'}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            )} />
          {mode === 'login' && (
            <div className="flex justify-end">
              <button type="button" onClick={forgot} className="text-[13px] font-semibold text-[#E87344]">
                Şifremi Unuttum
              </button>
            </div>
          )}
          {error && <p className="rt-fade flex items-center gap-2 rounded-xl bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#EF4444]"><AlertTriangle size={15} />{error}</p>}
          {info && <p className="rt-fade flex items-center gap-2 rounded-xl bg-[#ECFDF5] px-3 py-2 text-[13px] text-[#047857]"><Check size={15} />{info}</p>}
          <button type="submit" disabled={busy}
            className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A5B] text-[16px] font-bold text-white shadow-[0_8px_24px_rgba(255,138,91,0.35)] transition hover:bg-[#E87344] active:scale-[.99] disabled:opacity-70">
            {busy ? <Loader2 size={20} className="animate-spin" /> : (mode === 'register' ? 'Hesap Oluştur' : 'Giriş Yap')}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-[13px] text-[#9CA3AF]">
          <span className="h-px flex-1 bg-[#ECEEF2]" />veya<span className="h-px flex-1 bg-[#ECEEF2]" />
        </div>

        <div className="space-y-3">
          <button type="button" disabled={busy} onClick={() => social('google', { id: 'google-user', name: 'Google Kullanıcısı', email: 'kullanici@gmail.com', provider: 'google' })}
            className="flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl border border-[#ECEEF2] bg-white text-[15px] font-semibold text-[#1E2022] transition hover:bg-[#FAFAFA]">
            <GoogleLogo /> Google ile Devam Et
          </button>
          <button type="button" disabled={busy} onClick={() => social('apple', { id: 'apple-user', name: 'Apple Kullanıcısı', email: 'kullanici@icloud.com', provider: 'apple' })}
            className="flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl border border-[#ECEEF2] bg-white text-[15px] font-semibold text-[#1E2022] transition hover:bg-[#FAFAFA]">
            <AppleLogo /> Apple ile Devam Et
          </button>
        </div>

        <button type="button" disabled={busy} onClick={guest}
          className="mx-auto mt-6 flex h-11 items-center gap-1 px-4 text-[14px] font-medium text-[#6B7280] hover:text-[#1E2022]">
          Misafir Olarak Devam Et <ArrowRight size={16} />
        </button>
        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-[#9CA3AF]">Devam ederek Kullanım Koşulları ve Gizlilik Politikası'nı kabul etmiş olursunuz.</p>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-[#9CA3AF]">
          {online ? <><Cloud size={13} />Hesabın Supabase ile güvenle saklanır</> : <><CloudOff size={13} />Demo modu: veriler bu cihazda tutulur</>}
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
   HARİTA — Canlı (MapLibre + OpenFreeMap) ve SVG yedek
   ========================================================================= */

/* ---------- Sürüş animasyonu: yumuşak konum + ileriye bakan yön ---------- */
function makeLine(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + distM(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1] || 1;
  const atDist = (d) => {
    const x = Math.max(0, Math.min(total, d));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= x) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const f = (x - cum[lo]) / seg;
    const a = coords[lo];
    const b = coords[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  return { total, atDist };
}
function offsetPoint([lon, lat], bearing, m) {
  const d = m / 6371000;
  const br = toRad(bearing);
  const la = toRad(lat);
  const lo = toRad(lon);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br));
  const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI];
}
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function useDriveAnimator(coords, progress, onFrame) {
  const line = useMemo(() => (coords && coords.length > 1 ? makeLine(coords) : null), [coords]);
  const target = useRef(progress);
  target.current = progress;
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const active = progress != null && !!line;
  useEffect(() => {
    if (!active) return undefined;
    const s = { d: target.current * line.total, b: null, turn: 0, t0: performance.now() };
    let raf;
    const loop = (now) => {
      if (target.current == null) return;
      // Konum: hedef ilerlemeye yumuşak yaklaşım (100 ms'lik adımlar akıcı harekete dönüşür)
      s.d += (target.current * line.total - s.d) * 0.1;
      const pos = line.atDist(s.d);
      // Yön: 90 m ilerideki noktaya bakar, keskin köşeleri önceden yumuşatır
      const ahead = line.atDist(s.d + 90);
      const want = distM(pos, ahead) > 1 ? bearingOf(pos, ahead) : (s.b ?? 0);
      if (s.b == null) s.b = want;
      const diff = angDiff(s.b, want);
      s.b = (s.b + diff * 0.07 + 360) % 360;
      s.turn = s.turn * 0.9 + diff * 0.1;
      cb.current({ coord: pos, bearing: s.b, turn: s.turn, elapsed: now - s.t0 });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, line]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ---------- Dinamik araç ikonu (kuşbakışı araç + far ışığı + sinyal + nabız) ---------- */
const CAR_SVG = `
<svg viewBox="-26 -42 52 84" width="64" height="104" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rtbeam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF8A5B" stop-opacity=".45"/><stop offset="1" stop-color="#FF8A5B" stop-opacity="0"/></linearGradient>
    <linearGradient id="rtbody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E87344"/><stop offset=".5" stop-color="#FF8A5B"/><stop offset="1" stop-color="#E87344"/></linearGradient>
  </defs>
  <path class="rt-beam" d="M-6 -14 L-20 -42 L20 -42 L6 -14Z" fill="url(#rtbeam)"/>
  <ellipse cx="0" cy="3" rx="13" ry="19" fill="#1E2022" opacity=".14"/>
  <rect x="-9.5" y="-16" width="19" height="32" rx="7.5" fill="url(#rtbody)" stroke="#fff" stroke-width="2.4"/>
  <path d="M-6.8 -7 Q0 -10.5 6.8 -7 L5.8 -1.5 L-5.8 -1.5Z" fill="#1E2022" opacity=".78"/>
  <rect x="-6" y="-1" width="12" height="9" rx="2.2" fill="#FFB596"/>
  <rect x="-5.6" y="8.6" width="11.2" height="3.6" rx="1.6" fill="#1E2022" opacity=".62"/>
  <circle cx="-5.6" cy="-14" r="1.7" fill="#FFF7D6"/><circle cx="5.6" cy="-14" r="1.7" fill="#FFF7D6"/>
  <circle class="rt-sig-l" cx="-8.6" cy="13.2" r="2" fill="#F59E0B"/><circle class="rt-sig-r" cx="8.6" cy="13.2" r="2" fill="#F59E0B"/>
  <circle class="rt-sig-l" cx="-8.6" cy="-13.4" r="1.6" fill="#F59E0B"/><circle class="rt-sig-r" cx="8.6" cy="-13.4" r="1.6" fill="#F59E0B"/>
</svg>`;
function carSignalClass(turn) {
  if (turn < -1.2) return 'rt-carwrap sig-l';
  if (turn > 1.2) return 'rt-carwrap sig-r';
  return 'rt-carwrap';
}

/* ---------- SVG yedek harita (kaydırma, iki parmakla yakınlaştırma, tekerlek) ---------- */
const SVG_B = { x0: 28.955, x1: 29.145, y0: 40.935, y1: 41.098 };
const SVG_W = 1000;
const SVG_H = Math.round(SVG_W * ((SVG_B.y1 - SVG_B.y0) * 111) / ((SVG_B.x1 - SVG_B.x0) * 111 * Math.cos(toRad(41))));
const proj = ([x, y]) => [((x - SVG_B.x0) / (SVG_B.x1 - SVG_B.x0)) * SVG_W, ((SVG_B.y1 - y) / (SVG_B.y1 - SVG_B.y0)) * SVG_H];
const pathOf = (coords) => coords.map((c, i) => `${i ? 'L' : 'M'}${proj(c).map((n) => n.toFixed(1)).join(' ')}`).join(' ');

const ASIA_COAST = [[29.145, 40.948], [29.11, 40.952], [29.09, 40.952], [29.07, 40.962], [29.05, 40.968], [29.035, 40.975], [29.025, 40.982], [29.022, 40.99], [29.012, 41.003], [29.008, 41.015], [29.012, 41.028], [29.024, 41.038], [29.038, 41.046], [29.048, 41.058], [29.054, 41.072], [29.06, 41.085], [29.068, 41.098]];
const EURO_COAST = [[29.052, 41.098], [29.044, 41.084], [29.038, 41.072], [29.032, 41.06], [29.024, 41.049], [29.01, 41.043], [28.995, 41.037], [28.983, 41.027], [28.978, 41.016], [28.97, 41.008], [28.955, 41.005]];
const WATER = [...ASIA_COAST, ...EURO_COAST, [28.955, 40.935], [29.145, 40.935]];
const MAIN_ROADS = [
  [[29.145, 40.968], [29.1, 40.972], [29.085, 40.97], [29.07, 40.985], [29.056, 41.0], [29.05, 41.015], [29.045, 41.03], [29.034, 41.045], [29.02, 41.056], [29.012, 41.067], [29.0107, 41.098]],
  [[29.145, 40.995], [29.1, 40.98], [29.088, 40.996], [29.07, 41.01], [29.052, 41.023], [29.04, 41.038]],
  [[29.096, 40.953], [29.07, 40.966], [29.045, 40.975], [29.027, 40.988], [29.015, 41.01], [29.016, 41.027], [29.03, 41.04]],
  [[29.0107, 41.081], [28.995, 41.07], [28.985, 41.05], [28.98, 41.035]],
  [[29.045, 41.03], [29.07, 41.04], [29.1, 41.03], [29.145, 41.02]],
  [[29.096, 40.953], [29.104, 40.962], [29.11, 40.972], [29.116, 40.982], [29.1235, 40.9925], [29.135, 41.005]],
].map((r) => chaikin(r, 2));
const PARKS = [[29.04, 41.014, 34], [29.033, 41.036, 22], [29.012, 41.05, 26], [29.07, 40.975, 20], [29.115, 40.995, 24], [28.99, 41.062, 18], [29.085, 41.035, 30]];
const LABELS = [[29.06, 40.99, 'KADIKÖY'], [29.03, 41.022, 'ÜSKÜDAR'], [28.995, 41.048, 'BEŞİKTAŞ'], [29.0, 41.09, 'LEVENT'], [29.12, 41.005, 'ATAŞEHİR'], [29.1, 40.945, 'BOSTANCI'], [28.99, 41.0, 'Marmara Denizi'], [29.04, 41.07, 'İstanbul Boğazı']];

function SvgMap({ routes, selected, start, end, drive, follow, onUserPan, recenterTick, stopPoint, onLongPress }) {
  const pickCb = useRef(onLongPress);
  pickCb.current = onLongPress;
  const wrap = useRef(null);
  const svg = useRef(null);
  const world = useRef(null);
  const car = useRef(null);
  const v = useRef({ cx: SVG_W / 2, cy: SVG_H / 2, upp: 1, rot: 0, rx: 0, ry: 0, cw: 390, ch: 844, user: false });
  const followRef = useRef(follow);
  followRef.current = follow;
  const panCb = useRef(onUserPan);
  panCb.current = onUserPan;
  const driving = drive != null;
  const drivingRef = useRef(driving);
  drivingRef.current = driving;

  const apply = useCallback(() => {
    const s = v.current;
    if (!svg.current) return;
    const w = s.cw * s.upp;
    const h = s.ch * s.upp;
    svg.current.setAttribute('viewBox', `${s.cx - w / 2} ${s.cy - h / 2} ${w} ${h}`);
    if (world.current) world.current.setAttribute('transform', s.rot ? `rotate(${-s.rot} ${s.rx} ${s.ry})` : '');
    // Pinler ve yazılar ekranda sabit boyutta, her zaman dik kalır
    svg.current.querySelectorAll('[data-at]').forEach((el) => {
      const [x, y] = el.getAttribute('data-at').split(',').map(Number);
      el.setAttribute('transform', `translate(${x} ${y}) rotate(${s.rot}) scale(${s.upp})`);
    });
  }, []);

  const fit = useCallback(() => {
    const s = v.current;
    const pts = Object.values(routes).flat().concat([start, end]).map(proj);
    let ax = Infinity; let ay = Infinity; let bx = -Infinity; let by = -Infinity;
    pts.forEach(([x, y]) => { ax = Math.min(ax, x); ay = Math.min(ay, y); bx = Math.max(bx, x); by = Math.max(by, y); });
    const top = 210;
    const bottom = 430;
    s.upp = clamp(Math.max((bx - ax) / Math.max(80, s.cw - 80), (by - ay) / Math.max(80, s.ch - top - bottom)), 0.12, 4);
    const visCenter = (top + s.ch - bottom) / 2;
    s.cx = (ax + bx) / 2;
    s.cy = (ay + by) / 2 - (visCenter - s.ch / 2) * s.upp;
    s.rot = 0;
    s.user = false;
    apply();
  }, [routes, start, end, apply]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Boyut değişimi
  useEffect(() => {
    const el = wrap.current;
    const ro = new ResizeObserver(() => {
      const s = v.current;
      s.cw = el.clientWidth || 390;
      s.ch = el.clientHeight || 844;
      if (!s.user && !drivingRef.current) fitRef.current(); else apply();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply]);

  useEffect(() => { if (!drivingRef.current) fit(); }, [routes, start, end]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (recenterTick && !drivingRef.current) fit(); }, [recenterTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!driving) fit(); }, [driving]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { apply(); }, [stopPoint, apply]);

  // Dokunma / fare etkileşimi
  useEffect(() => {
    const el = wrap.current;
    const pts = new Map();
    let moved = 0;
    let lpT = null;
    let last = null;
    const local = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const zoomAt = (px, py, f) => {
      const s = v.current;
      const wx = s.cx + (px - s.cw / 2) * s.upp;
      const wy = s.cy + (py - s.ch / 2) * s.upp;
      const nu = clamp(s.upp * f, 0.12, 4);
      s.cx = wx - (px - s.cw / 2) * nu;
      s.cy = wy - (py - s.ch / 2) * nu;
      s.upp = nu;
    };
    const userMoved = () => {
      v.current.user = true;
      if (drivingRef.current && followRef.current) {
        followRef.current = false;
        if (panCb.current) panCb.current();
      }
    };
    const snapshot = () => {
      const arr = [...pts.values()];
      if (arr.length >= 2) {
        const [a, b] = arr;
        return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist: Math.hypot(a[0] - b[0], a[1] - b[1]) };
      }
      return arr.length ? { mid: arr[0], dist: 0 } : null;
    };
    const pickAt = ([px, py]) => {
      const s = v.current;
      if (drivingRef.current || !pickCb.current || s.rot) return;
      const wx = s.cx + (px - s.cw / 2) * s.upp;
      const wy = s.cy + (py - s.ch / 2) * s.upp;
      pickCb.current([SVG_B.x0 + (wx / SVG_W) * (SVG_B.x1 - SVG_B.x0), SVG_B.y1 - (wy / SVG_H) * (SVG_B.y1 - SVG_B.y0)]);
    };
    const down = (e) => {
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* yok say */ }
      pts.set(e.pointerId, local(e));
      moved = 0;
      last = snapshot();
      clearTimeout(lpT);
      if (pts.size === 1 && e.button !== 2) {
        const at = local(e);
        lpT = setTimeout(() => { if (moved < 8 && pts.size === 1) pickAt(at); }, 600);
      }
    };
    const ctx = (e) => { e.preventDefault(); clearTimeout(lpT); pickAt(local(e)); };
    const move = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const now = snapshot();
      if (!now || !last) { last = now; return; }
      const s = v.current;
      const dx = now.mid[0] - last.mid[0];
      const dy = now.mid[1] - last.mid[1];
      if (pts.size >= 2 && last.dist > 0 && now.dist > 0) zoomAt(now.mid[0], now.mid[1], last.dist / now.dist);
      s.cx -= dx * s.upp;
      s.cy -= dy * s.upp;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved >= 8) clearTimeout(lpT);
      if (moved > 4 || pts.size >= 2) userMoved();
      last = now;
      apply();
    };
    const up = (e) => { pts.delete(e.pointerId); last = snapshot(); clearTimeout(lpT); };
    const wheel = (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(x, y, Math.exp(e.deltaY * 0.0015));
      userMoved();
      apply();
    };
    const dbl = (e) => { const [x, y] = local(e); zoomAt(x, y, 0.55); userMoved(); apply(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', dbl);
    el.addEventListener('contextmenu', ctx);
    return () => {
      clearTimeout(lpT);
      el.removeEventListener('contextmenu', ctx);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', dbl);
    };
  }, [apply]);

  // Sürüş karesi
  useDriveAnimator(routes[selected], drive, (f) => {
    const s = v.current;
    const [x, y] = proj(f.coord);
    if (followRef.current) {
      if (f.elapsed < 2400) s.upp += (0.3 - s.upp) * 0.05;
      s.rot = f.bearing;
      s.rx = x;
      s.ry = y;
      s.cx = x;
      // Araç, üst yönlendirme kartı ile alt panel arasındaki görünür alanın ortasında
      s.cy = y - (Math.max(s.ch * 0.42, s.ch - 400) - s.ch / 2) * s.upp;
      apply();
    }
    if (car.current) {
      car.current.setAttribute('transform', `translate(${x} ${y}) rotate(${f.bearing}) scale(${s.upp * 1.3})`);
      car.current.setAttribute('class', carSignalClass(f.turn));
      const inner = car.current.querySelector('.rt-car-lean');
      if (inner) inner.setAttribute('transform', `rotate(${clamp(f.turn * 1.6, -14, 14)})`);
    }
  });

  const order = ['scenic', 'fast', 'eco'].filter((k) => k !== selected).concat(selected);
  const [sx, sy] = proj(start);
  const [ex, ey] = proj(end);
  const line = (d, stroke, width, extra = {}) => <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" {...extra} />;

  return (
    <div ref={wrap} className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing">
      <svg ref={svg} className="absolute inset-0 h-full w-full" viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="rt-grid" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
            <path d="M0 0H22M0 0V22" stroke="#FFFFFF" strokeWidth="2.4" />
          </pattern>
        </defs>
        <g ref={world}>
          <rect x="-4000" y="-4000" width="9000" height="9000" fill="#F3F4F6" />
          <rect x="-4000" y="-4000" width="9000" height="9000" fill="url(#rt-grid)" opacity=".9" />
          {PARKS.map(([x, y, r], i) => {
            const [px, py] = proj([x, y]);
            return <ellipse key={i} cx={px} cy={py} rx={r * 1.4} ry={r} fill="#ECFDF5" stroke="#D1FAE5" strokeWidth="2" />;
          })}
          <path d={`${pathOf(WATER)} Z`} fill="#E0F2FE" stroke="#CDE9FB" strokeWidth="3" />
          {MAIN_ROADS.map((r, i) => <g key={i}>{line(pathOf(r), '#E5E7EB', 11)}</g>)}
          {MAIN_ROADS.map((r, i) => <g key={`w${i}`}>{line(pathOf(r), '#FFFFFF', 8)}</g>)}
          {line(pathOf([[29.024, 41.0425], [29.04, 41.047]]), '#D1D5DB', 12)}
          {line(pathOf([[29.024, 41.0425], [29.04, 41.047]]), '#FFFFFF', 8)}
          {order.map((k) => (routes[k] ? (
            <g key={k}>
              {k === selected ? (
                <>
                  {line(pathOf(routes[k]), '#FF8A5B', 18, { strokeOpacity: 0.22 })}
                  {line(pathOf(routes[k]), '#FF8A5B', 7)}
                  {line(pathOf(routes[k]), '#FFFFFF', 2.4, { className: 'rt-dash', strokeDasharray: '6 14' })}
                </>
              ) : line(pathOf(routes[k]), '#C9CDD4', 5)}
            </g>
          ) : null))}
          {LABELS.map(([x, y, t]) => {
            const [px, py] = proj([x, y]);
            const water = /Deniz|Boğaz/.test(t);
            return (
              <g key={t} data-at={`${px},${py}`}>
                <text textAnchor="middle" fontSize={water ? 12 : 10.5} fontWeight={water ? 500 : 700} letterSpacing={water ? 0 : 1.6} fill={water ? '#7DB9DD' : '#9CA3AF'} fontStyle={water ? 'italic' : 'normal'} stroke={water ? 'none' : '#F3F4F6'} strokeWidth="3" paintOrder="stroke">{t}</text>
              </g>
            );
          })}
          <g data-at={`${sx},${sy}`}><circle r="8" fill="#fff" stroke="#1E2022" strokeWidth="4.5" /></g>
          <g data-at={`${ex},${ey}`}>
            <circle r="16" fill="#FF8A5B" opacity=".2"><animate attributeName="r" values="8;20;8" dur="2.4s" repeatCount="indefinite" /></circle>
            <path d="M0 0 C -10 -13 -12 -17 -12 -23 A12 12 0 1 1 12 -23 C 12 -17 10 -13 0 0Z" fill="#FF8A5B" stroke="#fff" strokeWidth="2.5" />
            <circle cy="-23" r="4.5" fill="#fff" />
          </g>
          {stopPoint && (() => {
            const [qx, qy] = proj(stopPoint);
            return (
              <g data-at={`${qx},${qy}`}>
                <circle r="12" fill="#FF8A5B" stroke="#fff" strokeWidth="3" />
                <path d="M-3.5 5.5V-5.5h7.5l-1.8 2.8 1.8 2.8h-7.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })()}
          {driving && (
            <g ref={car} className="rt-carwrap">
              <circle className="rt-car-pulse-svg" r="22" fill="#FF8A5B" opacity=".22" />
              <g className="rt-car-lean" dangerouslySetInnerHTML={{ __html: CAR_SVG.replace(/<\/?svg[^>]*>/g, '') }} />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

/* ---------- Canlı harita (MapLibre + OpenFreeMap) ---------- */
function LiveMap({ routes, selected, start, end, drive, follow, onUserPan, onFail, locateTick, onToast, stopPoint, onLongPress }) {
  const pickCb = useRef(onLongPress);
  pickCb.current = onLongPress;
  const box = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef({});
  const [ready, setReady] = useState(false);
  const failed = useRef(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  const panCb = useRef(onUserPan);
  panCb.current = onUserPan;
  const driving = drive != null;
  const drivingRef = useRef(driving);
  drivingRef.current = driving;

  const fitAll = useCallback((duration = 700) => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(boundsOf(Object.values(routes).concat([[start, end]])), { padding: { top: 200, bottom: 420, left: 48, right: 48 }, duration, pitch: 0, bearing: 0 });
  }, [routes, start, end]);

  useEffect(() => {
    if (!webglOK()) { onFail(); return undefined; }
    let loaded = false;
    let map;
    try {
      map = new maplibregl.Map({
        container: box.current,
        style: MAP_STYLE,
        center: [29.05, 41.015],
        zoom: 11.3,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
        dragPan: true,
        scrollZoom: true,
        touchZoomRotate: true,
        doubleClickZoom: true,
      });
      map.touchZoomRotate.disableRotation();
    } catch (e) {
      onFail();
      return undefined;
    }
    mapRef.current = map;
    const fail = () => {
      if (loaded || failed.current) return;
      failed.current = true;
      onFail();
    };
    const timer = setTimeout(fail, 9000);
    map.on('error', () => { if (!loaded) fail(); });
    // Sürüşte kullanıcı haritayı sürüklerse takip modunu bırak
    map.on('dragstart', (e) => {
      if (e.originalEvent && drivingRef.current && followRef.current) {
        followRef.current = false;
        if (panCb.current) panCb.current();
      }
    });
    // Basılı tutarak nokta seçme (dokunmatik) ve sağ tık (masaüstü)
    let lp = null;
    const lpEnd = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
    const lpStart = (e) => {
      lpEnd();
      if (drivingRef.current || !pickCb.current) return;
      const oe = e.originalEvent;
      if (oe && ((oe.touches && oe.touches.length > 1) || oe.button === 2)) return;
      const ll = e.lngLat;
      lp = { pt: e.point, t: setTimeout(() => { lp = null; if (pickCb.current) pickCb.current([ll.lng, ll.lat]); }, 600) };
    };
    const lpMove = (e) => { if (lp && e.point && Math.hypot(e.point.x - lp.pt.x, e.point.y - lp.pt.y) > 10) lpEnd(); };
    map.on('touchstart', lpStart);
    map.on('touchmove', lpMove);
    map.on('touchend', lpEnd);
    map.on('touchcancel', lpEnd);
    map.on('mousedown', lpStart);
    map.on('mousemove', lpMove);
    map.on('mouseup', lpEnd);
    map.on('dragstart', lpEnd);
    map.on('zoomstart', lpEnd);
    map.on('contextmenu', (e) => { lpEnd(); if (!drivingRef.current && pickCb.current) pickCb.current([e.lngLat.lng, e.lngLat.lat]); });
    map.on('load', () => {
      loaded = true;
      clearTimeout(timer);
      (map.getStyle().layers || []).forEach((l) => {
        const id = l.id.toLowerCase();
        try {
          if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#F3F4F6');
          else if (l.type === 'fill' && /water/.test(id)) map.setPaintProperty(l.id, 'fill-color', '#E0F2FE');
          else if (l.type === 'fill' && /park|wood|grass|forest|landcover|landuse_park/.test(id)) map.setPaintProperty(l.id, 'fill-color', '#ECFDF5');
          else if (l.type === 'line' && /highway|road|street|motorway|trunk|primary|secondary|minor/.test(id) && !/casing|outline|rail/.test(id)) map.setPaintProperty(l.id, 'line-color', '#FFFFFF');
        } catch (e) { /* katman desteklemiyorsa geç */ }
      });
      map.addSource('rt-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const lay = { 'line-cap': 'round', 'line-join': 'round' };
      map.addLayer({ id: 'rt-alt', type: 'line', source: 'rt-routes', filter: ['!=', ['get', 'sel'], true], layout: lay, paint: { 'line-color': '#C9CDD4', 'line-width': 5 } });
      map.addLayer({ id: 'rt-glow', type: 'line', source: 'rt-routes', filter: ['==', ['get', 'sel'], true], layout: lay, paint: { 'line-color': '#FF8A5B', 'line-width': 16, 'line-opacity': 0.2, 'line-blur': 2 } });
      map.addLayer({ id: 'rt-main', type: 'line', source: 'rt-routes', filter: ['==', ['get', 'sel'], true], layout: lay, paint: { 'line-color': '#FF8A5B', 'line-width': 6.5 } });
      map.addLayer({ id: 'rt-dash', type: 'line', source: 'rt-routes', filter: ['==', ['get', 'sel'], true], layout: lay, paint: { 'line-color': '#FFFFFF', 'line-width': 2.2, 'line-dasharray': [0, 4, 3] } });
      setReady(true);
    });

    const seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
    let step = 0;
    const iv = setInterval(() => {
      if (!loaded || !map.getLayer('rt-dash')) return;
      step = (step + 1) % seq.length;
      try { map.setPaintProperty('rt-dash', 'line-dasharray', seq[step]); } catch (e) { /* yok say */ }
    }, 70);

    const ro = new ResizeObserver(() => { try { map.resize(); } catch (e) { /* yok say */ } });
    ro.observe(box.current);
    return () => {
      clearTimeout(timer);
      clearInterval(iv);
      ro.disconnect();
      try { map.remove(); } catch (e) { /* yok say */ }
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rotalar ve pinler
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const features = Object.entries(routes).map(([id, coords]) => ({ type: 'Feature', properties: { id, sel: id === selected }, geometry: { type: 'LineString', coordinates: coords } }));
    features.sort((a, b) => (a.properties.sel ? 1 : 0) - (b.properties.sel ? 1 : 0));
    map.getSource('rt-routes').setData({ type: 'FeatureCollection', features });
    if (!markers.current.start) {
      const el = document.createElement('div');
      el.className = 'rt-pin-start';
      markers.current.start = new maplibregl.Marker({ element: el }).setLngLat(start).addTo(map);
    } else markers.current.start.setLngLat(start);
    if (!markers.current.end) markers.current.end = new maplibregl.Marker({ color: '#FF8A5B' }).setLngLat(end).addTo(map);
    else markers.current.end.setLngLat(end);
    if (!drivingRef.current) fitAll();
  }, [ready, routes, selected, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // Durak işareti
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (stopPoint) {
      if (!markers.current.stop) {
        const el = document.createElement('div');
        el.className = 'rt-pin-stop';
        el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22V3h12l-2.5 4.5L17 12H5"/></svg>';
        markers.current.stop = new maplibregl.Marker({ element: el }).setLngLat(stopPoint).addTo(map);
      } else markers.current.stop.setLngLat(stopPoint);
    } else if (markers.current.stop) {
      markers.current.stop.remove();
      markers.current.stop = null;
    }
  }, [ready, stopPoint]);

  // Sürüş başla / bitir
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (driving) {
      if (!markers.current.car) {
        const el = document.createElement('div');
        el.className = 'rt-carwrap';
        el.innerHTML = `<span class="rt-car-pulse"></span><div class="rt-car-inner">${CAR_SVG}</div>`;
        markers.current.car = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(start).addTo(map);
      }
    } else if (markers.current.car) {
      markers.current.car.remove();
      markers.current.car = null;
      fitAll(900);
    }
  }, [ready, driving]); // eslint-disable-line react-hooks/exhaustive-deps

  // Takibe dönüldüğünde kamerayı yumuşakça araca getir
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && driving && follow) map.stop();
  }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps

  useDriveAnimator(routes[selected], ready ? drive : null, (f) => {
    const map = mapRef.current;
    const m = markers.current.car;
    if (!map || !m) return;
    m.setLngLat(f.coord);
    m.setRotation(f.bearing);
    const el = m.getElement();
    el.className = carSignalClass(f.turn);
    const inner = el.querySelector('.rt-car-inner');
    if (inner) inner.style.transform = `rotate(${clamp(f.turn * 1.6, -14, 14)}deg)`;
    if (followRef.current) {
      const z = map.getZoom();
      const nz = f.elapsed < 2400 ? z + (16.3 - z) * 0.06 : z;
      const np = map.getPitch() + (55 - map.getPitch()) * 0.06;
      const mpp = (78271.517 * Math.cos(toRad(f.coord[1]))) / 2 ** nz;
      const h = box.current ? box.current.clientHeight : 800;
      const center = offsetPoint(f.coord, f.bearing, (Math.max(h * 0.42, h - 400) - h / 2) * mpp * 1.6);
      map.jumpTo({ center, bearing: f.bearing, zoom: nz, pitch: np });
    }
  });

  // Konumum
  useEffect(() => {
    if (!locateTick) return;
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) { fitAll(); onToast('Konum servisi bu cihazda kullanılamıyor'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const c = [p.coords.longitude, p.coords.latitude];
        if (!markers.current.me) {
          const el = document.createElement('div');
          el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.2)';
          markers.current.me = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map);
        } else markers.current.me.setLngLat(c);
        map.flyTo({ center: c, zoom: 15, duration: 900 });
      },
      () => { fitAll(); onToast('Konum izni verilmedi, rotaya odaklanıldı'); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [locateTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Not: MapLibre kapsayıcıya 'position:relative' verir; satır içi stil ile tam ekran kalması garanti edilir
  return <div ref={box} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }} />;
}

function MapCanvas(props) {
  const [mode, setMode] = useState('live');
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#F3F4F6]">
      {mode === 'live'
        ? <LiveMap {...props} onFail={() => setMode('svg')} />
        : <SvgMap {...props} recenterTick={props.locateTick} />}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-white/50 via-transparent to-transparent" style={{ height: 200 }} />
    </div>
  );
}

/* =========================================================================
   ORTAK BİLEŞENLER
   ========================================================================= */
function Sheet({ onClose, children, title, tall }) {
  return (
    <div className="absolute inset-0 z-50 flex items-end">
      <button type="button" aria-label="Kapat" onClick={onClose} className="rt-fade absolute inset-0 bg-[#1E2022]/30 backdrop-blur-[2px]" />
      <div className={`rt-up relative w-full rounded-t-[32px] bg-white pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-10px_40px_rgba(0,0,0,0.08)] ${tall ? 'max-h-[92%]' : 'max-h-[80%]'} flex flex-col`}>
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-[#E5E7EB]" />
        {title && (
          <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-3">
            <h3 className="text-[18px] font-bold text-[#1E2022]">{title}</h3>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-[#F8F6F4] text-[#6B7280]" aria-label="Kapat"><X size={18} /></button>
          </div>
        )}
        <div className="rt-noscroll overflow-y-auto px-6 pb-2">{children}</div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-[#FF8A5B]' : 'bg-[#E5E7EB]'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function ScreenHeader({ title, sub, right }) {
  return (
    <div className="flex items-end justify-between gap-3 px-5 pb-4 pt-[max(20px,calc(env(safe-area-inset-top)+12px))]">
      <div className="min-w-0">
        <h2 className="text-[26px] font-extrabold tracking-tight text-[#1E2022]">{title}</h2>
        {sub && <p className="mt-0.5 truncate text-[14px] text-[#6B7280]">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* =========================================================================
   ARAÇ EKLEME MODALI
   ========================================================================= */
function AddVehicleSheet({ onClose, onSave }) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(2022);
  const [fuelType, setFuelType] = useState('Benzin');
  const [cons, setCons] = useState(String(FUELS.Benzin.cons).replace('.', ','));
  const [price, setPrice] = useState(String(FUELS.Benzin.price.toFixed(2)).replace('.', ','));
  const [consTouched, setConsTouched] = useState(false);
  const [priceTouched, setPriceTouched] = useState(false);
  const [err, setErr] = useState('');
  const unit = FUELS[fuelType].unit;

  const pickFuel = (f) => {
    setFuelType(f);
    if (!consTouched) setCons(String(FUELS[f].cons).replace('.', ','));
    if (!priceTouched) setPrice(FUELS[f].price.toFixed(2).replace('.', ','));
  };
  const num = (s) => parseFloat(String(s).replace(',', '.'));

  const save = () => {
    const c = num(cons);
    const p = num(price);
    if (!brand.trim() || !model.trim()) return setErr('Marka ve model alanlarını doldurun.');
    if (!(c > 0 && c < 60)) return setErr(`Ortalama tüketimi ${unit}/100 km olarak girin.`);
    if (!(p > 0 && p < 500)) return setErr(`Güncel fiyatı ₺/${unit} olarak girin.`);
    onSave({ id: newId(), brand: brand.trim(), model: model.trim(), year: Number(year), fuelType, consumption: c, price: p });
    return undefined;
  };

  const inputCls = 'h-[50px] w-full rounded-2xl border border-[#ECEEF2] bg-[#FAFAFA] px-4 text-[16px] text-[#1E2022] outline-none transition focus:border-[#FFD8C7] focus:bg-white focus:ring-4 focus:ring-[#FFF1EB]';
  const lbl = 'mb-1.5 block text-[13px] font-semibold text-[#6B7280]';

  return (
    <Sheet onClose={onClose} title="Araç Ekle" tall>
      <p className="-mt-1 mb-4 text-[14px] text-[#6B7280]">Tüketim ve fiyat bilgisiyle tüm rotalar size özel hesaplanır.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl} htmlFor="rt-brand">Marka</label>
          <input id="rt-brand" list="rt-brands" className={inputCls} placeholder="Volkswagen" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <datalist id="rt-brands">{BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
        </div>
        <div>
          <label className={lbl} htmlFor="rt-model">Model</label>
          <input id="rt-model" className={inputCls} placeholder="Golf 1.5 TSI" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <label className={lbl} htmlFor="rt-year">Yıl</label>
        <div className="relative">
          <select id="rt-year" className={`${inputCls} appearance-none`} value={year} onChange={(e) => setYear(e.target.value)}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280]" />
        </div>
      </div>
      <div className="mt-4">
        <span className={lbl}>Yakıt Tipi</span>
        <div className="flex flex-wrap gap-2">
          {Object.keys(FUELS).map((f) => {
            const I = FUELS[f].icon;
            const on = f === fuelType;
            return (
              <button key={f} type="button" onClick={() => pickFuel(f)}
                className={`flex h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold transition ${on ? 'border-[#FF8A5B] bg-[#FFF1EB] text-[#E87344]' : 'border-[#ECEEF2] bg-white text-[#6B7280]'}`}>
                <I size={15} />{f}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className={lbl} htmlFor="rt-cons">Ort. Tüketim</label>
          <div className="relative">
            <input id="rt-cons" inputMode="decimal" className={`${inputCls} rt-num pr-[86px]`} value={cons} onChange={(e) => { setCons(e.target.value); setConsTouched(true); }} />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-[#9CA3AF]">{unit}/100km</span>
          </div>
        </div>
        <div>
          <label className={lbl} htmlFor="rt-price">Güncel Fiyat</label>
          <div className="relative">
            <input id="rt-price" inputMode="decimal" className={`${inputCls} rt-num pr-[64px]`} value={price} onChange={(e) => { setPrice(e.target.value); setPriceTouched(true); }} />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-[#9CA3AF]">₺/{unit}</span>
          </div>
        </div>
      </div>
      {err && <p className="rt-fade mt-3 flex items-center gap-2 rounded-xl bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#EF4444]"><AlertTriangle size={15} />{err}</p>}
      <button type="button" onClick={save}
        className="mb-2 mt-5 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A5B] text-[16px] font-bold text-white shadow-[0_8px_24px_rgba(255,138,91,0.35)] transition hover:bg-[#E87344] active:scale-[.99]">
        <Check size={19} /> Aracı Kaydet ve Aktif Et
      </button>
    </Sheet>
  );
}

/* =========================================================================
   ROTA DÜZENLEYİCİ — başlangıç / varış arama, konumum, Ev/İş
   ========================================================================= */
function PlaceRow({ icon: I, title, sub, meta, onClick, right, tone = 'orange' }) {
  return (
    <div className="flex items-center gap-3 border-b border-[#ECEEF2] py-2.5 last:border-0">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone === 'orange' ? 'bg-[#FFF1EB] text-[#FF8A5B]' : tone === 'blue' ? 'bg-[#EFF6FF] text-[#3B82F6]' : 'bg-[#F8F6F4] text-[#6B7280]'}`}><I size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-[#1E2022]">{title}</span>
          {sub && <span className="block truncate text-[12.5px] text-[#6B7280]">{sub}</span>}
        </span>
        {meta && <span className="rt-num shrink-0 text-[12.5px] font-medium text-[#9CA3AF]">{meta}</span>}
      </button>
      {right}
    </div>
  );
}

function RouteEditor({ origin, destination, stop, home, work, initialField, onClose, onSetOrigin, onSetDest, onSwap, onClearStop, onSaveSlot, onAsk, onToast }) {
  const [field, setField] = useState(initialField || 'dest');
  const [slot, setSlot] = useState(null); // 'home' | 'work' : sıradaki seçim bu adrese kaydedilir
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ok | offline
  const [locating, setLocating] = useState(false);
  const inputRef = useRef(null);
  const reqId = useRef(0);

  useEffect(() => { setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 250); }, [field, slot]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setStatus('idle'); return undefined; }
    const id = ++reqId.current;
    setStatus('loading');
    const tm = setTimeout(async () => {
      const r = await geocode(q, origin ? origin.coord : null);
      if (id !== reqId.current) return;
      setResults(r.items);
      setStatus(r.offline ? 'offline' : 'ok');
    }, 380);
    return () => clearTimeout(tm);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (place) => {
    if (slot) {
      onSaveSlot(slot, { ...place, demo: false });
      onToast(`${slot === 'home' ? 'Ev' : 'İş'} adresi kaydedildi: ${place.name}`, 'ok');
      setSlot(null);
      setQuery('');
      return;
    }
    if (field === 'origin') {
      if (destination && distM(place.coord, destination.coord) < 30) { onToast('Başlangıç ve varış aynı olamaz', 'warn'); return; }
      onSetOrigin(place);
      onToast(`Başlangıç: ${place.name}`, 'ok');
      onClose();
    } else {
      if (origin && distM(place.coord, origin.coord) < 30) { onToast('Başlangıç ve varış aynı olamaz', 'warn'); return; }
      onSetDest(place);
      onToast(`Hedef: ${place.name}`, 'ok');
      onClose();
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { onToast('Konum servisi bu cihazda kullanılamıyor', 'warn'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const coord = [p.coords.longitude, p.coords.latitude];
        const rev = await reverseGeocode(coord);
        setLocating(false);
        choose({ name: 'Konumunuz', sub: [rev.name, rev.sub].filter(Boolean).join(', '), coord, current: true });
      },
      () => { setLocating(false); onToast('Konum izni verilmedi. Tarayıcı ayarlarından izin verebilirsiniz.', 'warn'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const kmFrom = (c) => (origin ? `${fmt1(distM(origin.coord, c) / 1000)} km` : '');
  const fieldBox = (k, label, value, dot) => {
    const on = field === k && !slot;
    return (
      <button type="button" onClick={() => { setField(k); setSlot(null); setQuery(''); }}
        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${on ? 'bg-white ring-2 ring-[#FFD8C7]' : 'bg-[#FAFAFA] ring-1 ring-[#ECEEF2]'}`}>
        {dot}
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-semibold text-[#9CA3AF]">{label}</span>
          <span className="block truncate text-[15px] font-semibold text-[#1E2022]">{value ? value.name : 'Seçin'}</span>
        </span>
        {on && <Pencil size={14} className="shrink-0 text-[#E87344]" />}
      </button>
    );
  };

  return (
    <Sheet onClose={onClose} title="Rota Düzenle" tall>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          {fieldBox('origin', 'Başlangıç', origin, <span className="ml-1 h-3.5 w-3.5 shrink-0 rounded-full border-[3.5px] border-[#1E2022]" />)}
          {fieldBox('dest', 'Varış', destination, <MapPin size={17} className="shrink-0 text-[#FF8A5B]" fill="#FFF1EB" />)}
        </div>
        <button type="button" onClick={() => { onSwap(); onToast('Başlangıç ve varış yer değiştirdi', 'ok'); }} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFF1EB] text-[#E87344]" aria-label="Başlangıç ve varışı değiştir">
          <ArrowLeftRight size={18} className="rotate-90" />
        </button>
      </div>

      {stop && (
        <div className="mt-2 flex items-center gap-2 rounded-2xl bg-[#FFF1EB] px-3 py-2">
          <Flag size={15} className="shrink-0 text-[#FF8A5B]" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1E2022]">Durak: {stop.name}</p>
          <button type="button" onClick={onClearStop} className="grid h-7 w-7 place-items-center rounded-full text-[#6B7280] hover:bg-white" aria-label="Durağı kaldır"><X size={15} /></button>
        </div>
      )}

      <div className="mt-3">
        {slot && (
          <p className="mb-2 flex items-center justify-between rounded-xl bg-[#EFF6FF] px-3 py-2 text-[13px] font-medium text-[#1D4ED8]">
            <span>{slot === 'home' ? 'Ev' : 'İş'} adresini arayıp seçin</span>
            <button type="button" onClick={() => setSlot(null)} className="font-bold">Vazgeç</button>
          </p>
        )}
        <label className="flex h-[50px] items-center gap-2.5 rounded-2xl border border-[#ECEEF2] bg-[#FAFAFA] px-4 focus-within:border-[#FFD8C7] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#FFF1EB]">
          <Search size={18} className="shrink-0 text-[#6B7280]" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={slot ? `${slot === 'home' ? 'Ev' : 'İş'} adresi ara...` : field === 'origin' ? 'Başlangıç noktası ara...' : 'Nereye gidiyorsunuz?'}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-[#1E2022] outline-none placeholder:text-[#9CA3AF]" enterKeyHint="search" />
          {status === 'loading' && <Loader2 size={17} className="shrink-0 animate-spin text-[#FF8A5B]" />}
          {query && <button type="button" onClick={() => setQuery('')} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#9CA3AF]" aria-label="Temizle"><X size={15} /></button>}
        </label>
      </div>

      <div className="mt-2 pb-2">
        {query.trim().length >= 2 ? (
          <>
            {!slot && (
              <PlaceRow icon={Sparkles} title={`Routier'e sor: "${query.trim()}"`} sub="Yapay zekâ asistanına yönlendir" onClick={() => onAsk(query.trim())} />
            )}
            {results.map((p, i) => (
              <PlaceRow key={`${p.name}-${i}`} icon={MapPin} title={p.name} sub={p.sub} meta={kmFrom(p.coord)} onClick={() => choose(p)} />
            ))}
            {status !== 'loading' && !results.length && <p className="py-6 text-center text-[14px] text-[#9CA3AF]">Sonuç bulunamadı. Farklı bir adres deneyin.</p>}
            {status === 'offline' && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#9CA3AF]"><CloudOff size={13} />Arama servisine ulaşılamadı, kayıtlı yerler gösteriliyor.</p>}
          </>
        ) : (
          <>
            {!slot && (
              <PlaceRow icon={locating ? Loader2 : LocateFixed} tone="blue" title="Mevcut konumum" sub={locating ? 'Konum alınıyor…' : 'GPS ile bulunduğunuz yer'} onClick={useMyLocation} />
            )}
            {[['home', 'Ev', Home, home], ['work', 'İş', Briefcase, work]].map(([k, l, I, p]) => (
              <PlaceRow key={k} icon={I} title={l} sub={p ? p.sub || p.name : 'Henüz kaydedilmedi'} meta={p && !slot ? kmFrom(p.coord) : ''}
                onClick={() => (p && !slot ? choose({ ...p, name: p.demo ? p.name : (k === 'home' ? 'Ev' : 'İş') }) : setSlot(k))}
                right={<button type="button" onClick={() => { setSlot(k); setQuery(''); }} className="h-8 shrink-0 rounded-full border border-[#FFD8C7] px-3 text-[12.5px] font-bold text-[#E87344]">{p && !p.demo ? 'Değiştir' : 'Kaydet'}</button>} />
            ))}
            {!slot && (
              <>
                <p className="mt-3 text-[12.5px] font-bold text-[#9CA3AF]">Popüler yerler</p>
                {PRESET_PLACES.map((p) => <PlaceRow key={p.name} icon={MapPin} tone="gray" title={p.name} sub={p.sub} meta={kmFrom(p.coord)} onClick={() => choose(p)} />)}
              </>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#9CA3AF]"><Info size={13} className="mt-0.5 shrink-0" />İpucu: Haritada bir noktaya basılı tutarak da hedef, başlangıç veya durak seçebilirsiniz.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* Durak seçim penceresi */
function StopSheet({ kind, state, stop, onPick, onClose, onRetry }) {
  const K = POI_KINDS[kind];
  const I = K.icon;
  return (
    <Sheet onClose={onClose} title={K.title}>
      <p className="-mt-1 mb-3 text-[13.5px] text-[#6B7280]">Rotanıza en az ek mesafe katan duraklar üstte. Seçtiğiniz durak rotaya eklenir ve rota yeniden hesaplanır.</p>
      {kind === 'fuel' && <p className="mb-3 flex items-start gap-1.5 rounded-xl bg-[#FFFBEB] px-3 py-2 text-[12px] leading-relaxed text-[#92400E]"><Info size={13} className="mt-0.5 shrink-0" />Pompa fiyatları için bir fiyat servisi henüz bağlı değil. İstasyonlar şimdilik en kısa sapmaya göre sıralanıyor.</p>}
      {state.status === 'loading' && (
        <div className="flex flex-col items-center py-10 text-[14px] text-[#6B7280]"><Loader2 size={26} className="mb-3 animate-spin text-[#FF8A5B]" />Rota boyunca aranıyor…</div>
      )}
      {state.status !== 'loading' && !state.items.length && (
        <div className="flex flex-col items-center py-8 text-center text-[14px] text-[#6B7280]">
          Rotanın yakınında {K.label.toLocaleLowerCase('tr-TR')} bulunamadı.
          <button type="button" onClick={onRetry} className="mt-3 h-9 rounded-full border border-[#FFD8C7] px-4 text-[13px] font-bold text-[#E87344]">Tekrar dene</button>
        </div>
      )}
      <div className="space-y-2 pb-2">
        {state.items.map((p, i) => {
          const added = stop && sameCoord(stop.coord, p.coord);
          return (
            <div key={`${p.name}-${i}`} className={`flex items-center gap-3 rounded-2xl p-3 ring-1 ${i === 0 ? 'bg-[#FFF1EB] ring-[#FFD8C7]' : 'bg-[#FAFAFA] ring-[#ECEEF2]'}`}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[#FF8A5B]"><I size={19} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-bold text-[#1E2022]">{p.name}</p>
                <p className="rt-num truncate text-[12.5px] text-[#6B7280]">
                  <span className="font-semibold text-[#10B981]">+{fmt1(p.addKm)} km</span> • +{Math.max(1, Math.round(p.addMin))} dk
                  {p.fromStartKm != null && ` • ${fmt1(p.fromStartKm)} km sonra`}
                </p>
                {p.sub && <p className="truncate text-[12px] text-[#9CA3AF]">{p.sub}</p>}
              </div>
              <button type="button" onClick={() => onPick(p)} disabled={added}
                className={`h-9 shrink-0 rounded-full px-3.5 text-[12.5px] font-bold ${added ? 'bg-[#ECFDF5] text-[#10B981]' : 'bg-[#FF8A5B] text-white'}`}>
                {added ? 'Eklendi' : 'Rotaya Ekle'}
              </button>
            </div>
          );
        })}
      </div>
      {state.offline && <p className="mb-2 flex items-center gap-1.5 text-[12px] text-[#9CA3AF]"><CloudOff size={13} />Durak servisine ulaşılamadı, örnek duraklar gösteriliyor.</p>}
    </Sheet>
  );
}

/* =========================================================================
   SEKMELER
   ========================================================================= */

/* ---------- Rotalar ---------- */
function RoutesScreen({ origin, destination, routes, selected, setSelected, vehicle, onShowMap, onStart, onSwap, onEdit, onClearStop, onAddVehicle, stop, routeState }) {
  const fast = routes.find((r) => r.id === 'fast');
  const fastTrip = calcTrip(fast, vehicle);
  return (
    <div className="rt-noscroll h-full overflow-y-auto bg-[#F8F6F4] pb-32">
      <ScreenHeader title="Rota Planla" sub={routeState === 'loading' ? 'Rotalar hesaplanıyor…' : `${routes.length} rota, aracınıza göre fiyatlandı`} />
      <div className="mx-5 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
        <div className="flex items-stretch gap-3">
          <div className="flex flex-col items-center py-2">
            <span className="h-3 w-3 rounded-full border-[3px] border-[#1E2022]" />
            <span className="my-1 w-px flex-1 border-l-2 border-dashed border-[#ECEEF2]" />
            <MapPin size={16} className="text-[#FF8A5B]" fill="#FFF1EB" />
          </div>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => onEdit('origin')} className="block w-full border-b border-[#ECEEF2] pb-3 text-left">
              <p className="flex items-center justify-between text-[12px] font-medium text-[#9CA3AF]">Başlangıç <Pencil size={12} className="text-[#E87344]" /></p>
              <p className="truncate text-[15px] font-semibold text-[#1E2022]">{origin.name}{origin.sub ? <span className="font-normal text-[#6B7280]"> • {origin.sub}</span> : null}</p>
            </button>
            <button type="button" onClick={() => onEdit('dest')} className="block w-full pt-3 text-left">
              <p className="flex items-center justify-between text-[12px] font-medium text-[#9CA3AF]">Varış <Pencil size={12} className="text-[#E87344]" /></p>
              <p className="truncate text-[15px] font-semibold text-[#1E2022]">{destination.name}{destination.sub ? <span className="font-normal text-[#6B7280]"> • {destination.sub}</span> : null}</p>
            </button>
          </div>
          <button type="button" onClick={onSwap} className="grid h-10 w-10 shrink-0 self-center place-items-center rounded-full bg-[#FFF1EB] text-[#E87344]" aria-label="Başlangıç ve varışı değiştir"><ArrowLeftRight size={17} className="rotate-90" /></button>
        </div>
        {stop && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#FFF1EB] px-3 py-2 text-[13px] font-medium text-[#E87344]">
            <Flag size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Ara durak: {stop.name}{stop.addKm != null ? ` (+${fmt1(stop.addKm)} km)` : ''}</span>
            <button type="button" onClick={onClearStop} className="grid h-6 w-6 place-items-center rounded-full hover:bg-white" aria-label="Durağı kaldır"><X size={14} /></button>
          </div>
        )}
        {routeState === 'offline' && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[#9CA3AF]"><CloudOff size={13} />Rota servisine ulaşılamadı, tahmini rota gösteriliyor.</p>}
      </div>

      <div className="mx-5 mt-4 flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-[#ECEEF2]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#FFF1EB] text-[#FF8A5B]"><Car size={18} /></span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-[#1E2022]">{vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Araç seçilmedi'}</p>
            <p className="rt-num truncate text-[12px] text-[#6B7280]">{vehicle ? `${fmt1(vehicle.consumption)} ${FUELS[vehicle.fuelType].unit}/100km • ${fmt(vehicle.price)} ₺/${FUELS[vehicle.fuelType].unit}` : 'Maliyetleri görmek için araç ekleyin'}</p>
          </div>
        </div>
        {!vehicle && <button type="button" onClick={onAddVehicle} className="h-9 rounded-full bg-[#FF8A5B] px-4 text-[13px] font-bold text-white">Ekle</button>}
      </div>

      <div className="mt-4 space-y-3 px-5">
        {routes.map((r) => {
          const on = r.id === selected;
          const trip = calcTrip(r, vehicle);
          const diff = trip && fastTrip ? trip.cost - fastTrip.cost : 0;
          const I = r.icon;
          return (
            <button key={r.id} type="button" onClick={() => setSelected(r.id)}
              className={`w-full rounded-3xl border-2 bg-white p-4 text-left transition ${on ? 'border-[#FF8A5B] shadow-[0_8px_30px_rgba(255,138,91,0.16)]' : 'border-transparent shadow-[0_8px_30px_rgba(0,0,0,0.04)]'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${r.id === 'eco' ? 'bg-[#ECFDF5] text-[#10B981]' : 'bg-[#FFF1EB] text-[#FF8A5B]'}`}><I size={20} /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[16px] font-bold text-[#1E2022]">{r.title}</p>
                      {r.id === 'eco' && <span className="rounded-full bg-[#FFF1EB] px-2 py-0.5 text-[11px] font-bold text-[#E87344]">Önerilen</span>}
                      {r.sameAsFast && <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-bold text-[#10B981]">En hızlısı da bu</span>}
                    </div>
                    <p className="truncate text-[13px] text-[#6B7280]">{r.tag} • {r.via}</p>
                  </div>
                </div>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-[#FF8A5B] bg-[#FF8A5B]' : 'border-[#E5E7EB]'}`}>{on && <Check size={14} className="text-white" strokeWidth={3} />}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rt-num text-[22px] font-extrabold text-[#1E2022]">{r.min} dk</span>
                <span className="rt-num text-[15px] font-medium text-[#6B7280]">• {fmt1(r.km)} km</span>
                {r.id === 'eco' && <span className="ml-auto flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[12px] font-bold text-[#10B981]"><Leaf size={13} />En Az Yakıt</span>}
                {r.id === 'fast' && <span className="ml-auto flex items-center gap-1 rounded-full bg-[#FFF1EB] px-2.5 py-1 text-[12px] font-bold text-[#E87344]"><Timer size={13} />En Kısa Süre</span>}
                {r.id === 'scenic' && <span className="ml-auto flex items-center gap-1 rounded-full bg-[#F8F6F4] px-2.5 py-1 text-[12px] font-bold text-[#6B7280]"><Mountain size={13} />Manzaralı</span>}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-[#FAFAFA] p-3">
                <div>
                  <p className="text-[11px] font-medium text-[#9CA3AF]">{vehicle?.fuelType === 'Elektrik' ? 'Enerji' : 'Yakıt'}</p>
                  <p className="rt-num text-[14px] font-bold text-[#1E2022]">{trip ? `${fmt(trip.amount)} ${trip.unit}` : '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#9CA3AF]">Maliyet</p>
                  <p className="rt-num text-[14px] font-bold text-[#1E2022]">{trip ? tl(trip.cost) : '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#9CA3AF]">Fark</p>
                  <p className={`rt-num text-[14px] font-bold ${!trip ? 'text-[#9CA3AF]' : diff < -0.005 ? 'text-[#10B981]' : diff > 0.005 ? 'text-[#F59E0B]' : 'text-[#6B7280]'}`}>
                    {!trip ? '—' : Math.abs(diff) < 0.005 ? 'Referans' : `${diff < 0 ? '−' : '+'}${tl(Math.abs(diff))}`}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mx-6 mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-[#6B7280]">
        <Info size={14} className="mt-0.5 shrink-0" />
        Maliyet = (Mesafe / 100) × Tüketim × Birim fiyat. Her rotaya trafik ve eğim verim katsayısı uygulanır; fiyatlar Garajım'dan düzenlenebilir.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 px-5">
        <button type="button" onClick={onShowMap} className="flex h-[52px] items-center justify-center gap-2 rounded-2xl border border-[#FFD8C7] bg-white text-[15px] font-bold text-[#E87344]"><MapPin size={18} />Haritada Gör</button>
        <button type="button" onClick={onStart} className="flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#FF8A5B] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(255,138,91,0.3)] hover:bg-[#E87344]"><Navigation size={18} />Başlat</button>
      </div>
    </div>
  );
}

/* ---------- AI Asistan ---------- */
function Waveform({ active }) {
  const bars = [0.4, 0.7, 1, 0.55, 0.85, 0.35, 0.9, 0.6, 1, 0.45, 0.75, 0.5, 0.95, 0.4, 0.7, 0.55, 0.8, 0.35];
  return (
    <div className="flex h-12 items-center justify-center gap-[5px]" aria-hidden="true">
      {bars.map((h, i) => (
        <span key={i} className="w-[4px] rounded-full bg-[#FF8A5B]"
          style={{ height: `${h * 44}px`, opacity: 0.35 + h * 0.6, transformOrigin: 'center', animation: `rt-wave ${active ? 0.7 : 1.6}s ease-in-out ${i * 0.07}s infinite` }} />
      ))}
    </div>
  );
}

function StationCard({ added, onAdd }) {
  return (
    <div className="mt-3 rounded-2xl border border-[#FFD8C7] bg-white p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FFF1EB] text-[#FF8A5B]"><Fuel size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-[#1E2022]">Opet - Atatürk Bulvarı</p>
          <p className="rt-num text-[12.5px] text-[#6B7280]"><span className="font-bold text-[#10B981]">43,80 ₺/L</span> • +2 dk sapma</p>
        </div>
      </div>
      <button type="button" onClick={onAdd} disabled={added}
        className={`mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold transition ${added ? 'bg-[#ECFDF5] text-[#10B981]' : 'bg-[#FF8A5B] text-white hover:bg-[#E87344]'}`}>
        {added ? <><Check size={16} />Rotaya Eklendi</> : <><Plus size={16} />Rotaya Ekle</>}
      </button>
    </div>
  );
}

function AIScreen({ messages, onSend, typing, stop, onAddStation, onApplyEco, listening, setListening }) {
  const [text, setText] = useState('');
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typing]);
  const chips = ['Yol üstündeki en ucuz benzinliği rotaya ekle', 'Klima açıkken yakıt tüketimim ne kadar artar?', 'Trafiğe takılmadan en az yakan rotayı çiz'];
  const send = (t) => {
    const v = (t ?? text).trim();
    if (!v) return;
    onSend(v);
    setText('');
  };
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="shrink-0 border-b border-[#ECEEF2] bg-gradient-to-b from-[#FFF1EB] to-white px-5 pb-4 pt-[max(20px,calc(env(safe-area-inset-top)+12px))]">
        <div className="flex items-center gap-3">
          <span className="rt-glow grid h-11 w-11 place-items-center rounded-2xl bg-[#FF8A5B] text-white"><Sparkles size={21} /></span>
          <div>
            <h2 className="text-[20px] font-extrabold text-[#1E2022]">Routier AI</h2>
            <p className="flex items-center gap-1.5 text-[12.5px] text-[#10B981]"><span className="h-2 w-2 rounded-full bg-[#10B981]" />Yol asistanınız hazır</p>
          </div>
        </div>
        <div className="mt-3"><Waveform active={listening || typing} /></div>
      </div>

      <div className="rt-noscroll flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-3">
          {messages.map((m) => (m.role === 'user' ? (
            <div key={m.id} className="rt-up flex justify-end">
              <p className="max-w-[82%] rounded-3xl rounded-br-lg bg-[#1E2022] px-4 py-3 text-[14.5px] leading-relaxed text-white">{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="rt-up flex items-end gap-2">
              <span className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#FFF1EB] text-[#FF8A5B]"><Sparkles size={14} /></span>
              <div className="max-w-[86%] rounded-3xl rounded-bl-lg border border-[#FFD8C7] bg-[#FFF1EB] px-4 py-3 text-[14.5px] leading-relaxed text-[#1E2022]">
                <p className="whitespace-pre-line">{m.text}</p>
                {m.station && <StationCard added={!!stop && stop.kind === 'fuel'} onAdd={onAddStation} />}
                {m.eco && (
                  <button type="button" onClick={onApplyEco} className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF8A5B] text-[14px] font-bold text-white hover:bg-[#E87344]">
                    <Route size={16} />Eco Rotayı Haritada Çiz
                  </button>
                )}
              </div>
            </div>
          )))}
          {typing && (
            <div className="flex items-end gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FFF1EB] text-[#FF8A5B]"><Sparkles size={14} /></span>
              <div className="flex gap-1 rounded-3xl rounded-bl-lg bg-[#FFF1EB] px-4 py-4">
                {[0, 1, 2].map((i) => <span key={i} className="rt-dot h-2 w-2 rounded-full bg-[#FF8A5B]" style={{ animationDelay: `${i * 0.18}s` }} />)}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-[#ECEEF2] bg-white pb-[104px] pt-3">
        <div className="rt-noscroll flex gap-2 overflow-x-auto px-5 pb-3">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => send(c)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#FFD8C7] bg-[#FFF1EB] px-3.5 text-[13px] font-semibold text-[#E87344]">
              <Sparkles size={13} />{c}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="mx-5 flex h-[52px] items-center gap-2 rounded-full border border-[#ECEEF2] bg-[#FAFAFA] pl-5 pr-1.5">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Routier'e bir şey sor..." className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#9CA3AF]" />
          <button type="button" onClick={() => setListening(!listening)} className={`grid h-10 w-10 place-items-center rounded-full ${listening ? 'bg-[#FFF1EB] text-[#FF8A5B]' : 'text-[#6B7280]'}`} aria-label="Sesli komut"><Mic size={19} /></button>
          <button type="submit" className="grid h-10 w-10 place-items-center rounded-full bg-[#FF8A5B] text-white" aria-label="Gönder"><Send size={17} /></button>
        </form>
      </div>
    </div>
  );
}

/* ---------- Garajım ---------- */
function VehicleCard({ v, active, onActivate, onDelete, onPrice }) {
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState(fmt(v.price));
  const [editing, setEditing] = useState(false);
  const unit = FUELS[v.fuelType].unit;
  const I = FUELS[v.fuelType].icon;
  useEffect(() => { if (!editing) setDraft(fmt(v.price)); }, [v.price, editing]);
  const commit = () => {
    const n = parseFloat(draft.replace(/\./g, '').replace(',', '.'));
    if (n > 0 && n < 500) onPrice(n);
    setEditing(false);
  };
  return (
    <div className={`rt-up rounded-3xl bg-white p-4 transition ${active ? 'ring-2 ring-[#FF8A5B] shadow-[0_8px_30px_rgba(255,138,91,0.14)]' : 'ring-1 ring-[#ECEEF2] shadow-[0_8px_30px_rgba(0,0,0,0.04)]'}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#FFF1EB] text-[#FF8A5B]"><Car size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-[16px] font-bold text-[#1E2022]">{v.brand} {v.model}</p>
            {active && <span className="flex items-center gap-1 rounded-full bg-[#FFF1EB] px-2 py-0.5 text-[11px] font-bold text-[#E87344]"><Check size={11} strokeWidth={3} />Aktif Araç</span>}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-[#6B7280]"><I size={13} />{v.year} • {v.fuelType}</p>
        </div>
        <button type="button" onClick={() => setConfirm(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9CA3AF] transition hover:bg-[#FEF2F2] hover:text-[#EF4444]" aria-label="Aracı sil"><Trash2 size={18} /></button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-[#FAFAFA] p-3">
          <p className="text-[11.5px] font-medium text-[#9CA3AF]">Ort. Tüketim</p>
          <p className="rt-num text-[15px] font-bold text-[#1E2022]">{fmt1(v.consumption)} <span className="text-[12px] font-medium text-[#6B7280]">{unit}/100km</span></p>
        </div>
        <div className={`rounded-2xl p-3 transition ${editing ? 'bg-white ring-2 ring-[#FFD8C7]' : 'bg-[#FAFAFA]'}`}>
          <label className="flex items-center justify-between text-[11.5px] font-medium text-[#9CA3AF]" htmlFor={`p-${v.id}`}>Güncel Fiyat <Pencil size={11} /></label>
          <div className="flex items-center gap-1">
            <input id={`p-${v.id}`} inputMode="decimal" value={draft} onFocus={() => setEditing(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className="rt-num w-full min-w-0 bg-transparent text-[16px] font-bold text-[#1E2022] outline-none" />
            <span className="shrink-0 text-[12px] font-medium text-[#6B7280]">₺/{unit}</span>
          </div>
        </div>
      </div>

      {confirm ? (
        <div className="rt-fade mt-3 rounded-2xl bg-[#FEF2F2] p-3">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-[#EF4444]"><AlertTriangle size={16} />Bu aracı silmek istediğinize emin misiniz?</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirm(false)} className="h-10 rounded-xl bg-white text-[14px] font-semibold text-[#1E2022] ring-1 ring-[#ECEEF2]">İptal</button>
            <button type="button" onClick={onDelete} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#EF4444] text-[14px] font-bold text-white"><Trash2 size={15} />Sil</button>
          </div>
        </div>
      ) : !active && (
        <button type="button" onClick={onActivate} className="mt-3 h-10 w-full rounded-xl border border-[#FFD8C7] text-[14px] font-bold text-[#E87344] transition hover:bg-[#FFF1EB]">Aktif Yap</button>
      )}
    </div>
  );
}

function GarageScreen({ garage, onAdd, onActivate, onDelete, onPrice }) {
  if (!garage.list.length) {
    return (
      <div className="rt-noscroll h-full overflow-y-auto bg-white pb-32">
        <ScreenHeader title="Garajım" sub="Araçlarınız ve tüketim profilleri" />
        <div className="flex flex-col items-center px-6 pt-6 text-center">
          <div className="relative grid h-32 w-32 place-items-center rounded-[40px] bg-[#FFF1EB]">
            <Warehouse size={56} className="text-[#FF8A5B]" strokeWidth={1.6} />
            <span className="absolute -right-1 -top-1 grid h-11 w-11 place-items-center rounded-full bg-[#FF8A5B] text-white ring-4 ring-white"><Plus size={22} strokeWidth={3} /></span>
          </div>
          <h3 className="mt-6 text-[21px] font-extrabold text-[#1E2022]">Henüz bir araç eklemediniz</h3>
          <p className="mt-2 max-w-[300px] text-[14.5px] leading-relaxed text-[#6B7280]">Aracınızı ekleyin; Routier her rotanın yakıt miktarını ve maliyetini sizin için anlık olarak hesaplasın.</p>
          <button type="button" onClick={onAdd} className="mt-6 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A5B] text-[16px] font-bold text-white shadow-[0_8px_24px_rgba(255,138,91,0.35)] hover:bg-[#E87344]">
            <Plus size={20} />İlk Aracını Ekle
          </button>
        </div>
        <div className="mx-5 mt-8 rounded-3xl bg-[#F8F6F4] p-5">
          <p className="text-[15px] font-bold text-[#1E2022]">Neden araç eklemeliyim?</p>
          {[
            [Wallet, 'Her rota için TL cinsinden net yakıt maliyeti'],
            [Leaf, 'Eco-Rota ile aylık tasarrufunuzu takip edin'],
            [Gauge, 'Sürüş sırasında anlık tüketim göstergesi'],
            [Sparkles, 'Routier AI size özel istasyon önerileri sunar'],
          ].map(([I, t]) => (
            <div key={t} className="mt-3 flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-[#FF8A5B]"><I size={16} /></span>
              <p className="text-[14px] text-[#1E2022]">{t}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="rt-noscroll h-full overflow-y-auto bg-[#F8F6F4] pb-32">
      <ScreenHeader title="Garajım" sub={`${garage.list.length} araç kayıtlı`}
        right={<button type="button" onClick={onAdd} className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-[#FF8A5B] px-4 text-[14px] font-bold text-white shadow-[0_6px_18px_rgba(255,138,91,0.3)]"><Plus size={17} />Ekle</button>} />
      <div className="space-y-3 px-5">
        {garage.list.map((v) => (
          <VehicleCard key={v.id} v={v} active={v.id === garage.activeId} onActivate={() => onActivate(v.id)} onDelete={() => onDelete(v.id)} onPrice={(p) => onPrice(v.id, p)} />
        ))}
      </div>
      <p className="mx-6 mt-4 flex items-start gap-2 text-[12px] text-[#6B7280]"><Info size={14} className="mt-0.5 shrink-0" />Fiyatı değiştirdiğinizde tüm rota maliyetleri anında güncellenir.</p>
    </div>
  );
}

/* ---------- Profil ---------- */
function ProfileScreen({ sync, session, vehicle, trips, settings, setSettings, onLogout, onGarage }) {
  const initials = session.name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR');
  const monthSaved = 286.4 + trips.reduce((s, t) => s + (t.saved || 0), 0);
  const monthSpent = 1842.5 + trips.reduce((s, t) => s + (t.cost || 0), 0);
  const max = Math.max(...WEEK.map((w) => w.v));
  const today = (new Date().getDay() + 6) % 7;
  const rows = [
    { k: 'voice', icon: Volume2, label: 'Sesli Yönlendirme' },
    { k: 'notify', icon: Bell, label: 'Fiyat ve Trafik Bildirimleri' },
    { k: 'eco', icon: Leaf, label: 'Eco-Rotayı Varsayılan Yap' },
  ];
  return (
    <div className="rt-noscroll h-full overflow-y-auto bg-[#F8F6F4] pb-32">
      <ScreenHeader title="Profil" />
      <div className="mx-5 flex items-center gap-4 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#FF8A5B] text-[22px] font-extrabold text-white ring-4 ring-[#FFF1EB]">{initials || 'R'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[19px] font-extrabold text-[#1E2022]">{session.name}</p>
          <p className="truncate text-[13px] text-[#6B7280]">{session.email || 'Misafir oturumu'}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold">
            <span className="rounded-full bg-[#F8F6F4] px-2 py-0.5 text-[#6B7280]">{PROVIDER_LABEL[session.provider] || 'E-posta'} ile giriş</span>
            {sync === 'local' || !session.remote ? (
              <span className="flex items-center gap-1 rounded-full bg-[#F8F6F4] px-2 py-0.5 text-[#6B7280]"><CloudOff size={11} />Cihazda</span>
            ) : sync === 'error' ? (
              <span className="flex items-center gap-1 rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[#EF4444]"><CloudOff size={11} />Senkron hatası</span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[#10B981]">{sync === 'syncing' ? <Loader2 size={11} className="animate-spin" /> : <Cloud size={11} />}{sync === 'syncing' ? 'Eşitleniyor' : 'Bulutta'}</span>
            )}
          </div>
          <button type="button" onClick={onGarage} className="mt-1.5 flex max-w-full items-center gap-1.5 truncate rounded-full bg-[#FFF1EB] px-2.5 py-1 text-[12px] font-semibold text-[#E87344]">
            <Car size={13} className="shrink-0" /><span className="truncate">{vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Aktif araç yok — ekle'}</span>
          </button>
        </div>
      </div>

      <div className="mx-5 mt-4 rounded-3xl border border-[#FFD8C7] bg-[#FFF1EB] p-5">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-bold text-[#E87344]">Aylık Tasarruf Özeti</p>
          <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-bold text-[#10B981]"><TrendingDown size={13} />%14</span>
        </div>
        <p className="rt-num mt-2 text-[34px] font-extrabold leading-none text-[#1E2022]">{tl(monthSaved)}</p>
        <p className="mt-1 text-[13px] text-[#6B7280]">Eco-Rota tercihlerinizle bu ay tasarruf ettiniz</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[['Sürüş', `${14 + trips.length}`], ['Mesafe', `${fmt1(412.6 + trips.reduce((s, t) => s + t.km, 0))} km`], ['Harcama', tl(monthSpent)]].map(([l, v]) => (
            <div key={l} className="rounded-2xl bg-white/80 p-2.5">
              <p className="text-[11px] text-[#6B7280]">{l}</p>
              <p className="rt-num truncate text-[13.5px] font-bold text-[#1E2022]">{v}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-5 mt-4 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-bold text-[#1E2022]">Haftalık Yakıt Harcaması</p>
          <p className="rt-num text-[13px] text-[#6B7280]">{tl(WEEK.reduce((s, w) => s + w.v, 0))}</p>
        </div>
        <div className="mt-4 flex h-[140px] items-end gap-2.5">
          {WEEK.map((w, i) => (
            <div key={w.d} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="rt-num text-[10.5px] font-semibold text-[#6B7280]">{w.v}</span>
              <div className={`w-full rounded-xl transition-all ${i === today ? 'bg-[#FF8A5B]' : 'bg-[#FFD8C7]'}`} style={{ height: `${(w.v / max) * 92}px` }} />
              <span className={`text-[11.5px] ${i === today ? 'font-bold text-[#E87344]' : 'text-[#9CA3AF]'}`}>{w.d}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-[#9CA3AF]">Tutarlar ₺ cinsindendir; örnek veridir.</p>
      </div>

      <div className="mx-5 mt-4 overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
        <p className="px-5 pb-1 pt-4 text-[13px] font-bold text-[#9CA3AF]">Ayarlar</p>
        {rows.map(({ k, icon: I, label }) => (
          <div key={k} className="flex items-center gap-3 border-b border-[#ECEEF2] px-5 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FFF1EB] text-[#FF8A5B]"><I size={17} /></span>
            <p className="flex-1 text-[14.5px] font-medium text-[#1E2022]">{label}</p>
            <Toggle on={!!settings[k]} label={label} onChange={(v) => setSettings((s) => ({ ...s, [k]: v }))} />
          </div>
        ))}
        {[[Gauge, 'Birimler', 'km • ₺ • L'], [ShieldCheck, 'Gizlilik ve Konum', 'Yalnızca kullanırken'], [HelpCircle, 'Yardım ve Destek', '']].map(([I, l, v]) => (
          <div key={l} className="flex items-center gap-3 border-b border-[#ECEEF2] px-5 py-3.5 last:border-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#F8F6F4] text-[#6B7280]"><I size={17} /></span>
            <p className="flex-1 text-[14.5px] font-medium text-[#1E2022]">{l}</p>
            {v && <span className="text-[13px] text-[#9CA3AF]">{v}</span>}
            <ChevronRight size={17} className="text-[#D1D5DB]" />
          </div>
        ))}
      </div>

      <button type="button" onClick={onLogout} className="mx-5 mt-5 flex h-[52px] w-[calc(100%-40px)] items-center justify-center gap-2 rounded-2xl bg-[#FEF2F2] text-[15px] font-bold text-[#EF4444] transition hover:bg-[#FDE2E2]">
        <LogOut size={18} />Çıkış Yap
      </button>
      <p className="mt-4 text-center text-[11.5px] text-[#9CA3AF]">Routier v1.0 • Harita verisi © OpenStreetMap katkıcıları</p>
    </div>
  );
}

/* =========================================================================
   ANA UYGULAMA
   ========================================================================= */
export default function App() {
  const [session, setSession] = useState(() => store.get('routier_session', null));
  const [garage, setGarage] = useState(() => {
    const s = store.get('routier_session', null);
    return s ? store.get(garageKey(s.id), { list: [], activeId: null }) : { list: [], activeId: null };
  });
  const [trips, setTrips] = useState(() => {
    const s = store.get('routier_session', null);
    return s ? store.get(tripsKey(s.id), []) : [];
  });
  const [settings, setSettings] = useState(() => store.get('routier_settings', { voice: true, notify: true, eco: true }));
  const [tab, setTab] = useState('map');
  const [origin, setOrigin] = useState(() => store.get('routier_origin', DEMO_ORIGIN));
  const [destination, setDestination] = useState(() => store.get('routier_dest', DEMO_WORK));
  const [selected, setSelected] = useState('eco');
  const [cands, setCands] = useState(DEMO_CANDIDATES);
  const [routeState, setRouteState] = useState('loading'); // loading | ok | offline
  const [editor, setEditor] = useState(null); // 'origin' | 'dest'
  const [poi, setPoi] = useState({ kind: null, status: 'idle', items: [], offline: false });
  const [pick, setPick] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [modal, setModal] = useState(null); // 'add' | 'switch' | 'poi:fuel' | 'summary'
  const [toast, setToast] = useState(null);
  const [stop, setStop] = useState(null);
  const [nav, setNav] = useState(null); // { progress }
  const [summary, setSummary] = useState(null);
  const [listening, setListening] = useState(false);
  const [locateTick, setLocateTick] = useState(0);
  const [follow, setFollow] = useState(true);
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState([]);
  const [sync, setSync] = useState(supabase ? 'idle' : 'local'); // local | idle | syncing | ok | error
  const [newPass, setNewPass] = useState('');
  const loadedFor = useRef((() => { const st = store.get('routier_session', null); return st && !st.remote ? st.id : null; })());

  const home = settings.home || DEMO_HOME;
  const work = settings.work || DEMO_WORK;
  const vehicle = garage.list.find((v) => v.id === garage.activeId) || null;

  /* ---- Font & kalıcılık ---- */
  useEffect(() => {
    try {
      if (!document.getElementById('rt-font')) {
        const l = document.createElement('link');
        l.id = 'rt-font';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
        document.head.appendChild(l);
      }
    } catch (e) { /* yok say */ }
  }, []);
  useEffect(() => { if (session) store.set(garageKey(session.id), garage); }, [garage, session]);
  useEffect(() => { if (session) store.set(tripsKey(session.id), trips); }, [trips, session]);
  useEffect(() => { store.set('routier_settings', settings); }, [settings]);

  const showToast = useCallback((t, kind = 'info') => {
    setToast({ t, kind, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const tm = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(tm);
  }, [toast]);

  /* ---- AI karşılama ---- */
  useEffect(() => {
    if (!session) return;
    const firstName = session.name.split(' ')[0];
    setMessages([{ id: 'hello', role: 'ai', text: `Merhaba ${firstName}! Ben Routier AI. Rotanı, yakıt maliyetini ve yol üstündeki en uygun istasyonları senin için takip ediyorum. Ne yapmamı istersin?` }]);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Başlangıç / varış kalıcılığı ---- */
  useEffect(() => { store.set('routier_origin', origin); }, [origin]);
  useEffect(() => { store.set('routier_dest', destination); }, [destination]);

  /* ---- Rota hesaplama: OSRM alternatifleri + otoyolsuz seçenek, durak varsa duraktan geçer ---- */
  useEffect(() => {
    const pts = stop ? [origin.coord, stop.coord, destination.coord] : [origin.coord, destination.coord];
    let alive = true;
    setRouteState('loading');
    (async () => {
      try {
        const [main, alt] = await Promise.allSettled([osrmCandidates(pts, { alternatives: true }), osrmCandidates(pts, { exclude: 'motorway' })]);
        if (main.status !== 'fulfilled') throw main.reason;
        if (!alive) return;
        setCands([...main.value, ...(alt.status === 'fulfilled' ? alt.value : [])]);
        setRouteState('ok');
      } catch (e) {
        if (!alive) return;
        const demo = !stop && sameCoord(origin.coord, DEMO_ORIGIN.coord) && sameCoord(destination.coord, DEMO_WORK.coord);
        setCands(demo ? DEMO_CANDIDATES : synthCandidates(pts));
        setRouteState('offline');
      }
    })();
    return () => { alive = false; };
  }, [origin, destination, stop]);

  const routes = useMemo(() => classifyRoutes(cands, !!vehicle && vehicle.fuelType === 'Elektrik'), [cands, vehicle && vehicle.fuelType]); // eslint-disable-line react-hooks/exhaustive-deps
  const geoms = useMemo(() => Object.fromEntries(routes.map((r) => [r.id, r.coords])), [routes]);
  useEffect(() => { if (routes.length && !routes.some((r) => r.id === selected)) setSelected('eco'); }, [routes, selected]);
  const route = routes.find((r) => r.id === selected) || routes[0];
  const trip = calcTrip(route, vehicle);
  const fastTrip = calcTrip(routes.find((r) => r.id === 'fast'), vehicle);
  const ecoSaving = trip && fastTrip && selected !== 'fast' ? Math.max(0, fastTrip.cost - trip.cost) : 0;

  /* ---- Oturum ---- */
  const enterSession = useCallback((s) => {
    const prev = store.get('routier_session', null);
    store.set('routier_session', s);
    setSession(s);
    if (loadedFor.current === s.id) return;
    loadedFor.current = s.id;
    setGarage(store.get(garageKey(s.id), { list: [], activeId: null }));
    setTrips(store.get(tripsKey(s.id), []));
    setTab('map');
    setStop(null);
    setSelected(store.get('routier_settings', { eco: true }).eco ? 'eco' : 'fast');
    if (!prev || prev.id !== s.id) setTimeout(() => showToast(`Hoş geldin, ${s.name.split(' ')[0]}!`, 'ok'), 120);
    if (s.remote && supabase) {
      setSync('syncing');
      // onAuthStateChange içinden doğrudan Supabase çağrısı yapılmaz; bir sonraki tura bırakılır
      setTimeout(async () => {
        try {
          const r = await cloud.loadAll(s.id);
          setGarage(r.garage);
          setTrips(r.trips);
          if (r.settings && Object.keys(r.settings).length) setSettings((st) => ({ ...st, ...r.settings }));
          setSync('ok');
        } catch (e) {
          setSync('error');
          showToast('Bulut verisi alınamadı, cihazdaki kopya gösteriliyor', 'warn');
        }
      }, 0);
    }
  }, [showToast]);
  const handleAuth = (s) => enterSession(s);

  const clearLocalSession = useCallback(() => {
    store.del('routier_session');
    loadedFor.current = null;
    setSession(null);
    setGarage({ list: [], activeId: null });
    setTrips([]);
    setNav(null);
    setModal(null);
    setStop(null);
    setTab('map');
  }, []);

  /* ---- Supabase oturum dinleyicisi (e-posta, Google, Apple, misafir) ---- */
  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    try {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const errDesc = url.searchParams.get('error_description') || hash.get('error_description');
      if (errDesc) setTimeout(() => showToast(decodeURIComponent(errDesc.replace(/\+/g, ' ')), 'warn'), 300);
    } catch (e) { /* yok say */ }
    const cleanUrl = () => {
      try {
        if (/[?&](code|error)=|#(access_token|error)/.test(window.location.href)) window.history.replaceState(null, '', redirectUrl());
      } catch (e) { /* yok say */ }
    };
    const apply = (sb) => {
      if (!alive) return;
      if (sb && sb.user) {
        enterSession(sessionFromUser(sb.user));
        cleanUrl();
      } else {
        const cur = store.get('routier_session', null);
        if (cur && cur.remote) clearLocalSession();
      }
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session)).catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((event, sb) => {
      if (event === 'PASSWORD_RECOVERY') { setModal('recovery'); return; }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') apply(sb);
      if (event === 'SIGNED_OUT') apply(null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = () => {
    if (session && session.remote && supabase) supabase.auth.signOut().catch(() => {});
    clearLocalSession();
  };

  /* ---- Bulut senkronu (hata olursa yerel kopya korunur) ---- */
  const cloudSync = useCallback((job) => {
    if (!supabase || !session || !session.remote) return;
    setSync('syncing');
    Promise.resolve()
      .then(job)
      .then(() => setSync('ok'))
      .catch(() => {
        setSync('error');
        showToast('Buluta kaydedilemedi, değişiklik cihazda tutuldu', 'warn');
      });
  }, [session, showToast]);
  const settingsFirst = useRef(true);
  useEffect(() => {
    if (settingsFirst.current) { settingsFirst.current = false; return undefined; }
    if (!supabase || !session || !session.remote) return undefined;
    const tm = setTimeout(() => cloudSync(() => cloud.saveSettings(session.id, settings)), 600);
    return () => clearTimeout(tm);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Garaj işlemleri ---- */
  const addVehicle = (v) => {
    setGarage((g) => ({ list: [...g.list, v], activeId: v.id }));
    cloudSync(async () => { await cloud.addVehicle(session.id, v); await cloud.setActive(session.id, v.id); });
    setModal(null);
    showToast(`${v.model} aktif araç olarak ayarlandı`, 'ok');
  };
  const activate = (id) => {
    setGarage((g) => ({ ...g, activeId: id }));
    cloudSync(() => cloud.setActive(session.id, id));
    const v = garage.list.find((x) => x.id === id);
    if (v) showToast(`Aktif araç: ${v.model}`, 'ok');
  };
  const removeVehicle = (id) => {
    const rest = garage.list.filter((v) => v.id !== id);
    const nextActive = garage.activeId === id ? (rest[0] ? rest[0].id : null) : garage.activeId;
    cloudSync(async () => { await cloud.deleteVehicle(id); await cloud.setActive(session.id, nextActive); });
    setGarage((g) => {
      const list = g.list.filter((v) => v.id !== id);
      const activeId = g.activeId === id ? (list[0]?.id ?? null) : g.activeId;
      return { list, activeId };
    });
    showToast('Araç garajdan silindi', 'warn');
  };
  const setPrice = (id, p) => {
    setGarage((g) => ({ ...g, list: g.list.map((v) => (v.id === id ? { ...v, price: p } : v)) }));
    cloudSync(() => cloud.updatePrice(id, p));
    showToast('Fiyat güncellendi, maliyetler yeniden hesaplandı', 'ok');
  };

  /* ---- Navigasyon simülasyonu ---- */
  useEffect(() => {
    if (!nav) return undefined;
    const iv = setInterval(() => {
      setNav((n) => {
        if (!n) return n;
        const p = Math.min(1, n.progress + 1 / 1200);
        return { ...n, progress: p };
      });
    }, 100);
    return () => clearInterval(iv);
  }, [!!nav]); // eslint-disable-line react-hooks/exhaustive-deps

  const navRef = useRef(null);
  useEffect(() => { navRef.current = nav; }, [nav]);
  const finishDrive = useCallback((completed) => {
    const n = navRef.current;
    if (!n) return;
    navRef.current = null;
    const done = completed ? 1 : n.progress;
    const km = route.km * done;
    const t = calcTrip({ ...route, km }, vehicle);
    const ft = calcTrip({ ...routes.find((r) => r.id === 'fast'), km }, vehicle);
    const rec = { id: Date.now(), dest: destination.name, km, min: Math.round(route.min * done), cost: t ? t.cost : 0, amount: t ? t.amount : 0, unit: t ? t.unit : 'L', saved: t && ft && selected !== 'fast' ? Math.max(0, ft.cost - t.cost) : 0, completed };
    setNav(null);
    setSummary(rec);
    if (km > 0.05) {
      setTrips((ts) => [rec, ...ts].slice(0, 50));
      cloudSync(() => cloud.addTrip(session.id, { ...rec, vehicleId: vehicle ? vehicle.id : null, routeType: selected }));
    }
    setModal('summary');
  }, [route, routes, vehicle, destination, selected, cloudSync, session]);

  useEffect(() => { if (nav && nav.progress >= 1) finishDrive(true); }, [nav, finishDrive]);

  const startNav = () => {
    setTab('map');
    setModal(null);
    setSheetOpen(true);
    setFollow(true);
    setNav({ progress: 0 });
    if (settings.voice) showToast(`${route.title} başlatıldı • ${route.min} dk`, 'ok');
  };

  const navInfo = useMemo(() => {
    if (!nav || !route) return null;
    const p = nav.progress;
    const steps = route.steps && route.steps.length ? route.steps : [{ at: 1, icon: Flag, text: 'Hedefinize varıyorsunuz', arrive: true }];
    const nextIdx = steps.findIndex((st) => st.at > p + 1e-6);
    const next = nextIdx >= 0 ? steps[nextIdx] : null;
    const toNext = next ? (next.at - p) * route.km : (1 - p) * route.km;
    let step = next || { icon: Flag, text: 'Hedefinize varıyorsunuz', arrive: true };
    if (step.stopArrive) step = { ...step, text: stop ? `Durak: ${stop.name}` : step.text };
    if (step.arrive) step = { ...step, text: `${destination.name} — hedefinize varıyorsunuz` };
    const cur = nextIdx > 0 ? steps[nextIdx - 1] : nextIdx === -1 ? steps[steps.length - 1] : steps[0];
    const stepSpeed = cur && cur.dur > 5 && cur.dist > 30 ? (cur.dist / cur.dur) * 3.6 : route.avgSpeed || 45;
    const base = clamp(stepSpeed, 15, 125);
    const speed = Math.max(0, Math.round(base * (0.94 + Math.sin(p * 90) * 0.05)));
    const ev = !!vehicle && vehicle.fuelType === 'Elektrik';
    const inst = vehicle ? vehicle.consumption * speedFactor(speed, ev) * (1 + Math.sin(p * 55) * 0.04) : null;
    const used = vehicle ? ((route.km * p) / 100) * vehicle.consumption * route.factor : null;
    const limit = base > 105 ? 120 : base > 85 ? 110 : base > 62 ? 90 : base > 45 ? 70 : 50;
    return { step, toNext, speed, inst, used, remainKm: route.km * (1 - p), remainMin: Math.max(0, Math.ceil(route.min * (1 - p))), limit };
  }, [nav, route, vehicle, stop, destination]);

  /* ---- AI cevapları ---- */
  const aiReply = useCallback((q) => {
    const t = q.toLocaleLowerCase('tr-TR');
    if (/benzin|akaryakıt|istasyon|ucuz|yakıt al|depo/.test(t)) {
      return { text: `Rotan üzerindeki 6 istasyonu taradım. En uygun fiyat Atatürk Bulvarı'ndaki Opet'te; bölge ortalamasından 0,55 ₺/L daha ucuz.${vehicle && vehicle.fuelType !== 'Elektrik' ? `\n50 litrelik dolumda yaklaşık ${tl(27.5)} tasarruf edersin.` : ''}`, station: true };
    }
    if (/klima/.test(t)) {
      if (!vehicle) return { text: 'Klima, şehir içinde tüketimi ortalama %8–12, otoyolda %4–6 artırır. Net litre ve TL hesabı için Garajım\'a aracını eklemen yeterli.' };
      const base = calcTrip(route, vehicle);
      const extra = base.amount * 0.1;
      return { text: `${vehicle.model} için seçili rotada (${fmt1(route.km)} km) klima tüketimi yaklaşık %10 artırır:\n• Ek ${vehicle.fuelType === 'Elektrik' ? 'enerji' : 'yakıt'}: ${fmt(extra)} ${base.unit}\n• Ek maliyet: ${tl(extra * vehicle.price)}\nİpucu: Kabini önce 2–3 dk camlar açık havalandırmak ilk yükü azaltır.` };
    }
    if (/trafik|en az|yakan|eco|ekonomik|rota/.test(t)) {
      const eco = routes.find((r) => r.id === 'eco');
      const e = calcTrip(eco, vehicle);
      return { text: `Routier Eco rotası ${eco.via} üzerinden ilerliyor.\n• ${eco.min} dk • ${fmt1(eco.km)} km${e ? `\n• ${fmt(e.amount)} ${e.unit} • ${tl(e.cost)}${fastTrip ? ` (en hızlıya göre ${tl(Math.max(0, fastTrip.cost - e.cost))} tasarruf)` : ''}` : '\n• Maliyet için araç eklemen gerekiyor'}`, eco: true };
    }
    return { text: 'Bunu not aldım. Şu an rota planlama, yakıt maliyeti ve yol üstü istasyonlar konusunda sana en iyi şekilde yardımcı olabilirim. Aşağıdaki önerilerden birini deneyebilirsin.' };
  }, [vehicle, route, routes, fastTrip]);

  const sendAI = (q) => {
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: q }]);
    setTyping(true);
    setListening(false);
    setTimeout(() => {
      const r = aiReply(q);
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: 'ai', ...r }]);
      setTyping(false);
    }, 950);
  };

  /* ---- Başlangıç / varış / durak ---- */
  const changeOrigin = useCallback((pl) => { setOrigin(pl); setStop(null); setSheetOpen(true); }, []);
  const changeDest = useCallback((pl) => { setDestination(pl); setStop(null); setSheetOpen(true); }, []);
  const swapEnds = () => { setOrigin(destination); setDestination(origin); setStop(null); };
  const saveSlot = (slot, pl) => setSettings((st) => ({ ...st, [slot]: { name: pl.name, sub: pl.sub ? `${pl.name}, ${pl.sub}` : pl.name, coord: pl.coord } }));

  const addStop = (st) => {
    setStop(st);
    setModal(null);
    setSheetOpen(true);
    showToast(`${st.name} durağı eklendi, rota yeniden hesaplanıyor`, 'ok');
  };
  const clearStop = () => { setStop(null); showToast('Durak rotadan kaldırıldı'); };
  const baseCoords = () => (routes.find((r) => r.id === selected) || routes[0]).coords;
  const openStops = async (kind) => {
    setModal('poi');
    setPoi({ kind, status: 'loading', items: [], offline: false });
    const r = await findStops(kind, baseCoords(), origin.coord, destination.coord);
    setPoi((cur) => (cur.kind === kind ? { kind, status: 'ok', items: r.items, offline: r.offline } : cur));
  };
  const addBestStop = async (kind) => {
    showToast('Rotadaki en az sapan istasyon aranıyor…');
    const r = await findStops(kind, baseCoords(), origin.coord, destination.coord);
    if (r.items.length) { addStop(r.items[0]); setTab('map'); } else showToast('Rota yakınında istasyon bulunamadı', 'warn');
  };

  const pill = (k) => {
    if (k === 'ev' || k === 'is') {
      const pl = k === 'ev' ? home : work;
      if (distM(pl.coord, origin.coord) < 30) { showToast('Zaten bu konumdasınız; başlangıcı değiştirin', 'warn'); setEditor('origin'); return; }
      changeDest({ ...pl, name: pl.demo ? pl.name : (k === 'ev' ? 'Ev' : 'İş') });
      showToast(`Hedef: ${k === 'ev' ? 'Ev' : 'İş'}${pl.demo ? ' (örnek adres — Rota Düzenle\'den kaydedin)' : ''}`, 'ok');
    } else openStops(k);
  };

  const onLongPress = useCallback((coord) => {
    setPick({ coord, place: null });
    setModal('pick');
    reverseGeocode(coord).then((place) => setPick((cur) => (cur && cur.coord === coord ? { ...cur, place } : cur)));
  }, []);
  const pickPlace = () => (pick && (pick.place || { name: 'Seçilen nokta', sub: `${pick.coord[1].toFixed(5)}, ${pick.coord[0].toFixed(5)}`, coord: pick.coord }));

  /* ================================ RENDER ================================ */
  const frame = (content) => (
    <div className="min-h-[100dvh] w-full bg-[#EFEBE7] sm:flex sm:items-center sm:justify-center sm:p-6" style={{ fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, sans-serif" }}>
      <GlobalStyles />
      <div className="relative mx-auto h-[100dvh] w-full max-w-[430px] overflow-hidden bg-white text-[#1E2022] antialiased sm:h-[min(880px,calc(100dvh-48px))] sm:rounded-[44px] sm:shadow-[0_30px_80px_rgba(30,32,34,0.18)] sm:ring-[10px] sm:ring-[#1E2022]">
        {content}
        {toast && (
          <div key={toast.id} className="rt-up pointer-events-none absolute inset-x-0 top-[max(14px,env(safe-area-inset-top))] z-[70] flex justify-center px-6">
            <div className="flex max-w-full items-center gap-2 rounded-full bg-[#1E2022]/90 px-4 py-2.5 text-[13.5px] font-medium text-white shadow-lg backdrop-blur-md">
              {toast.kind === 'ok' ? <Check size={16} className="shrink-0 text-[#6EE7B7]" /> : toast.kind === 'warn' ? <AlertTriangle size={16} className="shrink-0 text-[#FCD34D]" /> : <Info size={16} className="shrink-0 text-[#FFD8C7]" />}
              <span className="truncate">{toast.t}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!session) return frame(<AuthScreen onAuth={handleAuth} />);

  const tabs = [
    { k: 'map', label: 'Keşfet', icon: Compass },
    { k: 'routes', label: 'Rotalar', icon: Route },
    { k: 'ai', label: 'Routier AI', icon: Sparkles },
    { k: 'garage', label: 'Garajım', icon: Warehouse },
    { k: 'profile', label: 'Profil', icon: User },
  ];
  const unit = vehicle ? FUELS[vehicle.fuelType].unit : 'L';

  return frame(
    <>
      {/* Harita her zaman arka planda */}
      <MapCanvas routes={geoms} selected={selected} start={origin.coord} end={destination.coord} stopPoint={stop ? stop.coord : null} onLongPress={nav ? null : onLongPress} drive={nav ? nav.progress : null} follow={follow} onUserPan={() => setFollow(false)} locateTick={locateTick} onToast={showToast} />

      {/* ------------------ KEŞFET (HARİTA) ------------------ */}
      {tab === 'map' && !nav && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[max(14px,calc(env(safe-area-inset-top)+6px))] [&>*]:pointer-events-auto">
            <div className="flex h-[54px] items-center gap-2.5 rounded-full bg-white/85 pl-4 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.08)] ring-1 ring-white/60 backdrop-blur-md">
              <span className="shrink-0"><LogoMark height={30} /></span>
              <button type="button" onClick={() => setEditor('dest')} className="h-full min-w-0 flex-1 truncate text-left text-[16px] text-[#6B7280]">Routier'e sor veya hedef ara...</button>
              <button type="button" onClick={() => { setListening(true); setTab('ai'); showToast('Dinliyorum… komutunuzu söyleyin'); }} className="grid h-10 w-10 place-items-center rounded-full text-[#1E2022] hover:bg-[#FFF1EB]" aria-label="Sesli arama"><Mic size={20} /></button>
            </div>
            <div className="rt-noscroll -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
              {[['ev', 'Ev', Home], ['is', 'İş', Briefcase], ['fuel', 'En Ucuz Benzin', Fuel], ['cafe', 'Kafe', Coffee], ['charge', 'Şarj', Zap]].map(([k, l, I]) => {
                const on = k === 'ev' ? sameCoord(destination.coord, home.coord) : k === 'is' ? sameCoord(destination.coord, work.coord) : !!stop && stop.kind === k;
                return (
                  <button key={k} type="button" onClick={() => pill(k)}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold shadow-[0_4px_14px_rgba(0,0,0,0.06)] backdrop-blur-md transition ${on ? 'bg-[#FF8A5B] text-white' : 'bg-white/85 text-[#1E2022]'}`}>
                    <I size={15} className={on ? 'text-white' : 'text-[#FF8A5B]'} />{l}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between">
              {vehicle ? (
                <button type="button" onClick={() => setModal('switch')} className="flex h-9 max-w-[78%] items-center gap-1.5 rounded-full bg-white/85 px-3.5 text-[13px] font-semibold text-[#1E2022] shadow-[0_4px_14px_rgba(0,0,0,0.06)] ring-1 ring-[#FFD8C7] backdrop-blur-md">
                  <Car size={15} className="shrink-0 text-[#FF8A5B]" />
                  <span className="truncate">{vehicle.model}</span>
                  <span className="rt-num shrink-0 text-[#6B7280]">• {fmt1(vehicle.consumption)} {unit}/100km</span>
                  <ChevronDown size={14} className="shrink-0 text-[#6B7280]" />
                </button>
              ) : (
                <button type="button" onClick={() => setModal('add')} className="flex h-9 items-center gap-1.5 rounded-full bg-[#FFF1EB]/95 px-3.5 text-[13px] font-bold text-[#E87344] shadow-[0_4px_14px_rgba(0,0,0,0.06)] ring-1 ring-[#FFD8C7] backdrop-blur-md">
                  <Car size={15} />Araç Ekle<Plus size={14} />
                </button>
              )}
              <button type="button" onClick={() => setLocateTick((t) => t + 1)} className="grid h-10 w-10 place-items-center rounded-full bg-white/85 text-[#1E2022] shadow-[0_4px_14px_rgba(0,0,0,0.08)] backdrop-blur-md" aria-label="Konumum"><LocateFixed size={18} /></button>
            </div>
          </div>

          {/* Sürüş özeti alt çekmecesi */}
          <div className="rt-up absolute inset-x-0 bottom-0 z-20 rounded-t-[32px] bg-white pb-[92px] shadow-[0_-10px_40px_rgba(0,0,0,0.08)]">
            <p className="absolute -top-6 left-4 text-[10.5px] text-[#6B7280]">
              <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
            </p>
            <button type="button" onClick={() => setSheetOpen((o) => !o)} className="flex w-full flex-col items-center pt-2.5" aria-label={sheetOpen ? 'Paneli küçült' : 'Paneli genişlet'}>
              <span className="h-1.5 w-10 rounded-full bg-[#E5E7EB]" />
            </button>
            <div className="px-5 pt-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`flex items-baseline gap-2 transition ${routeState === 'loading' ? 'opacity-40' : ''}`}>
                    <span className="rt-num text-[30px] font-extrabold leading-none text-[#1E2022]">{route.min >= 60 ? `${Math.floor(route.min / 60)} sa ${route.min % 60} dk` : `${route.min} dk`}</span>
                    <span className="rt-num text-[15px] font-semibold text-[#6B7280]">{fmt1(route.km)} km</span>
                    {routeState === 'loading' && <Loader2 size={16} className="animate-spin self-center text-[#FF8A5B]" />}
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13.5px] text-[#6B7280]">
                    <Clock size={14} className="shrink-0" />Varış <span className="rt-num font-semibold text-[#1E2022]">{clockPlus(route.min)}</span>{route.via ? ` • ${route.via}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => setSheetOpen((o) => !o)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F8F6F4] text-[#6B7280]" aria-label="Detaylar">
                  {sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>

              <button type="button" onClick={() => setEditor('dest')} className="mt-3 flex w-full items-center gap-2 rounded-2xl bg-[#FAFAFA] px-3 py-2.5 text-left ring-1 ring-[#ECEEF2]">
                <span className="h-3 w-3 shrink-0 rounded-full border-[3px] border-[#1E2022]" />
                <span className="min-w-0 max-w-[40%] truncate text-[13.5px] font-semibold text-[#1E2022]">{origin.name}</span>
                <ArrowRight size={14} className="shrink-0 text-[#9CA3AF]" />
                <MapPin size={15} className="shrink-0 text-[#FF8A5B]" fill="#FFF1EB" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[#1E2022]">{destination.name}</span>
                <Pencil size={14} className="shrink-0 text-[#E87344]" />
              </button>

              {sheetOpen && (
                <div className="rt-fade">
                  {routeState === 'offline' && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#9CA3AF]"><CloudOff size={13} />Rota servisine ulaşılamadı, tahmini rota gösteriliyor.</p>}
                  <div className="rt-noscroll -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
                    {routes.map((r) => (
                      <button key={r.id} type="button" onClick={() => setSelected(r.id)}
                        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition ${r.id === selected ? 'border-[#FF8A5B] bg-[#FFF1EB] text-[#E87344]' : 'border-[#ECEEF2] text-[#6B7280]'}`}>
                        <r.icon size={14} />{r.id === 'eco' ? 'Eco' : r.id === 'fast' ? 'Hızlı' : 'Manzara'}<span className="rt-num font-medium opacity-80">{r.min} dk</span>
                      </button>
                    ))}
                  </div>

                  {stop && (
                    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[#FAFAFA] px-3 py-2 ring-1 ring-[#ECEEF2]">
                      <Flag size={15} className="shrink-0 text-[#FF8A5B]" />
                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1E2022]">Durak: {stop.name}{stop.addKm != null && <span className="rt-num text-[#6B7280]"> (+{fmt1(stop.addKm)} km, +{Math.max(1, Math.round(stop.addMin))} dk)</span>}</p>
                      <button type="button" onClick={clearStop} className="grid h-7 w-7 place-items-center rounded-full text-[#6B7280] hover:bg-white" aria-label="Durağı kaldır"><X size={15} /></button>
                    </div>
                  )}

                  {vehicle && trip ? (
                    <div className="mt-3 rounded-3xl border border-[#FFD8C7] bg-[#FFF1EB] p-4">
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold text-[#E87344]"><Fuel size={15} className="shrink-0" /><span className="truncate">{vehicle.model} • {vehicle.fuelType}</span></p>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[12px] text-[#6B7280]">Tahmini {vehicle.fuelType === 'Elektrik' ? 'enerji' : 'yakıt'}</p>
                          <p className="rt-num text-[22px] font-extrabold text-[#1E2022]">{fmt(trip.amount)} <span className="text-[14px] font-semibold text-[#6B7280]">{trip.unit}</span></p>
                        </div>
                        <div className="text-right">
                          <p className="text-[12px] text-[#6B7280]">Tahmini tutar</p>
                          <p className="rt-num text-[22px] font-extrabold text-[#E87344]">{tl(trip.cost)}</p>
                        </div>
                      </div>
                      {ecoSaving > 0.005 ? (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[12px] font-bold text-[#10B981]"><Leaf size={12} />Eco-Rota ile {tl(ecoSaving)} tasarruf</span>
                      ) : selected === 'fast' && (
                        <button type="button" onClick={() => setSelected('eco')} className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[12px] font-bold text-[#10B981]"><Leaf size={12} />Eco-Rotaya geç, tasarruf et</button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-3 rounded-3xl border border-[#FFD8C7] bg-[#FFF1EB] p-4">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-[#FF8A5B]"><Car size={19} /></span>
                      <p className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-[#1E2022]">Tüketim hesabı için araç ekleyin</p>
                      <button type="button" onClick={() => setModal('add')} className="h-9 shrink-0 rounded-full bg-[#FF8A5B] px-4 text-[13px] font-bold text-white">Ekle</button>
                    </div>
                  )}
                </div>
              )}

              <button type="button" onClick={startNav} disabled={routeState === 'loading'} className="mt-4 flex h-[54px] w-full disabled:opacity-60 items-center justify-center gap-2 rounded-2xl bg-[#FF8A5B] text-[16px] font-bold text-white shadow-[0_8px_24px_rgba(255,138,91,0.35)] transition hover:bg-[#E87344] active:scale-[.99]">
                <Navigation size={19} fill="#fff" />Navigasyonu Başlat
              </button>
            </div>
          </div>
        </>
      )}

      {/* ------------------ AKTİF SÜRÜŞ ------------------ */}
      {nav && navInfo && (
        <>
          <div className="rt-up absolute inset-x-0 top-0 z-30 px-3 pt-[max(12px,calc(env(safe-area-inset-top)+4px))]">
            <div className="flex items-center gap-3 rounded-3xl bg-[#FF8A5B] p-4 text-white shadow-[0_10px_30px_rgba(232,115,68,0.35)]">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20"><navInfo.step.icon size={30} strokeWidth={2.6} /></span>
              <div className="min-w-0">
                <p className="rt-num text-[26px] font-extrabold leading-none">{navInfo.toNext < 1 ? `${Math.max(50, Math.round(navInfo.toNext * 1000 / 50) * 50)} m` : `${fmt1(navInfo.toNext)} km`}</p>
                <p className="mt-1 line-clamp-2 text-[14.5px] font-semibold leading-snug text-white/95">{navInfo.step.text}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-[#1E2022] shadow-sm backdrop-blur-md">{route.tag}</span>
              {stop && <span className="flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-[#1E2022] shadow-sm backdrop-blur-md"><Flag size={12} className="text-[#FF8A5B]" />{stop.name}</span>}
            </div>
          </div>

          {!follow && (
            <button type="button" onClick={() => setFollow(true)} className="rt-up absolute bottom-[max(262px,calc(env(safe-area-inset-bottom)+252px))] right-4 z-30 flex h-11 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-bold text-[#E87344] shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-[#FFD8C7]">
              <Navigation size={16} fill="#FF8A5B" />Yeniden Ortala
            </button>
          )}
          <div className="absolute bottom-[max(250px,calc(env(safe-area-inset-bottom)+240px))] left-4 z-30 grid h-[76px] w-[76px] place-items-center rounded-full bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-4 ring-white">
            <div className="text-center">
              <p className="rt-num text-[26px] font-extrabold leading-none text-[#1E2022]">{navInfo.speed}</p>
              <p className="text-[10px] font-semibold text-[#6B7280]">km/s</p>
            </div>
            <span className="rt-num absolute -right-2 -top-2 grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#EF4444] bg-white text-[12px] font-extrabold text-[#1E2022]">{navInfo.limit}</span>
          </div>

          <div className="rt-up absolute inset-x-0 bottom-0 z-30 rounded-t-[32px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
            <div className="h-1.5 overflow-hidden rounded-full bg-[#ECEEF2]"><div className="h-full rounded-full bg-[#FF8A5B] transition-all" style={{ width: `${nav.progress * 100}%` }} /></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="rt-num text-[22px] font-extrabold text-[#1E2022]">{navInfo.remainMin} <span className="text-[13px] font-semibold text-[#6B7280]">dk</span></p>
                <p className="text-[11.5px] text-[#6B7280]">Kalan süre</p>
              </div>
              <div className="border-x border-[#ECEEF2]">
                <p className="rt-num text-[22px] font-extrabold text-[#1E2022]">{fmt1(navInfo.remainKm)} <span className="text-[13px] font-semibold text-[#6B7280]">km</span></p>
                <p className="text-[11.5px] text-[#6B7280]">Kalan mesafe</p>
              </div>
              <div>
                <p className="rt-num text-[22px] font-extrabold text-[#1E2022]">{clockPlus(navInfo.remainMin)}</p>
                <p className="text-[11.5px] text-[#6B7280]">Varış</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2.5 rounded-2xl bg-[#FFF1EB] p-3">
                <Gauge size={20} className="shrink-0 text-[#FF8A5B]" />
                <div className="min-w-0">
                  <p className="text-[11px] text-[#6B7280]">Anlık tüketim</p>
                  <p className="rt-num truncate text-[15px] font-bold text-[#1E2022]">{navInfo.inst != null ? `${fmt1(navInfo.inst)} ${unit}/100km` : 'Araç yok'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-2xl bg-[#ECFDF5] p-3">
                <Wallet size={20} className="shrink-0 text-[#10B981]" />
                <div className="min-w-0">
                  <p className="text-[11px] text-[#6B7280]">Şu ana kadar</p>
                  <p className="rt-num truncate text-[15px] font-bold text-[#1E2022]">{navInfo.used != null ? tl(navInfo.used * vehicle.price) : '—'}</p>
                </div>
              </div>
            </div>
            <button type="button" onClick={() => finishDrive(false)} className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FEF2F2] text-[15px] font-bold text-[#EF4444] transition hover:bg-[#FDE2E2]">
              <X size={19} />Sürüşü Bitir
            </button>
          </div>
        </>
      )}

      {/* ------------------ DİĞER SEKMELER ------------------ */}
      {tab === 'routes' && !nav && (
        <div className="absolute inset-0 z-20">
          <RoutesScreen origin={origin} destination={destination} routes={routes} selected={selected} setSelected={setSelected} vehicle={vehicle} stop={stop} routeState={routeState}
            onEdit={(f) => setEditor(f)} onSwap={swapEnds} onClearStop={clearStop}
            onShowMap={() => setTab('map')} onStart={startNav} onAddVehicle={() => setModal('add')} />
        </div>
      )}
      {tab === 'ai' && !nav && (
        <div className="absolute inset-0 z-20">
          <AIScreen messages={messages} onSend={sendAI} typing={typing} stop={stop} listening={listening} setListening={setListening}
            onAddStation={() => addBestStop('fuel')}
            onApplyEco={() => { setSelected('eco'); setTab('map'); setSheetOpen(true); showToast('Routier Eco rotası çizildi', 'ok'); }} />
        </div>
      )}
      {tab === 'garage' && !nav && (
        <div className="absolute inset-0 z-20">
          <GarageScreen garage={garage} onAdd={() => setModal('add')} onActivate={activate} onDelete={removeVehicle} onPrice={setPrice} />
        </div>
      )}
      {tab === 'profile' && !nav && (
        <div className="absolute inset-0 z-20">
          <ProfileScreen sync={sync} session={session} vehicle={vehicle} trips={trips} settings={settings} setSettings={setSettings} onLogout={logout} onGarage={() => setTab('garage')} />
        </div>
      )}

      {/* ------------------ ALT NAVİGASYON ------------------ */}
      {!nav && (
        <nav className="absolute inset-x-0 bottom-0 z-40 border-t border-[#ECEEF2] bg-white pb-[max(8px,env(safe-area-inset-bottom))]">
          <div className="grid h-[68px] grid-cols-5 items-center">
            {tabs.map(({ k, label, icon: I }) => {
              const on = tab === k;
              if (k === 'ai') {
                return (
                  <button key={k} type="button" onClick={() => setTab(k)} className="flex flex-col items-center" aria-label={label}>
                    <span className={`rt-glow -mt-8 grid h-[60px] w-[60px] place-items-center rounded-full bg-[#FF8A5B] text-white ring-[6px] ring-white transition ${on ? 'scale-105' : ''}`}>
                      <Sparkles size={26} />
                    </span>
                    <span className={`mt-1 text-[11px] font-bold ${on ? 'text-[#E87344]' : 'text-[#6B7280]'}`}>{label}</span>
                  </button>
                );
              }
              return (
                <button key={k} type="button" onClick={() => setTab(k)} className="flex h-full flex-col items-center justify-center gap-1" aria-label={label}>
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition ${on ? 'bg-[#FFF1EB] text-[#FF8A5B]' : 'text-[#9CA3AF]'}`}><I size={21} strokeWidth={on ? 2.4 : 2} /></span>
                  <span className={`text-[11px] ${on ? 'font-bold text-[#E87344]' : 'font-medium text-[#6B7280]'}`}>{label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* ------------------ MODALLAR ------------------ */}
      {modal === 'add' && <AddVehicleSheet onClose={() => setModal(null)} onSave={addVehicle} />}

      {modal === 'switch' && (
        <Sheet onClose={() => setModal(null)} title="Aracını Seç">
          <div className="space-y-2 pb-2">
            {garage.list.map((v) => {
              const on = v.id === garage.activeId;
              const t = calcTrip(route, v);
              return (
                <button key={v.id} type="button" onClick={() => { activate(v.id); setModal(null); }}
                  className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${on ? 'border-[#FF8A5B] bg-[#FFF1EB]' : 'border-[#ECEEF2] bg-white'}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#FF8A5B] ring-1 ring-[#FFD8C7]"><Car size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-[#1E2022]">{v.brand} {v.model}</p>
                    <p className="rt-num truncate text-[12.5px] text-[#6B7280]">{fmt1(v.consumption)} {FUELS[v.fuelType].unit}/100km • bu rota {tl(t.cost)}</p>
                  </div>
                  {on && <Check size={20} className="shrink-0 text-[#FF8A5B]" strokeWidth={3} />}
                </button>
              );
            })}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" onClick={() => setModal('add')} className="flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-[#FFD8C7] text-[14px] font-bold text-[#E87344]"><Plus size={17} />Yeni Araç</button>
              <button type="button" onClick={() => { setModal(null); setTab('garage'); }} className="flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-[#1E2022] text-[14px] font-bold text-white"><Warehouse size={17} />Garajım</button>
            </div>
          </div>
        </Sheet>
      )}

      {modal === 'poi' && poi.kind && (
        <StopSheet kind={poi.kind} state={poi} stop={stop} onPick={addStop} onClose={() => setModal(null)} onRetry={() => openStops(poi.kind)} />
      )}

      {modal === 'pick' && pick && (
        <Sheet onClose={() => setModal(null)} title="Seçilen Nokta">
          <div className="flex items-center gap-3 rounded-2xl bg-[#FAFAFA] p-3 ring-1 ring-[#ECEEF2]">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FFF1EB] text-[#FF8A5B]"><MapPin size={20} /></span>
            <div className="min-w-0 flex-1">
              {pick.place ? (
                <>
                  <p className="truncate text-[15px] font-bold text-[#1E2022]">{pick.place.name}</p>
                  <p className="truncate text-[12.5px] text-[#6B7280]">{pick.place.sub}</p>
                </>
              ) : <p className="flex items-center gap-2 text-[14px] text-[#6B7280]"><Loader2 size={15} className="animate-spin text-[#FF8A5B]" />Adres alınıyor…</p>}
            </div>
            <span className="rt-num shrink-0 text-[12.5px] text-[#9CA3AF]">{fmt1(distM(origin.coord, pick.coord) / 1000)} km</span>
          </div>
          <div className="mt-4 space-y-2 pb-2">
            <button type="button" onClick={() => {
              const pl = pickPlace();
              if (distM(pl.coord, origin.coord) < 30) { showToast('Başlangıç ve varış aynı olamaz', 'warn'); return; }
              changeDest(pl); setModal(null); showToast(`Hedef: ${pl.name}`, 'ok');
            }} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A5B] text-[15px] font-bold text-white hover:bg-[#E87344]"><Navigation size={18} fill="#fff" />Buraya Git</button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => {
                const pl = pickPlace();
                if (distM(pl.coord, destination.coord) < 30) { showToast('Başlangıç ve varış aynı olamaz', 'warn'); return; }
                changeOrigin(pl); setModal(null); showToast(`Başlangıç: ${pl.name}`, 'ok');
              }} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#ECEEF2] text-[14px] font-bold text-[#1E2022]"><span className="h-3 w-3 rounded-full border-[3px] border-[#1E2022]" />Buradan Başla</button>
              <button type="button" onClick={() => addStop({ ...pickPlace(), kind: 'custom' })} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#FFD8C7] text-[14px] font-bold text-[#E87344]"><Flag size={16} />Durak Ekle</button>
            </div>
          </div>
        </Sheet>
      )}

      {editor && !nav && (
        <RouteEditor origin={origin} destination={destination} stop={stop} home={settings.home || DEMO_HOME} work={settings.work || DEMO_WORK} initialField={editor}
          onClose={() => setEditor(null)} onSetOrigin={changeOrigin} onSetDest={changeDest} onSwap={swapEnds} onClearStop={clearStop} onSaveSlot={saveSlot} onToast={showToast}
          onAsk={(q) => { setEditor(null); setTab('ai'); sendAI(q); }} />
      )}

      {modal === 'recovery' && (
        <Sheet onClose={() => setModal(null)} title="Yeni Şifre Belirle">
          <p className="-mt-1 mb-4 text-[14px] text-[#6B7280]">Hesabın için yeni bir şifre gir (en az 6 karakter).</p>
          <Field icon={Lock} type="password" placeholder="Yeni şifre" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
          <button type="button" onClick={async () => {
            if (newPass.length < 6) { showToast('Şifre en az 6 karakter olmalı', 'warn'); return; }
            try {
              const { error } = await supabase.auth.updateUser({ password: newPass });
              if (error) throw error;
              setNewPass('');
              setModal(null);
              showToast('Şifren güncellendi', 'ok');
            } catch (e) { showToast(authErrorTr(e), 'warn'); }
          }} className="mb-2 mt-4 h-[52px] w-full rounded-2xl bg-[#FF8A5B] text-[15px] font-bold text-white hover:bg-[#E87344]">Şifreyi Kaydet</button>
        </Sheet>
      )}

      {modal === 'summary' && summary && (
        <Sheet onClose={() => setModal(null)}>
          <div className="flex flex-col items-center pt-4 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[#ECFDF5] text-[#10B981]"><Flag size={28} /></span>
            <h3 className="mt-4 text-[21px] font-extrabold text-[#1E2022]">{summary.completed ? 'Hedefe ulaştınız!' : 'Sürüş sonlandırıldı'}</h3>
            <p className="mt-1 text-[14px] text-[#6B7280]">{summary.dest} • {fmt1(summary.km)} km • {summary.min} dk</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-[#FFF1EB] p-4">
              <p className="text-[12px] text-[#6B7280]">Harcanan</p>
              <p className="rt-num text-[19px] font-extrabold text-[#1E2022]">{vehicle ? `${fmt(summary.amount)} ${summary.unit}` : '—'}</p>
              <p className="rt-num text-[13px] font-semibold text-[#E87344]">{vehicle ? tl(summary.cost) : 'Araç eklenmedi'}</p>
            </div>
            <div className="rounded-2xl bg-[#ECFDF5] p-4">
              <p className="text-[12px] text-[#6B7280]">Eco tasarrufu</p>
              <p className="rt-num text-[19px] font-extrabold text-[#10B981]">{tl(summary.saved)}</p>
              <p className="text-[13px] text-[#6B7280]">Aylık özete eklendi</p>
            </div>
          </div>
          <button type="button" onClick={() => setModal(null)} className="mb-2 mt-5 h-[52px] w-full rounded-2xl bg-[#FF8A5B] text-[15px] font-bold text-white hover:bg-[#E87344]">Tamam</button>
        </Sheet>
      )}
    </>,
  );
}
