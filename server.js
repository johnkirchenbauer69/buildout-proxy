const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/listings', async (req, res) => {
  try {
    const response = await axios.get('https://buildout.com/api/v1/ad60e63d545c98569763dd4b3bf32816b6f1b755/properties.json');
    res.json(response.data);
  } catch (error) {
    console.error("❌ Buildout API fetch error:", error.message);
    res.status(500).json({ error: 'Failed to fetch listings', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
});
