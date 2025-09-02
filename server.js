const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.set('trust proxy', true); // get correct client IP from x-forwarded-for
const PORT = process.env.PORT || 3000;

// --- Buildout API ---
const BUILDOUT_BASE =
  'https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755';
const BUILDOUT_API_URL = `${BUILDOUT_BASE}/properties.json`;
const PAGE_LIMIT = 1000;

// --- Disk cache (prefer persistent disk mount if present) ---
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'listings.json');

function ensureDataDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
  catch (e) { console.error('❌ ensureDataDir:', e.message); }
}

function readCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.properties)) return parsed;
  } catch (_) {}
  return { properties: [], last_updated: null, count: 0 };
}

function writeCacheToDisk(payload) {
  try {
    ensureDataDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('❌ Failed to write cache:', e.message);
  }
}

// --- In-memory cache ---
let listingsCache = [];
let listingsLastUpdated = null;

// --- Helpers: retry + page fetch ---
async function requestWithRetry(url, { attempts = 6, baseDelay = 800 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'lee-associates-buildout-proxy/1.0' }
      });
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // Retry on 429/5xx and network timeouts
      if (status === 429 || (status >= 500 && status <= 599) || err.code === 'ECONNABORTED') {
        const delay = Math.round(baseDelay * Math.pow(1.6, i) + Math.random() * 250);
        console.warn(`⚠️  ${status || err.code} on ${url} — retrying in ${delay}ms (${i + 1}/${attempts})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err; // other errors: give up immediately
    }
  }
  throw lastErr;
}

async function fetchAllListings() {
  let all = [];
  let offset = 0;

  while (true) {
    const url = `${BUILDOUT_API_URL}?limit=${PAGE_LIMIT}&offset=${offset}`;
    console.log(`Fetching: ${url}`);
    const res = await requestWithRetry(url);
    const { properties = [] } = res.data;
    all = all.concat(properties);
    if (properties.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return all;
}

// --- Load/refresh logic with fallback ---
let isRefreshing = false;

async function loadCache() {
  if (isRefreshing) {
    console.log('ℹ️  Refresh already in progress; skipping.');
    return;
  }
  isRefreshing = true;
  try {
    // Prefer serving something immediately on boot
    if (!listingsCache.length) {
      const disk = readCacheFromDisk();
      if (disk.properties.length) {
        listingsCache = disk.properties;
        listingsLastUpdated = disk.last_updated ? new Date(disk.last_updated) : null;
        console.log(`ℹ️  Primed from disk cache: ${listingsCache.length} listings.`);
      }
    }

    console.log('⏳ Loading listings from Buildout...');
    const properties = await fetchAllListings();
    listingsCache = properties;
    listingsLastUpdated = new Date();

    const payload = {
      properties,
      last_updated: listingsLastUpdated,
      count: properties.length
    };
    writeCacheToDisk(payload);

    console.log(`✅ Listings cache loaded: ${listingsCache.length} listings.`);
  } catch (err) {
    const status = err?.response?.status;
    console.error('❌ Error loading listings:', status || err.message);
    // DO NOT clear cache on failure; continue serving last good
    if (!listingsCache.length) {
      const disk = readCacheFromDisk();
      listingsCache = disk.properties || [];
      listingsLastUpdated = disk.last_updated ? new Date(disk.last_updated) : null;
      console.log(`ℹ️  Serving ${listingsCache.length} listings from disk cache.`);
    } else {
      console.log(`ℹ️  Keeping previous in-memory cache: ${listingsCache.length} listings.`);
    }
  } finally {
    isRefreshing = false;
  }
}

// --- API ---
app.use(cors());
app.use((req, _res, next) => {
  const isRefresh = req.path === '/refresh' || req.path.startsWith('/api/refresh');
  if (isRefresh) {
    const ip =
      (req.headers['x-forwarded-for']?.split(',')[0] || '').trim() ||
      req.ip;
    const ua = req.get('user-agent') || '';
    console.log(
      `[refresh] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ip=${ip} ua=${ua}`
    );
  }
  next();
});

app.get('/api/listings', (_req, res) => {
  res.json({
    properties: listingsCache,
    last_updated: listingsLastUpdated,
    count: listingsCache.length
  });
});

app.get('/api/brokers', async (_req, res) => {
  try {
    const resp = await requestWithRetry(`${BUILDOUT_BASE}/brokers.json`);
    res.json({ brokers: resp.data.brokers || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch brokers' });
  }
});

app.get('/api/lease_spaces', async (_req, res) => {
  try {
    const resp = await requestWithRetry(`${BUILDOUT_BASE}/lease_spaces.json?limit=1000`);
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lease spaces' });
  }
});

// Manual refresh endpoints
app.post('/api/refresh', async (_req, res) => {
  await loadCache();
  res.json({ refreshed: true, count: listingsCache.length });
});
app.get('/refresh', async (_req, res) => {
  console.log('🔁 Refresh triggered via /refresh route');
  await loadCache();
  res.json({ refreshed: true, count: listingsCache.length });
});

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true, count: listingsCache.length, last_updated: listingsLastUpdated });
});

// Start
app.listen(PORT, async () => {
  // Load disk snapshot immediately (fast), then try remote refresh
  const disk = readCacheFromDisk();
  if (disk.properties.length) {
    listingsCache = disk.properties;
    listingsLastUpdated = disk.last_updated ? new Date(disk.last_updated) : null;
    console.log(`ℹ️  Boot: loaded ${listingsCache.length} from disk.`);
  }
  await loadCache();
  console.log(`✅ Proxy server running on port ${PORT}`);
});
