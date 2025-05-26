require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com',
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

// API-Key Middleware
const validateApiKey = (req, res, next) => {
  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: "PI_API_KEY nicht konfiguriert" });
  }
  next();
};

// 1. Zahlung erstellen (App -> User)
app.post('/create-payment', validateApiKey, async (req, res) => {
  try {
    const { amount, memo, userId, walletId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId fehlt" });
    if (!amount) return res.status(400).json({ error: "Betrag fehlt" });
    if (!walletId) return res.status(400).json({ error: "walletId fehlt" });

    const payload = {
      amount: amount.toString(),
      memo: memo || "Manuelle App2User Zahlung",
      userId:"7b5e0587-e960-4b6c-8808-6c8c00c71632",  // Korrekt geschrieben
      walletId:"GAYLAU5ERVRDRNNMLLKTRJNSRO5AXGMCVMSEJZRVPYLDEB5OKQQMP5DB",
      metadata: { type: "app-to-user-payment" }
    };

    const paymentRes = await axios.post("https://api.minepi.com/v2/payments", payload, {
      headers: {
        Authorization: `Key ${process.env.PI_API_KEY}`, // Rechtschreibung korrigiert
        "Content-Type": "application/json"
      }
    });

    res.json({ paymentId: paymentRes.data.identifier });
  } catch (error) {
    console.error("Fehler beim Erstellen der Zahlung:", error.response?.data || error.message); // Rechtschreibung korrigiert
    res.status(500).json({ error: error.response?.data || error.message });
  }
});


// 2. Zahlung genehmigen (Developer Approval)
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

// 3. Zahlung abschließen (Transaction ID angeben)
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

app.listen(PORT, () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  console.log(`🔐 PI_API_KEY: ${process.env.PI_API_KEY ? "✅ vorhanden" : "❌ fehlt"}`);
});