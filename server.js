require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const StellarSdk = require('stellar-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. KORREKTE PI TESTNET-KONFIGURATION
const server = new StellarSdk.Server('https://api.testnet.minepi.com');
const piAsset = new StellarSdk.Asset(
  "PI", 
  "GCGNUBSMGBJAYB3YNOZQ5XYP5BWMNSOMUES5VGLUJKHZYBSS2N25D2LZ"
);

// 2. CORS-KONFIGURATION
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

// 3. VALIDIERUNGS-MIDDLEWARE
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!process.env.TESTNET_SECRET) { // 🔥 PI_API_KEY nicht mehr nötig
    return res.status(500).json({ error: "TESTNET_SECRET nicht gesetzt" });
  }

  if (apiKey !== process.env.INTERNAL_API_KEY) {
    console.warn('🚫 Unauthorisierter API-Key Versuch:', apiKey);
    return res.status(403).json({ error: "Unautorisiert" });
  }
  
  next();
};

// 4. TESTNET-ZAHLUNGEN
app.post('/send-test-payment', validateApiKey, async (req, res) => {
  try {
    const { recipient, amount = "1" } = req.body;

    // Validierung
    if (!recipient?.startsWith('G')) {
      return res.status(400).json({ error: "Ungültige Wallet-Adresse" });
    }

    // Wallet & Transaktion
    const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.TESTNET_SECRET);
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: 100000,
      networkPassphrase: "Pi Testnet" // 🔥 Case-sensitive!
    })
    .addOperation(StellarSdk.Operation.payment({
      destination: recipient,
      asset: piAsset,
      amount: amount.toString()
    }))
    .setTimeout(30)
    .build();

    transaction.sign(sourceKeypair);
    const result = await server.submitTransaction(transaction);

    res.json({ 
      success: true,
      txid: result.hash,
      explorer: `https://testnet.minepi.com/explorer/tx/${result.hash}`
    });

  } catch (error) {
    console.error('❌ Testnet-Fehler:', error.response?.data || error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Server-Start
app.listen(PORT, () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  console.log(`🔐 TESTNET_SECRET: ${process.env.TESTNET_SECRET ? "✅" : "❌"}`);
  console.log(`🔒 INTERNAL_API_KEY: ${process.env.INTERNAL_API_KEY ? "✅" : "❌"}`);
});