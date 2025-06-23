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
    const response = await axios.get('https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/properties.json');
    cache.set(cacheKey, response.data);
    res.json(response.data);
  } catch (error) {
    // Robust error logging!
    if (error.response) {
      // Buildout responded with an error status code
      console.error("❌ Buildout API error:", {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
      res.status(error.response.status).json({
        error: 'Failed to fetch listings',
        status: error.response.status,
        data: error.response.data,
        message: error.message
      });
    } else {
      // Network or unknown error
      console.error("❌ Buildout API fetch error (network?):", error.message);
      res.status(500).json({ error: 'Failed to fetch listings', message: error.message });
    }
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
    // Robust error logging!
    if (error.response) {
      console.error("❌ Buildout API brokers error:", {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
      res.status(error.response.status).json({
        error: 'Failed to fetch brokers',
        status: error.response.status,
        data: error.response.data,
        message: error.message
      });
    } else {
      console.error("❌ Error fetching brokers (network?):", error.message);
      res.status(500).json({ error: 'Failed to fetch brokers', message: error.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
});
