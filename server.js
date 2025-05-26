require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      callback(null, true);
    } else {
      callback(new Error(`🚫 Blockierter Origin: ${origin}`));
    }
  }
}));

app.use(bodyParser.json());

const validateApiKey = (req, res, next) => {
  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: "PI_API_KEY nicht konfiguriert" });
  }
  next();
};

// 1. Zahlung erstellen
app.post('/create-payment', validateApiKey, async (req, res) => {
  try {
    const { amount, memo, to } = req.body; // "to" = Wallet-Adresse

    if (!to) throw new Error("Empfänger-Adresse fehlt");

    const paymentPayload = {
      amount,
      memo: memo || "App to User Zahlung",
      to,  // Wallet-Adresse als String
      metadata: { type: "app-to-user-payment" }
    };

    const response = await axios.post(
      "https://api.minepi.com/v2/payments",
      paymentPayload,
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ paymentId: response.data.identifier });
  } catch (error) {
    console.error("Fehler beim Erstellen der Zahlung:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});


// 2. Zahlung genehmigen
app.post('/approve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "paymentId fehlt" });

    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {},
      { headers: { Authorization: `Key ${process.env.PI_API_KEY}` } }
    );

    res.json({ status: 'approved', data: response.data });
  } catch (error) {
    console.error("Fehler beim Genehmigen der Zahlung:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// 3. Zahlung abschließen
app.post('/complete-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId, txid } = req.body;
    if (!paymentId || !txid) return res.status(400).json({ error: "paymentId und txid erforderlich" });

    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      { headers: { Authorization: `Key ${process.env.PI_API_KEY}` } }
    );

    res.json({ status: 'completed', data: response.data });
  } catch (error) {
    console.error("Fehler beim Abschließen der Zahlung:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  console.log(`🔑 PI_API_KEY: ${process.env.PI_API_KEY ? "✅ vorhanden" : "❌ fehlt"}`);
});
