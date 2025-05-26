require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const StellarSdk = require('stellar-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. PI TESTNET-KONFIGURATION (gemäß Pi-Dokumentation)
const server = new StellarSdk.Horizon.Server('https://api.testnet.minepi.com');
const networkPassphrase = "Pi Network"; // 👈 Offizielle Passphrase
const piIssuer = "GCGNUBSMGBJAYB3YNOZQ5XYP5BWMNSOMUES5VGLUJKHZYBSS2N25D2LZ";

// 2. ISSUER-VALIDIERUNG (Kritisch!)
if (!StellarSdk.StrKey.isValidEd25519PublicKey(piIssuer)) {
  console.error("❌ FATAL: Ungültige Issuer-Adresse");
  process.exit(1);
}

const piAsset = new StellarSdk.Asset("PI", piIssuer);

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

//Test-Zahlungen
app.post('/send-test-payment', validateApiKey, async (req, res) => {
  try {
    const { recipient, amount = "1" } = req.body;

    // Wallet laden
    const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.TESTNET_SECRET);
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    // Transaktion erstellen
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: 1000000, // 0.1 PI (gemäß Pi-Doku)
      networkPassphrase: networkPassphrase
    })
    .addOperation(StellarSdk.Operation.payment({
      destination: recipient,
      asset: piAsset,
      amount: amount.toString()
    }))
    .setTimeout(30)
    .build();

    // Transaktion signieren & senden
    transaction.sign(sourceKeypair);
    const result = await server.submitTransaction(transaction, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" } // 👈 Pi-API-Requirement
    });

    res.json({ 
      success: true,
      txid: result.hash,
      explorer: `https://testnet.minepi.com/explorer/tx/${result.hash}`
    });

  } catch (error) {
    console.error('❌ Pi Testnet-Fehler:', error.response?.data || error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});