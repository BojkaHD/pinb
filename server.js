import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🔗 Supabase Initialisierung
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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
  if (!process.env.PI_API_KEY_TESTNET) {
    return res.status(500).json({ error: "PI_API_KEY_TESTNET nicht konfiguriert" });
  }
  next();
};

// ✅ Zahlung genehmigen (Developer Approval)
app.post('/approve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId, uid, username, wallet_address } = req.body;

    if (!paymentId || !uid || !username) {
      return res.status(400).json({ error: "Benötigte Felder fehlen" });
    }

    // 💡 Schritt 1: Pi-Zahlung abrufen für amount + memo
    const paymentResponse = await axios.get(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
        }
      }
    );

    const piData = paymentResponse.data;
    const amount = piData.amount;
    const memo = piData.memo || '';

    // ✅ Schritt 2: Pi-Zahlung genehmigen
    await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // 💾 Schritt 3: Supabase-Eintrag in transactions speichern
    const { error } = await supabase
      .from('transactions')
      .insert([{
        payment_id: paymentId,
        uid,
        username,
        wallet_address,
        amount,
        memo,
        status: 'approved',
        created_at: new Date().toISOString()
      }]);

    if (error) {
      console.error('❌ Fehler beim Eintragen in transactions:', error);
      return res.status(500).json({ error: 'Fehler beim Speichern in Supabase' });
    }

    res.json({
      success: true,
      status: 'approved',
      paymentId,
      amount,
      memo
    });

  } catch (error) {
    const piError = error.response?.data || error.message;
    console.error("❌ APPROVE ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});


// ✅ Zahlung abschließen (mit Blockchain TXID)
// ✅ Spende abschließen: /complete-payment
app.post('/complete-payment', validateApiKey, async (req, res) => {
  const { paymentId, txid } = req.body;

  if (!paymentId || !txid) {
    return res.status(400).json({ error: "paymentId oder txid fehlt" });
  }

  try {
    const piResponse = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const verified = piResponse.data?.transaction?.verified ?? false;

    const { error } = await supabase
      .from('transactions')
      .update({
        txid,
        status: verified ? 'completed' : 'unverified'
      })
      .eq('payment_id', paymentId);

    if (error) {
      console.error("❌ Supabase update error:", error);
      return res.status(500).json({ error: 'Supabase update fehlgeschlagen' });
    }

    res.json({
      success: true,
      txid,
      payment_id: paymentId,
      status: verified ? 'completed' : 'unverified',
      piResponse: piResponse.data
    });
  } catch (err) {
    console.error("❌ Fehler bei /complete-payment:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data?.error || err.message,
      details: err.response?.data
    });
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
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
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
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`
        }
      }
    );
    // 2. Je nach Status handeln
    const paymentStatus = statusCheck.data.status;
    let action = 'none';

    if (paymentStatus.developer_approved === false) {
      await axios.post(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {}, { 
        headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}` } 
      });
      action = 'approved';
    }

    if (paymentStatus.transaction_verified === true && paymentStatus.developer_completed === false) {
      await axios.post(`https://api.minepi.com/v2/payments/${paymentId}/complete`, { txid: "MANUAL_OVERRIDE" }, { 
        headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}` } 
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
      { headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}` }}
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
          headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}` }
        })
      )
    );
    res.json({ cancelled: results.length });
  } catch (error) {
    res.status(500).json({ error: "Fehler beim Massenabbruch" });
  }
});

// 🏁 Server starten
app.listen(PORT, () => {
  console.log(`🚀 Backend aktiv auf Port ${PORT}`);
  console.log(`🔐 API-Key: ${process.env.PI_API_KEY_TESTNET ? "✅ Konfiguriert" : "❌ Fehlt!"}`);
});