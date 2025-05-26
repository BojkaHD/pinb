require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const StellarSdk = require('stellar-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Stellar Server für Pi Testnet konfigurieren
const testnetServer = new StellarSdk.Server('https://api.testnet.minepi.com');
const networkPassphrase = 'Pi Testnet'; // Pi-spezifisches Netzwerk-Passphrase

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

// 1. Testnet-Zahlung mit Stellar SDK
app.post('/send-test-payment', validateApiKey, async (req, res) => {
  try {
    const { recipient, amount = "1" } = req.body;

    if (!recipient || !recipient.startsWith('G')) {
      return res.status(400).json({ error: "Ungültige Wallet-Adresse" });
    }

    // Quelle Wallet laden
    const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.TESTNET_SECRET);
    const sourceAccount = await testnetServer.loadAccount(sourceKeypair.publicKey());

    // Transaktion erstellen
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: networkPassphrase
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: recipient,
        asset: StellarSdk.Asset.native(),
        amount: amount.toString()
      }))
      .setTimeout(30)
      .build();

    // Transaktion signieren und senden
    transaction.sign(sourceKeypair);
    const result = await testnetServer.submitTransaction(transaction);

    console.log(`✅ Zahlung an ${recipient} erfolgreich:`, result.hash);
    
    res.json({
      success: true,
      txid: result.hash,
      explorer: `https://testnet.minepi.com/explorer/tx/${result.hash}`
    });

  } catch (error) {
    console.error('❌ Fehler bei Testnet-Zahlung:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// 2. Mainnet-Zahlung mit Pi Platform API
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
        uid: uid,
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
    const errorData = error.response?.data || { error: "Unbekannter Fehler" };
    console.error("Fehler bei Pi Platform API:", errorData);
    res.status(500).json({
      error: "Zahlung fehlgeschlagen",
      piError: errorData
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