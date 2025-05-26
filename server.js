require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const StellarSdk = require('stellar-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const Keypair = StellarSdk.Keypair;
const Networks = StellarSdk.Networks;
const TransactionBuilder = StellarSdk.TransactionBuilder;
const Operation = StellarSdk.Operation;
const Asset = StellarSdk.Asset;
const Memo = StellarSdk.Memo;
const stellarServer = new StellarSdk.Server("https://api.testnet.minepi.com");

// ✅ Testnet-Konfiguration
const TESTNET_SECRET = process.env.TESTNET_SECRET; // App Wallet (Secret Key)
const SOURCE_KEYPAIR = Keypair.fromSecret(TESTNET_SECRET);


// ✅ Erlaubte Domains
const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com'
];

// ✅ CORS
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

// ✅ API-Key Middleware
const validateApiKey = (req, res, next) => {
  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: "PI_API_KEY nicht konfiguriert" });
  }
  next();
};

// ✅ Zahlung erstellen (App → User)
app.post('/create-payment', async (req, res) => {
  try {
    const { amount, memo, to } = req.body;
    const account = await stellarServer.loadAccount(SOURCE_KEYPAIR.publicKey());
    const fee = await stellarServer.fetchBaseFee();

    const tx = new TransactionBuilder(account, {
      fee,
      networkPassphrase: Networks.TESTNET,
      memo: memo ? Memo.text(memo) : undefined
    })
      .addOperation(Operation.payment({
        destination: to,
        asset: Asset.native(),
        amount: amount.toString()
      }))
      .setTimeout(30)
      .build();

    tx.sign(SOURCE_KEYPAIR);
    const result = await stellarServer.submitTransaction(tx);

    res.json({ paymentId: result.id, hash: result.hash });
  } catch (error) {
    console.error("❌ Zahlungsfehler:", error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Zahlung genehmigen
app.post('/approve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) throw new Error("paymentId fehlt");

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

    res.json({ status: 'approved', piData: response.data });

  } catch (error) {
    const piError = error.response?.data || error.message;
    console.error("APPROVE ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

// ✅ Zahlung abschließen
app.post('/complete-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId, txid } = req.body;
    if (!paymentId || !txid) throw new Error("paymentId/txid fehlt");

    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ status: 'completed', piData: response.data });

  } catch (error) {
    const piError = error.response?.data || error.message;
    console.error("COMPLETE ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

// 🛑 Zahlung abbrechen
app.post('/cancel-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) throw new Error("paymentId fehlt");

    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ status: 'cancelled', piData: response.data });

  } catch (error) {
    const piError = error.response?.data?.error_message || error.message;
    console.error("CANCEL ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

// 🛠️ Debug: Manuelle Status-Korrektur
app.post('/force-resolve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) throw new Error("paymentId fehlt");

    const statusCheck = await axios.get(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      { headers: { Authorization: `Key ${process.env.PI_API_KEY}` } }
    );

    const paymentStatus = statusCheck.data.status;
    let action = 'none';

    if (paymentStatus.developer_approved === false) {
      await axios.post(
        `https://api.minepi.com/v2/payments/${paymentId}/approve`,
        {},
        { headers: { Authorization: `Key ${process.env.PI_API_KEY}` } }
      );
      action = 'approved';
    }

    if (paymentStatus.transaction_verified && !paymentStatus.developer_completed) {
      await axios.post(
        `https://api.minepi.com/v2/payments/${paymentId}/complete`,
        { txid: "MANUAL_OVERRIDE" },
        { headers: { Authorization: `Key ${process.env.PI_API_KEY}` } }
      );
      action = 'completed';
    }

    res.json({ status: 'forced_resolution', originalStatus: paymentStatus, actionTaken: action });

  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ✅ Server starten
app.listen(PORT, () => {
  console.log(`🚀 Backend aktiv auf Port ${PORT}`);
  console.log(`🔐 API-Key: ${process.env.PI_API_KEY ? "✅ Konfiguriert" : "❌ Fehlt!"}`);
});
