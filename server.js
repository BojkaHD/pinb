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
      pi_payment_id: paymentId,
      uid,
      username,
      wallet_address,
      amount,
      memo,
      status: 'approved'
    }, {
      onConflict: ['pi_payment_id']
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

import jwt from 'jsonwebtoken';

app.post('/complete-payment', validateApiKey, async (req, res) => {
  const { paymentId } = req.body;

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId erforderlich' });
  }

  try {
    // 🔐 Signierte txid erstellen
    const txid = jwt.sign(
      { payment_id: paymentId },
      process.env.APP_SECRET_KEY_TESTNET,
      { algorithm: 'HS256' }
    );
    console.log("🧾 Generierte txid:", txid);

    // ⛓️ Zahlung bei Pi abschließen
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

    const payment = piResponse.data;
    console.log("🔔 Antwort von Pi Network:", payment);

    // 📦 Relevante Daten extrahieren
    const uid = payment?.user_uid || null;
    const username = payment?.metadata?.username || null;
    const senderWallet = payment?.from_address || null;
    const amount = payment?.amount?.toString() || null;
    const memo = payment?.memo || null;
    
    const {
      developer_approved = false,
      transaction_verified = false,
      developer_completed = false
    } = payment?.status || {};

    // ❗ Wichtige Validierung
    if (!uid) {
      return res.status(400).json({ error: 'UID fehlt in Zahlungsdaten' });
    }

    // 🔎 Existierende Zahlung prüfen (inkl. Status)
    const { data: existingPayment, error: fetchError } = await supabase
      .from('payments')
      .select('status, transaction_verified')
      .eq('payment_id', paymentId)
      .maybeSingle();

    if (fetchError) {
      console.error("❌ Supabase Lese-Fehler:", fetchError);
      return res.status(500).json({ error: 'Datenbankabfrage fehlgeschlagen' });
    }

    // 🛡️ Verhinderung des Überschreibens verifizierter Transaktionen
    if (existingPayment?.transaction_verified) {
      console.warn("⚠️ Zahlung bereits verifiziert, keine Aktualisierung:", paymentId);
      return res.json({ 
        status: 'verified',
        warning: 'Zahlung wurde bereits verifiziert' 
      });
    }

    // 🏷️ Dynamischen Status bestimmen
    const paymentStatus = transaction_verified 
      ? 'verified' 
      : developer_completed 
        ? 'completed' 
        : 'pending';

    // 📥 Datenobjekt für Update/Insert
    const paymentData = {
      payment_id: paymentId,
      status: paymentStatus,
      txid,
      sender: senderWallet,
      amount,
      memo,
      uid,
      username,
      metadata: payment.metadata || null,
      developer_approved,
      transaction_verified,
      developer_completed
    };

    // 🔄 Datenbankoperation
    let dbError;
    if (existingPayment) {
      // ✅ Vorhandenen Datensatz aktualisieren
      const { error } = await supabase
        .from('payments')
        .update(paymentData)
        .eq('payment_id', paymentId);
      dbError = error;
    } else {
      // ➕ Neuen Datensatz erstellen
      const { error } = await supabase
        .from('payments')
        .insert([paymentData]);
      dbError = error;
    }

    if (dbError) {
      console.error("❌ Supabase Schreibfehler:", dbError);
      return res.status(500).json({ error: 'Zahlung konnte nicht gespeichert werden' });
    }

    console.log(`✅ Zahlung [${paymentStatus}]:`, paymentId);
    res.json({ status: paymentStatus });

  } catch (error) {
    // 🧩 Axios Fehler extrahieren
    const piError = error.response?.data?.error || error.response?.data?.message;
    const errorMessage = piError || error.message;
    
    console.error("❌ Kritischer Fehler in /complete-payment:", {
      url: error.config?.url,
      status: error.response?.status,
      error: errorMessage
    });
    
    res.status(500).json({ 
      error: piError ? `Pi API Fehler: ${piError}` : errorMessage 
    });
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