import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { createClient } from '@supabase/supabase-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Navigation, Compass, Search, Mic, Home, Briefcase, Fuel, Coffee, Zap, Car, Plus, Trash2,
  Eye, EyeOff, Mail, Lock, User, ChevronRight, ChevronUp, ChevronDown, Clock, MapPin, Route,
  Sparkles, Send, Leaf, TrendingDown, Gauge, X, Check, ArrowUp, CornerUpRight, CornerUpLeft,
  LogOut, Bell, Volume2, ShieldCheck, HelpCircle, LocateFixed, Warehouse, Flag, ArrowLeftRight,
  Wallet, Pencil, AlertTriangle, Info, Mountain, Timer, ArrowRight, Loader2, Wind, Droplet, Cloud, CloudOff,
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

const START = { name: 'Bostancı, Kadıköy', coord: [29.096, 40.953] };

const DESTINATIONS = {
  is: {
    key: 'is', label: 'İş', name: 'Levent Plaza', sub: 'Büyükdere Cd. No:185, Levent', coord: [29.0107, 41.081],
    routes: [
      { id: 'eco', title: 'En Ekonomik', tag: 'Routier Eco', via: 'D-100 • 15 Temmuz Köprüsü', min: 37, km: 29.1, factor: 0.84, icon: Leaf },
      { id: 'fast', title: 'En Hızlı', tag: 'Otoyol', via: 'O-1 • Altunizade', min: 31, km: 28.4, factor: 1.04, icon: Zap },
      { id: 'scenic', title: 'Alternatif / Manzara', tag: 'Sahil yolu', via: 'Kadıköy • Üsküdar sahili', min: 42, km: 32.0, factor: 0.97, icon: Mountain },
    ],
    fallback: {
      eco: [[29.096, 40.953], [29.085, 40.97], [29.07, 40.985], [29.056, 41.0], [29.05, 41.015], [29.045, 41.03], [29.034, 41.045], [29.02, 41.056], [29.012, 41.067], [29.0107, 41.081]],
      fast: [[29.096, 40.953], [29.1, 40.97], [29.1, 40.98], [29.088, 40.996], [29.07, 41.01], [29.052, 41.023], [29.04, 41.038], [29.034, 41.045], [29.02, 41.056], [29.012, 41.067], [29.0107, 41.081]],
      scenic: [[29.096, 40.953], [29.07, 40.966], [29.045, 40.975], [29.027, 40.988], [29.015, 41.01], [29.016, 41.027], [29.03, 41.04], [29.034, 41.045], [29.02, 41.056], [29.012, 41.067], [29.0107, 41.081]],
    },
    steps: [
      { at: 0, icon: ArrowUp, text: 'Bağdat Caddesi boyunca devam edin' },
      { at: 0.12, icon: CornerUpRight, text: 'Sağa dönün: D-100 bağlantı yolu' },
      { at: 0.32, icon: ArrowUp, text: 'D-100 üzerinde Avrupa yönüne ilerleyin' },
      { at: 0.55, icon: ArrowUp, text: '15 Temmuz Şehitler Köprüsü' },
      { at: 0.72, icon: CornerUpRight, text: 'Zincirlikuyu çıkışından sağa' },
      { at: 0.88, icon: CornerUpLeft, text: 'Büyükdere Cd. — hedef solda' },
    ],
  },
  ev: {
    key: 'ev', label: 'Ev', name: 'Ev', sub: 'Atatürk Mah. Ataşehir', coord: [29.1235, 40.9925],
    routes: [
      { id: 'eco', title: 'En Ekonomik', tag: 'Routier Eco', via: 'Kayışdağı Cd.', min: 17, km: 9.6, factor: 0.84, icon: Leaf },
      { id: 'fast', title: 'En Hızlı', tag: 'Otoyol', via: 'O-2 • Kozyatağı', min: 14, km: 9.1, factor: 1.04, icon: Zap },
      { id: 'scenic', title: 'Alternatif / Manzara', tag: 'Park yolu', via: 'Göztepe Parkı', min: 21, km: 11.4, factor: 0.97, icon: Mountain },
    ],
    fallback: {
      eco: [[29.096, 40.953], [29.104, 40.962], [29.11, 40.972], [29.116, 40.982], [29.1235, 40.9925]],
      fast: [[29.096, 40.953], [29.1, 40.965], [29.1, 40.978], [29.112, 40.987], [29.1235, 40.9925]],
      scenic: [[29.096, 40.953], [29.084, 40.968], [29.088, 40.982], [29.105, 40.99], [29.1235, 40.9925]],
    },
    steps: [
      { at: 0, icon: ArrowUp, text: 'Bostancı Köprüsü yönüne devam edin' },
      { at: 0.25, icon: CornerUpRight, text: 'Sağa dönün: Kayışdağı Caddesi' },
      { at: 0.6, icon: ArrowUp, text: 'Ataşehir Bulvarı boyunca ilerleyin' },
      { at: 0.86, icon: CornerUpLeft, text: 'Sola dönün — hedef sağda' },
    ],
  },
};

