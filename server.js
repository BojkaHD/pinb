require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const StellarSdk = require('stellar-sdk');
const Server = new StellarSdk.Server("https://api.testnet.minepi.com");


const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Erlaubte Domains (Frontend + Pi-Sandbox)
const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com'
];

// 🔒 CORS-Sicherheit
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

// 🔍 API-Key Validierung Middleware
const validateApiKey = (req, res, next) => {
  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: "PI_API_KEY nicht konfiguriert" });
  }
  next();
};

// server.js
const { Keypair, Server, Networks, TransactionBuilder, Operation, Asset } = require("stellar-sdk");

const TESTNET_SECRET = process.env.TESTNET_SECRET; // App-Wallet (Sender)
const server = new Server("https://api.testnet.minepi.com");

app.post('/create-payment', async (req, res) => {
  try {
    const { amount, memo, to } = req.body;
    const senderKeypair = Keypair.fromSecret(TESTNET_SECRET);
    const account = await server.loadAccount(senderKeypair.publicKey());

    const fee = await server.fetchBaseFee();
    const transaction = new TransactionBuilder(account, {
      fee,
      networkPassphrase: Networks.TESTNET,
      memo: memo ? Memo.text(memo) : undefined,
    })
      .addOperation(Operation.payment({
        destination: to,
        asset: Asset.native(),
        amount: amount.toString()
      }))
      .setTimeout(30)
      .build();

    transaction.sign(senderKeypair);
    const result = await server.submitTransaction(transaction);

    res.json({ paymentId: result.id, hash: result.hash });
  } catch (error) {
    console.error("❌ Zahlungsfehler:", error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});


// ✅ Zahlung genehmigen (Developer Approval)
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

    res.json({ 
      status: 'approved',
      piData: response.data 
    });

  } catch (error) {
    const piError = error.response?.data || error.message;
    console.error("APPROVE ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

// ✅ Zahlung abschließen (mit Blockchain TXID)
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

    res.json({ 
      status: 'completed',
      piData: response.data 
    });

  } catch (error) {
    const piError = error.response?.data || error.message;
    console.error("COMPLETE ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

// 🚨 Zahlung abbrechen (Nur für Notfälle)
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

    res.json({ 
      status: 'cancelled',
      piData: response.data 
    });

  } catch (error) {
    const piError = error.response?.data?.error_message || error.message;
    console.error("CANCEL ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

// 🛠️ Debug-Endpunkt für hängige Zahlungen
app.post('/force-resolve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) throw new Error("paymentId fehlt");

    // 1. Status prüfen
    const statusCheck = await axios.get(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`
        }
      }
    );
    // 2. Je nach Status handeln
    const paymentStatus = statusCheck.data.status;
    let action = 'none';

    if (paymentStatus.developer_approved === false) {
      await axios.post(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {}, { 
        headers: { Authorization: `Key ${process.env.PI_API_KEY}` } 
      });
      action = 'approved';
    }

    if (paymentStatus.transaction_verified === true && paymentStatus.developer_completed === false) {
      await axios.post(`https://api.minepi.com/v2/payments/${paymentId}/complete`, { txid: "MANUAL_OVERRIDE" }, { 
        headers: { Authorization: `Key ${process.env.PI_API_KEY}` } 
      });
      action = 'completed';
    }

    res.json({
      status: 'forced_resolution',
      originalStatus: paymentStatus,
      actionTaken: action
    });

  } catch (error) {
    res.status(500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

app.post('/refund-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId, amount } = req.body;
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/refund`,
      { amount },
      { headers: { Authorization: `Key ${process.env.PI_API_KEY}` }}
    );
    res.json({ refundStatus: 'success', data: response.data });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error_message || "Rückerstattung fehlgeschlagen" });
  }
});

app.post('/bulk-cancel', validateApiKey, async (req, res) => {
  try {
    const { paymentIds } = req.body; // Array von IDs
    const results = await Promise.all(
      paymentIds.map(id => 
        axios.post(`https://api.minepi.com/v2/payments/${id}/cancel`, {}, {
          headers: { Authorization: `Key ${process.env.PI_API_KEY}` }
        })
      )
    );
    res.json({ cancelled: results.length });
  } catch (error) {
    res.status(500).json({ error: "Fehler beim Massenabbruch" });
  }
});
app.post('/send-test-payment', validateApiKey, async (req, res) => {
  try {
    const { recipient, amount, memo } = req.body;

    if (!recipient) return res.status(400).json({ error: "Empfängeradresse fehlt" });

    const payment = {
      amount: amount || 1,
      memo: memo || "Testzahlung an Nutzer",
      metadata: { type: "test-payout" },
      to: recipient
    };

    const response = await axios.post(
      "https://api.minepi.com/v2/payments",
      payment,
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ success: true, paymentId: response.data.identifier });
  } catch (err) {
    console.error("App2User Fehler:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});


// 🏁 Server starten
app.listen(PORT, () => {
  console.log(`🚀 Backend aktiv auf Port ${PORT}`);
  console.log(`🔐 API-Key: ${process.env.PI_API_KEY ? "✅ Konfiguriert" : "❌ Fehlt!"}`);
});