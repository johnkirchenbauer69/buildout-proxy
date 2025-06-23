const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache'); 
const cache = new NodeCache({ stdTTL: 86400 }); // Cache for 24 hours

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Listings endpoint with cache
app.get('/api/listings', async (req, res) => {
  const cacheKey = 'listings';
  const cached = cache.get(cacheKey);

  if (cached) {
    return res.json(cached); // Serve cached
  }

  try {
    const params = {
  limit: req.query.limit || 30,
  offset: req.query.offset || 0
};

const response = await axios.get(
  'https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/properties.json',
  { params }
);

    cache.set(cacheKey, response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Buildout API fetch error:", error.message);
    res.status(500).json({ error: 'Failed to fetch listings', message: error.message });
  }
});

// Brokers endpoint with cache
app.get('/api/brokers', async (req, res) => {
  const cacheKey = 'brokers';
  const cached = cache.get(cacheKey);

  if (cached) {
    return res.json(cached); // Serve cached
  }

  try {
    const response = await axios.get('https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/brokers.json');
    cache.set(cacheKey, response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Error fetching brokers:", error.message);
    res.status(500).json({ error: 'Failed to fetch brokers' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
});
