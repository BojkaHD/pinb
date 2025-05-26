require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createPayment } = require('@pi-blockchain/core');

const app = express();
const PORT = process.env.PORT || 3000;

// Sicherheitskonfiguration
const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      callback(null, true);
    } else {
      console.warn(`🚫 Blockierter Origin: ${origin}`);
      callback(new Error('Nicht erlaubt durch CORS'));
    }
  }
}));

app.use(bodyParser.json());

// Erweiterte Authentifizierung
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!process.env.PI_API_KEY || !process.env.TESTNET_SECRET) {
    return res.status(500).json({ error: "Umgebungsvariablen nicht konfiguriert" });
  }

  if (apiKey !== process.env.INTERNAL_API_KEY) {
    console.warn('🚫 Unauthorisierter API-Key Versuch:', apiKey);
    return res.status(403).json({ error: "Unautorisiert" });
  }
  
  next();
};

// 1. Zahlung via Blockchain (Testnet)
app.post('/send-test-payment', validateApiKey, async (req, res) => {
  try {
    const { recipient, amount = "1" } = req.body;

    if (!recipient || !recipient.startsWith('G')) {
      return res.status(400).json({ error: "Ungültige Wallet-Adresse" });
    }

    const payment = await createPayment({
      recipientAddress: recipient,
      amount: amount.toString(),
      memo: "Testzahlung vom App-Wallet",
      privateKey: process.env.TESTNET_SECRET,
      network: "Testnet"
    });

    console.log(`✅ Zahlung an ${recipient} erfolgreich:`, payment.txid);
    
    res.json({
      success: true,
      txid: payment.txid,
      explorer: `https://testnet.minepi.com/explorer/tx/${payment.txid}`
    });

  } catch (error) {
    console.error(`❌ Fehler bei Blockchain-Zahlung:`, error.message);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// 2. Legacy: Zahlung via Platform API (UID)
app.post('/create-payment', validateApiKey, async (req, res) => {
  try {
    const { amount, memo, uid } = req.body;

    if (!amount || !uid) {
      return res.status(400).json({ error: "Fehlende Parameter" });
    }

    const response = await axios.post(
      "https://api.minepi.com/v2/payments",
      {
        amount: amount.toString(),
        memo: memo || "App to User Zahlung",
        uid,
        metadata: { type: "app-to-user-payment" }
      },
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ 
      paymentId: response.data.identifier,
      approvalUrl: response.data.url 
    });

  } catch (error) {
    console.error("Fehler bei Platform API:", error.response?.data);
    res.status(500).json({
      error: "Zahlung fehlgeschlagen",
      piError: error.response?.data
    });
  }
});

// Server-Start
app.listen(PORT, () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  console.log(`🔑 PI_API_KEY: ${process.env.PI_API_KEY ? "✅" : "❌"}`);
  console.log(`🔐 TESTNET_SECRET: ${process.env.TESTNET_SECRET ? "✅" : "❌"}`);
  console.log(`🔒 INTERNAL_API_KEY: ${process.env.INTERNAL_API_KEY ? "✅" : "❌"}`);
});