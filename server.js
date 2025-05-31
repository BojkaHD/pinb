import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import axios from 'axios';

import { createClient } from '@supabase/supabase-js';

const PI_API_KEY_TESTNET = process.env.PI_API_KEY_TESTNET;


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com',
  'https://pinb.onrender.com'
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

// Middleware zur API-Key Prüfung
const validateApiKey = (req, res, next) => {
  if (!process.env.PI_API_KEY_TESTNET) {
    return res.status(500).json({ error: "PI_API_KEY_TESTNET nicht konfiguriert" });
  }
  next();
};

// 🧾 App-to-User Zahlung erstellen (z. B. via CLI oder Backend Trigger)
app.post('/createPayment', async (req, res) => {
  const { uid, amount, memo } = req.body;

  // Benutzer aus Supabase "users" lesen
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('uid')
    .eq('uid', uid)
    .single();

  console.log("UserID:"+user.uid);

  if (userError || !user) {
    return res.status(400).json({ error: 'User nicht gefunden.' });
  }

  try {
    const paymentData = {
      payment: {
        amount,
        memo,
        metadata: {test: "Testpayment-A2U"},
        uid
      }
    };

    console.log("Stoppunkt nach PaymentData");

    const piResponse = await axios.post(
      'https://api.minepi.com/v2/payments',
      paymentData,
      {
        headers: {
          Authorization: `Key ${PI_API_KEY_TESTNET}`, // oder dein Mainnet-Key
          'Content-Type': 'application/json'
        }
      }
    );

    const piPayment = piResponse.data;

    console.log("Stoppunkt nach PiPayment-ResponseData");

    const { error: txError } = await supabase.from('payments').insert([
    {
    payment_id: piPayment.identifier,
    uid: user.uid,
    sender: 'App', // oder leer lassen, wenn nicht relevant
    amount: parseFloat(amount), // wichtig: numerisch speichern
    status: 'pending',
    metadata: { memo }, // optional: weitere Daten hier rein
    }
    ]);

    if (txError) {
      console.error('Supabase Fehler:', txError);
      return res.status(500).json({ error: 'Transaktionsspeicherung fehlgeschlagen' });
    }

    res.json({
      success: true,
      payment_id: piPayment.identifier,
      payment: piPayment
    });

  } catch (err) {
    console.error('Zahlungsfehler:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Zahlung konnte nicht initiiert werden',
      details: err.response?.data || err.message
    });
  }
});

// approve-payment Route
app.post('/approve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      throw new Error("paymentId fehlt");
    }

    // ✅ Zahlung bei Pi genehmigen
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const piData = response.data;

    const uid = piData?.user_uid;
    const username = piData?.metadata?.username || null;
    const wallet_address = piData?.from_address || null; // ✅ SPENDER-Adresse!
    const amount = piData?.amount?.toString() || null;
    const memo = piData?.memo || null;

    if (!uid || !username || !amount) {
      throw new Error("❌ Fehlende Pflichtdaten in Pi-Zahlungsdaten");
    }

    // 🔄 Supabase: Als approved eintragen oder updaten
    const { error } = await supabase.from('transactions').upsert({
      payment_id: paymentId,
      uid,
      username,
      wallet_address,
      amount,
      memo,
      status: 'approved'
    }, {
      onConflict: ['payment_id']
    });

    if (error) {
      console.error("❌ Supabase Fehler:", error);
      return res.status(500).json({ error: "Speichern in Supabase fehlgeschlagen" });
    }

    res.json({ status: 'approved', piData });

  } catch (error) {
    const piError = error.response?.data || error.message;
    console.error("APPROVE ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

// complete-payment Route
app.post('/complete-payment', validateApiKey, async (req, res) => {
  const { payment_id, txid, paymentId } = req.body;

  const id = payment_id || paymentId; // beide Varianten unterstützen
  if (!id || !txid) {
    return res.status(400).json({ error: 'payment_id oder txid fehlt' });
  }

  try {
    // 1️⃣ Bei Pi Network als completed markieren
    const piResponse = await axios.post(
      `https://api.minepi.com/v2/payments/${id}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const paymentDTO = piResponse.data;
    const from_address = paymentDTO.from_address || null;
    const verified = paymentDTO.transaction?.verified ?? false;

    // 2️⃣ Herausfinden, wo speichern → payments (App2User) oder transactions (Donate)
    const { data: paymentInPayments } = await supabase
      .from('payments')
      .select('id')
      .eq('payment_id', id)
      .maybeSingle();

    const table = paymentInPayments ? 'payments' : 'transactions';

    // 3️⃣ Supabase aktualisieren
    const { error: updateError } = await supabase
      .from(table)
      .update({
        txid,
        status: verified ? 'completed' : 'unverified',
        wallet_address: from_address // nur bei Spenden sinnvoll
      })
      .eq('payment_id', id)
      .select();

    if (updateError) {
      console.error('❌ Supabase Update Fehler:', updateError);
      return res.status(500).json({ error: 'Supabase update fehlgeschlagen' });
    }

    res.json({
      success: true,
      txid,
      status: verified ? 'completed' : 'unverified',
      source_table: table
    });

  } catch (err) {
    console.error("❌ Fehler bei Pi Complete:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});



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

    res.json({ status: 'cancelled', piData: response.data });
  } catch (error) {
    const piError = error.response?.data?.error_message || error.message;
    console.error("CANCEL ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

app.post('/force-resolve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) throw new Error("paymentId fehlt");

    const statusCheck = await axios.get(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      {
        headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}` }
      }
    );

    const paymentStatus = statusCheck.data.status;
    let action = 'none';

    if (paymentStatus.developer_approved === false) {
      await axios.post(
        `https://api.minepi.com/v2/payments/${paymentId}/approve`,
        {},
        { headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}` } }
      );
      action = 'approved';
    }

    if (paymentStatus.transaction_verified === true && paymentStatus.developer_completed === false) {
      await axios.post(
        `https://api.minepi.com/v2/payments/${paymentId}/complete`,
        { txid: "MANUAL_OVERRIDE" },
        { headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}` } }
      );
      action = 'completed';
    }

    res.json({
      status: 'forced_resolution',
      originalStatus: paymentStatus,
      actionTaken: action
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.post('/refund-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId, amount } = req.body;
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/refund`,
      { amount },
      { headers: { Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
        'Content-Type': 'application/json' }}
    );
    res.json({ refundStatus: 'success', data: response.data });
  } catch (error) {
    res.status(500).json({
      error: error.response?.data?.error_message || "Rückerstattung fehlgeschlagen"
    });
  }
});

app.post('/bulk-cancel', validateApiKey, async (req, res) => {
  try {
    const { paymentIds } = req.body;
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

app.get('/test-user/:username', async (req, res) => {
  const username = req.params.username;

  if (!username) {
    return res.status(400).json({ error: 'Kein Username angegeben' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('uid')
      .eq('username', username)
      .single(); // Nur ein Eintrag erwartet

    if (error) {
      console.error(`[❌] Supabase-Abfragefehler:`, error.message);
      return res.status(404).json({ found: false, error: 'Benutzer nicht gefunden' });
    }

    res.json({ found: true, user: data });
  } catch (err) {
    console.error(`[❌] Fehler bei /test-user:`, err.message);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Backend aktiv auf Port ${PORT}`);
  console.log(`🔐 API-Key: ${process.env.PI_API_KEY_TESTNET ? "✅ Konfiguriert" : "❌ Fehlt!"}`);
});