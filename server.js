// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Erlaube nur definierte Ursprünge (deine Domains)
const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com/mobile-app-ui/app/pnb-c7bb42c2c289a5f4',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Nicht erlaubter Origin: ' + origin));
    }
  },
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// ✅ Zahlung automatisch genehmigen
app.post('/approve-payment', async (req, res) => {
  const { paymentId } = req.body;
  console.log('🟢 Zahlung empfangen:', paymentId);

  try {
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200) {
      console.log('✅ Zahlung genehmigt:', paymentId);
      res.json({ approved: true });
    } else {
      console.error('❌ Genehmigung fehlgeschlagen:', response.status);
      res.status(500).json({ error: 'Genehmigung fehlgeschlagen' });
    }
  } catch (error) {
    console.error('❌ Fehler bei Genehmigung:', error.response?.data || error.message);
    res.status(500).json({ error: 'Fehler bei Genehmigung' });
  }
});

// ✅ Zahlung automatisch abschließen
app.post('/complete-payment', async (req, res) => {
  const { paymentId } = req.body;
  console.log('🟢 Abschluss empfangen:', paymentId);

  try {
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200) {
      console.log('✅ Zahlung abgeschlossen:', paymentId);
      res.json({ completed: true });
    } else {
      console.error('❌ Abschluss fehlgeschlagen:', response.status);
      res.status(500).json({ error: 'Abschluss fehlgeschlagen' });
    }
  } catch (error) {
    console.error('❌ Fehler bei Abschluss:', error.response?.data || error.message);
    res.status(500).json({ error: 'Fehler bei Abschluss' });
  }
});

// Test-Endpunkt
app.get('/', (req, res) => {
  res.send('✅ Pi Payment Backend läuft');
});

app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
