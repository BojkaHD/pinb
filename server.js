require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Nur deine Domains zulassen
const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com/mobile-app-ui/app/pnb-c7bb42c2c289a5f4',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('❌ Nicht erlaubter Origin: ' + origin));
    }
  },
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// ✅ Zahlung genehmigen
app.post('/approve-payment', async (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) {
    return res.status(400).json({ error: '❌ paymentId fehlt' });
  }

  console.log('🟢 Zahlung zur Genehmigung empfangen:', paymentId);

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
      console.error('❌ Unerwartete Antwort:', response.status);
      res.status(500).json({ error: 'Genehmigung fehlgeschlagen' });
    }
  } catch (error) {
    console.error('❌ Genehmigungsfehler:', error.response?.data || error.message);
    res.status(500).json({ error: 'Genehmigungsfehler' });
  }
});

// ✅ Zahlung abschließen (jetzt MIT txid!)
app.post('/complete-payment', async (req, res) => {
  const { paymentId, txid } = req.body;
  if (!paymentId || !txid) {
    return res.status(400).json({ error: '❌ paymentId oder txid fehlt' });
  }

  console.log(`🟢 Zahlung zum Abschluss empfangen: ${paymentId}, txid: ${txid}`);

  try {
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
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

app.post('/cancel-payment', async (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId fehlt' });
  }

  try {
    const result = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    res.json({ cancelled: true, result: result.data });
  } catch (error) {
    res.status(500).json({ error: 'Abbruch fehlgeschlagen', details: error.message });
  }
});

// Test-Endpunkt
app.get('/', (req, res) => {
  res.send('✅ Pi Payment Backend läuft');
});

// Serverstart
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
