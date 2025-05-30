import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com'
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

// App-to-User Zahlung erstellen
app.post('/create-payment', validateApiKey, async (req, res) => {
  let user = null; // Deklariere user hier
  
  try {
    const { to, amount, memo, metadata } = req.body;

    // 🛑 Validierung
    if (!to || !amount) {
      return res.status(400).json({ error: '"to" (Pi-Username) und "amount" sind erforderlich.' });
    }

    // 🔍 Nutzer anhand Pi-Username aus Supabase holen
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('pi_user_id, pi_username')
      .eq('pi_username', to)
      .single();

    if (userError || !userData) {
      console.error('Benutzerabfragefehler:', userError?.message || 'Benutzer nicht gefunden');
      return res.status(404).json({ error: `Benutzer "${to}" nicht gefunden.` });
    }

    user = userData;

    if (!user.pi_user_id) {
      return res.status(400).json({ error: 'Benutzer hat keine gespeicherte pi_user_id.' });
    }

    console.log("🔎 Empfänger-UID (to):", user.pi_user_id);
    console.log("✅ Pi UID an Pi API senden:", user.pi_user_id);

    // KORREKTUR: Verwende 'user_uid' statt 'to'
    const paymentData = {
      amount: Number(amount),
      memo: memo || "App-to-User Auszahlung",
      metadata: {
        purpose: 'app_to_user',
        pi_username: user.pi_username,
        pi_user_id: user.pi_user_id,
        ...(metadata || {})
      },
      user_uid: user.pi_user_id // WICHTIG: Korrekter Parameter laut Pi API
    };

    console.log("📤 Sende an Pi API:", JSON.stringify(paymentData, null, 2));

    // 📤 Zahlung via Pi API initiieren
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${user.pi_user_id}/create`,
      paymentData,
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY_TESTNET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const payment = response.data;
    console.log(`✅ Zahlung erstellt: ${payment.identifier} ➜ ${user.pi_username}`);

    // 📝 In Datenbank speichern
    const { error: insertError } = await supabase
      .from('payments')
      .insert([{
        sender: metadata?.from || "system",
        recipient_username: user.pi_username,
        amount,
        payment_id: payment.identifier,
        status: payment.status || 'created',
        metadata: {
          ...metadata,
          pi_user_id: user.pi_user_id
        }
      }]);

    if (insertError) {
      console.error('⚠️ Zahlung wurde erstellt, aber konnte nicht gespeichert werden:', insertError.message);
    }

    return res.status(200).json({
      success: true,
      payment_id: payment.identifier,
      payment
    });

  } catch (error) {
    const err = error.response?.data || error.message;
    const code = error.response?.status || 500;
    
    console.error('❌ Fehler bei /create-payment:', JSON.stringify(err, null, 2));
    
    // Debug-Informationen
    if (user) {
      console.error(`⚠️ Gesendete UID: ${user.pi_user_id}`);
      console.error(`⚠️ Gesendeter Username: ${user.pi_username}`);
    } else {
      console.error('⚠️ Kein Benutzerobjekt vorhanden');
    }
    
    console.error(`⚠️ API-Key: ${process.env.PI_API_KEY_TESTNET ? 'Vorhanden' : 'Fehlt'}`);
    console.error(`⚠️ Vollständiger Fehler:`, error.stack);
    
    return res.status(code).json({ 
      error: err,
      debug: {
        sent_uid: user?.pi_user_id,
        sent_username: user?.pi_username,
        api_key_status: !!process.env.PI_API_KEY_TESTNET
      }
    });
  }
});

app.post('/approve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) throw new Error("paymentId fehlt");

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

    res.json({ status: 'approved', piData: response.data });
  } catch (error) {
    const piError = error.response?.data || error.message;
    console.error("APPROVE ERROR:", piError);
    res.status(error.response?.status || 500).json({ error: piError });
  }
});

app.post('/complete-payment', validateApiKey, async (req, res) => {
  const { paymentId, txid } = req.body;

  if (!paymentId || !txid) {
    return res.status(400).json({ error: 'paymentId und txid erforderlich' });
  }

  try {
    // 1. Zahlung bei Pi bestätigen
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
    const username = payment?.metadata?.pi_username;
    const uid = payment?.metadata?.pi_user_id || null;

    if (!username) {
      return res.status(400).json({ error: 'Fehlender Username in metadata' });
    }

    const { error: insertError } = await supabase
      .from('transactions')
      .insert({
        pi_payment_id: paymentId,
        pi_username: username,
        pi_user_id: uid, // kann null sein
        wallet_address: payment.to_address || null,
        amount: payment.amount?.toString() || '1',
        memo: payment.memo || 'donation',
        status: 'completed'
      });

    if (insertError) throw insertError;


console.log("✅ Spende gespeichert:", paymentId);
res.json({ status: 'completed' });


  } catch (error) {
    console.error("❌ Fehler bei /complete-payment:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
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
      .select('pi_user_id')
      .eq('pi_username', username)
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