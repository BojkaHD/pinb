// backend/server.js
const axios = require('axios');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Verwende den von Render bereitgestellten Port oder Standard-Port 3000
const PORT = process.env.PORT || 3000;

// ✅ CORS-Konfiguration: Erlaube nur deine Live-Domain
const allowedOrigins = ['https://pinb.app','https://sandbox.minepi.com/mobile-app-ui/app/pnb-c7bb42c2c289a5f4'];

 // Ersetze mit deiner tatsächlichen Frontend-Domain

const corsOptions = {
  origin: function (origin, callback) {
    // Erlaube Anfragen ohne Origin (z. B. von mobilen Apps oder Curl)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Nicht erlaubter Origin: ' + origin));
    }
  },
};

app.use(cors(corsOptions));

// JSON-Body-Parser aktivieren
app.use(bodyParser.json());

// POST-Route zur Zahlungsfreigabe
app.post('/approve-payment', async (req, res) => {
  const { paymentId } = req.body;

  try {
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status === 200) {
      res.json({ approved: true });
    } else {
      res.status(500).json({ error: 'Genehmigung fehlgeschlagen' });
    }
  } catch (error) {
    console.error('❌ Fehler bei der Genehmigung:', error);
    res.status(500).json({ error: 'Genehmigung fehlgeschlagen' });
  }
});

app.post('/complete-payment', async (req, res) => {
  const { paymentId } = req.body;

  try {
    // ✅ Bestätige Abschluss bei Pi
    await pi.completePayment(paymentId); 
    res.json({ completed: true });
  
  } catch (error) {
    console.error('❌ Fehler bei Completion:', error);
    res.status(500).json({ error: 'Abschluss fehlgeschlagen' });
  }
});

// Optionale GET-Route für die Root-URL (nützlich für Tests)
app.get('/', (req, res) => {
  res.send('✅ Pi Payment Backend läuft');
});

// Starte den Server
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
