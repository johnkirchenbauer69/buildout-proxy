const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 86400 }); // 24-hour cache
const app = express();
const PORT = process.env.PORT || 3000;

// Buildout API
const BUILDOUT_API_URL = 'https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/properties.json';
const PAGE_LIMIT = 1000;

app.use(cors());

// In-memory listings cache
let listingsCache = [];
let listingsLastUpdated = null;

// Helper: Fetch all listings with pagination
async function fetchAllListings() {
  let allListings = [];
  let offset = 0;

  while (true) {
    const url = `${BUILDOUT_API_URL}?limit=${PAGE_LIMIT}&offset=${offset}`;
    console.log(`Fetching: ${url}`);
    const res = await axios.get(url);
    const { properties = [], count } = res.data;
    allListings = allListings.concat(properties);
    if (properties.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return allListings;
}

// Load listings cache
async function loadCache() {
  try {
    console.log('⏳ Loading listings from Buildout...');
    listingsCache = await fetchAllListings();
    listingsLastUpdated = new Date();
    console.log(`✅ Listings cache loaded: ${listingsCache.length} listings.`);
  } catch (err) {
    console.error('❌ Error loading listings:', err.message);
    listingsCache = [];
    listingsLastUpdated = null;
  }
}

// Route: GET listings from cache
app.get('/api/listings', (req, res) => {
  res.json({
    properties: listingsCache,
    last_updated: listingsLastUpdated,
    count: listingsCache.length
  });
});

// Route: POST manual refresh (optional)
app.post('/api/refresh', async (req, res) => {
  await loadCache();
  res.json({ refreshed: true, count: listingsCache.length });
});

// Route: GET refresh for Render CRON job
app.get('/refresh', async (req, res) => {
  try {
    console.log('🔁 Refresh triggered via /refresh route');
    await loadCache();
    res.json({ refreshed: true, count: listingsCache.length });
  } catch (error) {
    console.error('❌ Refresh error:', error.message);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// Route: GET brokers (cached after first call)
let brokersCache = [];
app.get('/api/brokers', async (req, res) => {
  if (brokersCache.length) return res.json({ brokers: brokersCache });
  try {
    const resp = await axios.get('https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/brokers.json');
    brokersCache = resp.data.brokers || [];
    res.json({ brokers: brokersCache });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch brokers' });
  }
});

// Route: GET lease spaces (cached)
app.get('/api/lease_spaces', async (req, res) => {
  const cacheKey = 'lease_spaces';
  const cached = cache.get(cacheKey);

  if (cached) {
    return res.json(cached);
  }

  try {
    const response = await axios.get('https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/lease_spaces.json', {
      params: { limit: 1000 }
    });
    cache.set(cacheKey, response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Error fetching lease spaces:", error.message);
    res.status(500).json({ error: 'Failed to fetch lease spaces', message: error.message });
  }
});

// Start server and load listings on boot
app.listen(PORT, async () => {
  await loadCache();
  console.log(`✅ Proxy server running on port ${PORT}`);
});
