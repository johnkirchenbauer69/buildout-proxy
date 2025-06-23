const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');    // <-- Add this!
const cache = new NodeCache({ stdTTL: 86400 }); // <-- And this!
// This is a simple Express server that fetches and serves real estate listings from Buildout's API.

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory cache
let listingsCache = [];
let listingsLastUpdated = null;

// Buildout API info
const BUILDOUT_API_URL = 'https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/properties.json';
const PAGE_LIMIT = 1000; // Set to 1000 (max) or your known "enough" value

app.use(cors());

// Helper: Fetch ALL pages of listings
async function fetchAllListings() {
  let allListings = [];
  let offset = 0;

  while (true) {
    const url = `${BUILDOUT_API_URL}?limit=${PAGE_LIMIT}&offset=${offset}`;
    console.log(`Fetching: ${url}`);
    const res = await axios.get(url);
    const { properties = [], count } = res.data;
    allListings = allListings.concat(properties);
    if (properties.length < PAGE_LIMIT) break; // Got last page
    offset += PAGE_LIMIT;
  }

  return allListings;
}

// On startup: Load listings
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

// Listings endpoint (serves from cache only)
app.get('/api/listings', (req, res) => {
  res.json({
    properties: listingsCache,
    last_updated: listingsLastUpdated,
    count: listingsCache.length
  });
});

// (Optional) Manual refresh endpoint
app.post('/api/refresh', async (req, res) => {
  await loadCache();
  res.json({ refreshed: true, count: listingsCache.length });
});

// Also preload brokers (optional)
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

// Lease Spaces endpoint with cache
app.get('/api/lease_spaces', async (req, res) => {
  const cacheKey = 'lease_spaces';
  const cached = cache.get(cacheKey);

  if (cached) {
    return res.json(cached); // Serve cached
  }

  try {
    // You might need to adjust the limit for your API!
    const response = await axios.get('https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/lease_spaces.json', {
      params: { limit: 1000 } // Increase if your org has more than 1000 spaces!
    });
    cache.set(cacheKey, response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Error fetching lease spaces:", error.message);
    res.status(500).json({ error: 'Failed to fetch lease spaces', message: error.message });
  }
});

// Start server & load cache on boot
app.listen(PORT, async () => {
  await loadCache(); // <-- Preload listings before serving
  console.log(`✅ Proxy server running on port ${PORT}`);
});