// Yedek rota geometrilerinin köşelerini yumuşat (keskin dönüş yerine kavisli yol)
Object.values(DESTINATIONS).forEach((d) => {
  Object.keys(d.fallback).forEach((k) => { d.fallback[k] = chaikin(d.fallback[k], 3); });
});

const POIS = {
  fuel: {
    title: 'Yakındaki En Ucuz Benzinlikler', icon: Fuel,
    items: [
      { name: 'Opet - Atatürk Bulvarı', meta: '43,80 ₺/L • 1,2 km', detour: 2, best: true },
      { name: 'Petrol Ofisi - Bağdat Cd.', meta: '44,05 ₺/L • 2,0 km', detour: 3 },
      { name: 'Shell - Kozyatağı', meta: '44,35 ₺/L • 2,6 km', detour: 4 },
    ],
  },
  cafe: {
    title: 'Rota Üzerindeki Kafeler', icon: Coffee,
    items: [
      { name: 'Kahve Dünyası - Suadiye', meta: '4,6 ★ • 0,8 km', detour: 3, best: true },
      { name: 'Petra Roasting - Moda', meta: '4,8 ★ • 3,4 km', detour: 6 },
      { name: 'Starbucks - Altunizade', meta: '4,3 ★ • rota üstü', detour: 2 },
    ],
  },
  charge: {
    title: 'Şarj İstasyonları', icon: Zap,
    items: [
      { name: 'ZES - Bostancı Sahil', meta: '180 kW DC • 8,90 ₺/kWh', detour: 2, best: true },
      { name: 'Eşarj - Kozyatağı AVM', meta: '120 kW DC • 9,40 ₺/kWh', detour: 4 },
      { name: 'Trugo - Acıbadem', meta: '300 kW DC • 9,99 ₺/kWh', detour: 5 },
    ],
  },
};

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
function RoutierMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill={C.orange} />
      <path d="M9 21.5c3.5 0 4-11 8-11 2.6 0 3.2 4 6 4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="9" cy="21.5" r="2.2" fill="#fff" />
      <path d="M23 9.5l1.8 4.4-4.6-.8z" fill="#fff" />
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
          <div className="grid h-20 w-20 place-items-center rounded-[28px] bg-white shadow-[0_8px_30px_rgba(232,115,68,0.18)] ring-1 ring-[#FFD8C7]">
            <RoutierMark size={46} />
          </div>
          <h1 className="mt-5 text-[34px] font-extrabold tracking-tight text-[#1E2022]">Routier</h1>
          <p className="mt-1 text-[15px] text-[#6B7280]">Akıllı ve tasarruflu yolculuklara başla</p>
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

function SvgMap({ routes, selected, start, end, drive, follow, onUserPan, recenterTick }) {
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

  // Dokunma / fare etkileşimi
  useEffect(() => {
    const el = wrap.current;
    const pts = new Map();
    let moved = 0;
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
    const down = (e) => {
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* yok say */ }
      pts.set(e.pointerId, local(e));
      moved = 0;
      last = snapshot();
    };
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
      if (moved > 4 || pts.size >= 2) userMoved();
      last = now;
      apply();
    };
    const up = (e) => { pts.delete(e.pointerId); last = snapshot(); };
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
    return () => {
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
function LiveMap({ routes, selected, start, end, drive, follow, onUserPan, onFail, locateTick, onToast }) {
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

  return <div ref={box} className="absolute inset-0" />;
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
   SEKMELER
   ========================================================================= */

/* ---------- Rotalar ---------- */
function RoutesScreen({ dest, routes, selected, setSelected, vehicle, onShowMap, onStart, onSwapDest, onAddVehicle, stop }) {
  const fast = routes.find((r) => r.id === 'fast');
  const fastTrip = calcTrip(fast, vehicle);
  return (
    <div className="rt-noscroll h-full overflow-y-auto bg-[#F8F6F4] pb-32">
      <ScreenHeader title="Rota Planla" sub="3 rota, aracınıza göre fiyatlandı" />
      <div className="mx-5 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
        <div className="flex items-stretch gap-3">
          <div className="flex flex-col items-center py-2">
            <span className="h-3 w-3 rounded-full border-[3px] border-[#1E2022]" />
            <span className="my-1 w-px flex-1 border-l-2 border-dashed border-[#ECEEF2]" />
            <MapPin size={16} className="text-[#FF8A5B]" fill="#FFF1EB" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="border-b border-[#ECEEF2] pb-3">
              <p className="text-[12px] font-medium text-[#9CA3AF]">Başlangıç</p>
              <p className="truncate text-[15px] font-semibold text-[#1E2022]">Konumunuz • {START.name}</p>
            </div>
            <div className="pt-3">
              <p className="text-[12px] font-medium text-[#9CA3AF]">Varış</p>
              <p className="truncate text-[15px] font-semibold text-[#1E2022]">{dest.name} • {dest.sub}</p>
            </div>
          </div>
          <button type="button" onClick={onSwapDest} className="grid h-10 w-10 shrink-0 self-center place-items-center rounded-full bg-[#FFF1EB] text-[#E87344]" aria-label="Hedefi değiştir"><ArrowLeftRight size={17} /></button>
        </div>
        {stop && <p className="mt-3 flex items-center gap-2 rounded-xl bg-[#FFF1EB] px-3 py-2 text-[13px] font-medium text-[#E87344]"><Flag size={14} /> Ara durak: {stop.name} (+{stop.detour} dk)</p>}
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
                {m.station && <StationCard added={!!stop && stop.name.startsWith('Opet')} onAdd={onAddStation} />}
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
  const [destKey, setDestKey] = useState('is');
  const [selected, setSelected] = useState('eco');
  const [geoms, setGeoms] = useState(DESTINATIONS.is.fallback);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [modal, setModal] = useState(null); // 'add' | 'switch' | 'poi:fuel' | 'summary'
  const [toast, setToast] = useState(null);
  const [stop, setStop] = useState(null);
  const [nav, setNav] = useState(null); // { progress }
  const [summary, setSummary] = useState(null);
  const [query, setQuery] = useState('');
  const [listening, setListening] = useState(false);
  const [locateTick, setLocateTick] = useState(0);
  const [follow, setFollow] = useState(true);
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState([]);
  const [sync, setSync] = useState(supabase ? 'idle' : 'local'); // local | idle | syncing | ok | error
  const [newPass, setNewPass] = useState('');
  const loadedFor = useRef((() => { const st = store.get('routier_session', null); return st && !st.remote ? st.id : null; })());

  const dest = DESTINATIONS[destKey];
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

  /* ---- Gerçek rota geometrisi (OSRM). Ağ kısıtlıysa hazır geometri kullanılır ---- */
  useEffect(() => {
    const d = DESTINATIONS[destKey];
    setGeoms(d.fallback);
    let cancelled = false;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = setTimeout(() => ctrl && ctrl.abort(), 7000);
    const url = `${OSRM}${START.coord.join(',')};${d.coord.join(',')}?alternatives=3&overview=full&geometries=geojson`;
    fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('osrm'))))
      .then((j) => {
        if (cancelled || !j.routes || !j.routes.length) return;
        const rs = j.routes.map((r) => r.geometry.coordinates);
        setGeoms({ fast: rs[0], eco: rs[1] || d.fallback.eco, scenic: rs[2] || d.fallback.scenic });
      })
      .catch(() => { /* çevrimdışı/kısıtlı ortam: hazır geometri */ })
      .finally(() => clearTimeout(tm));
    return () => { cancelled = true; clearTimeout(tm); if (ctrl) ctrl.abort(); };
  }, [destKey]);

  /* ---- Rotalar + durak sapması ---- */
  const routes = useMemo(() => dest.routes.map((r) => (stop ? { ...r, min: r.min + stop.detour, km: Math.round((r.km + stop.detour * 0.3) * 10) / 10 } : r)), [dest, stop]);
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
    const rec = { id: Date.now(), dest: dest.name, km, min: Math.round(route.min * done), cost: t ? t.cost : 0, amount: t ? t.amount : 0, unit: t ? t.unit : 'L', saved: t && ft && selected !== 'fast' ? Math.max(0, ft.cost - t.cost) : 0, completed };
    setNav(null);
    setSummary(rec);
    if (km > 0.05) {
      setTrips((ts) => [rec, ...ts].slice(0, 50));
      cloudSync(() => cloud.addTrip(session.id, { ...rec, vehicleId: vehicle ? vehicle.id : null, routeType: selected }));
    }
    setModal('summary');
  }, [route, routes, vehicle, dest, selected, cloudSync, session]);

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
    if (!nav) return null;
    const p = nav.progress;
    const steps = dest.steps;
    let idx = 0;
    steps.forEach((s, i) => { if (p >= s.at) idx = i; });
    const next = steps[idx + 1];
    const toNext = next ? (next.at - p) * route.km : (1 - p) * route.km;
    const cur = next || { icon: Flag, text: `${dest.name} — hedefe varıyorsunuz` };
    const base = p < 0.12 ? 38 : p < 0.32 ? 56 : p < 0.72 ? 82 : p < 0.88 ? 61 : 34;
    const speed = Math.max(0, Math.round(base + Math.sin(p * 90) * 6));
    const inst = vehicle ? vehicle.consumption * route.factor * (speed > 70 ? 0.9 : speed < 40 ? 1.25 : 1.05) * (1 + Math.sin(p * 55) * 0.05) : null;
    const used = vehicle ? (route.km * p / 100) * vehicle.consumption * route.factor : null;
    return { step: cur, toNext, speed, inst, used, remainKm: route.km * (1 - p), remainMin: Math.max(0, Math.ceil(route.min * (1 - p))), limit: base > 70 ? 90 : base > 50 ? 70 : 50 };
  }, [nav, dest, route, vehicle]);

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
      return { text: `Altunizade'de yoğunluk var; Routier Eco rotası D-100 üzerinden akışı koruyor.\n• ${eco.min} dk • ${fmt1(eco.km)} km${e ? `\n• ${fmt(e.amount)} ${e.unit} • ${tl(e.cost)}${fastTrip ? ` (en hızlıya göre ${tl(Math.max(0, fastTrip.cost - e.cost))} tasarruf)` : ''}` : '\n• Maliyet için araç eklemen gerekiyor'}`, eco: true };
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

  const addStop = (s) => {
    setStop(s);
    setModal(null);
    showToast(`${s.name} rotaya eklendi (+${s.detour} dk)`, 'ok');
  };

  const pill = (k) => {
    if (k === 'ev' || k === 'is') {
      setDestKey(k);
      setStop(null);
      setSheetOpen(true);
      showToast(`Hedef: ${DESTINATIONS[k].name}`, 'ok');
    } else setModal(`poi:${k}`);
  };

  const submitSearch = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setQuery('');
    setTab('ai');
    sendAI(q);
  };

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
  const poiKey = modal && modal.startsWith('poi:') ? modal.slice(4) : null;
  const unit = vehicle ? FUELS[vehicle.fuelType].unit : 'L';

  return frame(
    <>
      {/* Harita her zaman arka planda */}
      <MapCanvas routes={geoms} selected={selected} start={START.coord} end={dest.coord} drive={nav ? nav.progress : null} follow={follow} onUserPan={() => setFollow(false)} locateTick={locateTick} onToast={showToast} />

      {/* ------------------ KEŞFET (HARİTA) ------------------ */}
      {tab === 'map' && !nav && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[max(14px,calc(env(safe-area-inset-top)+6px))] [&>*]:pointer-events-auto">
            <form onSubmit={submitSearch} className="flex h-[54px] items-center gap-3 rounded-full bg-white/85 pl-2 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.08)] ring-1 ring-white/60 backdrop-blur-md">
              <span className="shrink-0"><RoutierMark size={38} /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Routier'e sor veya hedef ara..." className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-[#1E2022] outline-none placeholder:text-[#6B7280]" />
              {query ? (
                <button type="submit" className="grid h-10 w-10 place-items-center rounded-full bg-[#FF8A5B] text-white" aria-label="Ara"><Search size={18} /></button>
              ) : (
                <button type="button" onClick={() => { setListening(true); setTab('ai'); showToast('Dinliyorum… komutunuzu söyleyin'); }} className="grid h-10 w-10 place-items-center rounded-full text-[#1E2022] hover:bg-[#FFF1EB]" aria-label="Sesli arama"><Mic size={20} /></button>
              )}
            </form>
            <div className="rt-noscroll -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
              {[['ev', 'Ev', Home], ['is', 'İş', Briefcase], ['fuel', 'En Ucuz Benzin', Fuel], ['cafe', 'Kafe', Coffee], ['charge', 'Şarj', Zap]].map(([k, l, I]) => {
                const on = k === destKey;
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
                  <div className="flex items-baseline gap-2">
                    <span className="rt-num text-[30px] font-extrabold leading-none text-[#1E2022]">{route.min} dk</span>
                    <span className="rt-num text-[15px] font-semibold text-[#6B7280]">{fmt1(route.km)} km</span>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13.5px] text-[#6B7280]">
                    <Clock size={14} className="shrink-0" />Varış <span className="rt-num font-semibold text-[#1E2022]">{clockPlus(route.min)}</span> • {dest.name}
                  </p>
                </div>
                <button type="button" onClick={() => setSheetOpen((o) => !o)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F8F6F4] text-[#6B7280]" aria-label="Detaylar">
                  {sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>

              {sheetOpen && (
                <div className="rt-fade">
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
                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1E2022]">Durak: {stop.name} <span className="text-[#6B7280]">(+{stop.detour} dk)</span></p>
                      <button type="button" onClick={() => { setStop(null); showToast('Durak rotadan kaldırıldı'); }} className="grid h-7 w-7 place-items-center rounded-full text-[#6B7280] hover:bg-white" aria-label="Durağı kaldır"><X size={15} /></button>
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

              <button type="button" onClick={startNav} className="mt-4 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A5B] text-[16px] font-bold text-white shadow-[0_8px_24px_rgba(255,138,91,0.35)] transition hover:bg-[#E87344] active:scale-[.99]">
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
          <RoutesScreen dest={dest} routes={routes} selected={selected} setSelected={setSelected} vehicle={vehicle} stop={stop}
            onShowMap={() => setTab('map')} onStart={startNav} onAddVehicle={() => setModal('add')}
            onSwapDest={() => { const k = destKey === 'is' ? 'ev' : 'is'; setDestKey(k); setStop(null); showToast(`Hedef: ${DESTINATIONS[k].name}`, 'ok'); }} />
        </div>
      )}
      {tab === 'ai' && !nav && (
        <div className="absolute inset-0 z-20">
          <AIScreen messages={messages} onSend={sendAI} typing={typing} stop={stop} listening={listening} setListening={setListening}
            onAddStation={() => addStop({ name: 'Opet - Atatürk Bulvarı', detour: 2 })}
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

      {poiKey && (
        <Sheet onClose={() => setModal(null)} title={POIS[poiKey].title}>
          <div className="space-y-2 pb-2">
            {POIS[poiKey].items.map((p) => {
              const I = POIS[poiKey].icon;
              const added = stop?.name === p.name;
              return (
                <div key={p.name} className="flex items-center gap-3 rounded-2xl bg-[#FAFAFA] p-3 ring-1 ring-[#ECEEF2]">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FFF1EB] text-[#FF8A5B]"><I size={19} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[14.5px] font-bold text-[#1E2022]">{p.name}</p>
                    <p className="rt-num truncate text-[12.5px] text-[#6B7280]">{p.meta} • +{p.detour} dk{p.best && <span className="ml-1 font-bold text-[#10B981]">• En iyi</span>}</p>
                  </div>
                  <button type="button" onClick={() => addStop({ name: p.name, detour: p.detour })} disabled={added}
                    className={`h-9 shrink-0 rounded-full px-3.5 text-[12.5px] font-bold ${added ? 'bg-[#ECFDF5] text-[#10B981]' : 'bg-[#FF8A5B] text-white'}`}>
                    {added ? 'Eklendi' : 'Rotaya Ekle'}
                  </button>
                </div>
              );
            })}
          </div>
        </Sheet>
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
