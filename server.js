require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

const validateApiKey = (req, res, next) => {
  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: "PI_API_KEY nicht konfiguriert" });
  }
  next();
};

async function getUserIdFromWallet(walletAddress) {
  const { data, error } = await supabase
    .from('users')
    .select('pi_user_id')
    .eq('wallet_address', walletAddress)
    .single();

  if (error || !data) {
    console.error('Fehler beim Abrufen der UserId aus Supabase:', error);
    return null;
  }

  return data.pi_user_id;
}

// Zahlung erstellen
app.post('/create-payment', validateApiKey, async (req, res) => {
  try {
    const { amount, memo, userId } = req.body;

    if (!userId) return res.status(400).json({ error: "Wallet-Adresse fehlt" });
    if (!amount) return res.status(400).json({ error: "Betrag fehlt" });

    const payload = {
      amount: amount.toString(),
      memo: memo || "App to User Zahlung",
      userId,
      metadata: { type: "app-to-user-payment" }
    };

    const paymentRes = await axios.post(
      "https://api.minepi.com/v2/payments",
      payload,
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const { error } = await supabase.from('transactions').insert({
      pi_payment_id: paymentRes.data.identifier,
      user_id: userId,
      wallet_address: wallet,
      amount: amount.toString(),
      memo: memo || null,
      status: 'created',
      created_at: new Date()
    });

    if (error) {
      console.error('Fehler beim Speichern der Transaktion:', error);
    }

    res.json({ paymentId: paymentRes.data.identifier });

  } catch (error) {
    console.error("Fehler beim Erstellen der Zahlung:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Zahlung genehmigen
app.post('/approve-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "paymentId fehlt" });

    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {},
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const { error } = await supabase
      .from('transactions')
      .update({ status: 'approved' })
      .eq('pi_payment_id', paymentId);

    if (error) {
      console.error('Fehler beim Aktualisieren der Transaktion (approve):', error);
    }

    res.json({ status: 'approved', data: response.data });
  } catch (error) {
    console.error("Fehler beim Genehmigen der Zahlung:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Zahlung abschließen
app.post('/complete-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId, txid } = req.body;
    if (!paymentId || !txid) return res.status(400).json({ error: "paymentId und txid erforderlich" });

    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const { error } = await supabase
      .from('transactions')
      .update({ status: 'completed', txid: txid })
      .eq('pi_payment_id', paymentId);

    if (error) {
      console.error('Fehler beim Aktualisieren der Transaktion (complete):', error);
    }

    res.json({ status: 'completed', data: response.data });
  } catch (error) {
    console.error("Fehler beim Abschließen der Zahlung:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Zahlung stornieren
app.post('/cancelled-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "paymentId fehlt" });

    const { error } = await supabase
      .from('transactions')
      .update({ status: 'cancelled' })
      .eq('pi_payment_id', paymentId);

    if (error) {
      console.error('Fehler beim Aktualisieren der Transaktion (cancelled):', error);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren der Transaktion' });
    }

    try {
      await axios.post(
        `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
        {},
        {
          headers: {
            Authorization: `Key ${process.env.PI_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );
    } catch (piError) {
      console.warn("Warnung: Fehler beim Benachrichtigen der Pi API über Stornierung:", piError.response?.data || piError.message);
    }

    res.json({ status: 'cancelled', message: `Zahlung ${paymentId} wurde storniert.` });
  } catch (error) {
    console.error("Fehler beim Stornieren der Zahlung:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Zahlung unvollständig markieren
app.post('/incomplete-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "paymentId fehlt" });

    const { error } = await supabase
      .from('transactions')
      .update({ status: 'incomplete' })
      .eq('pi_payment_id', paymentId);

    if (error) {
      console.error('Fehler beim Aktualisieren der Transaktion (incomplete):', error);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren der Transaktion' });
    }

    res.json({ status: 'incomplete', message: `Zahlung ${paymentId} als unvollständig markiert.` });
  } catch (error) {
    console.error("Fehler beim Markieren der Zahlung als unvollständig:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Zahlung ausstehend markieren
app.post('/pending-payment', validateApiKey, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "paymentId fehlt" });

    const { error } = await supabase
      .from('transactions')
      .update({ status: 'pending' })
      .eq('pi_payment_id', paymentId);

    if (error) {
      console.error('Fehler beim Aktualisieren der Transaktion (pending):', error);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren der Transaktion' });
    }

    res.json({ status: 'pending', message: `Zahlung ${paymentId} als ausstehend markiert.` });
  } catch (error) {
    console.error("Fehler beim Markieren der Zahlung als ausstehend:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  console.log(`🔐 PI_API_KEY: ${process.env.PI_API_KEY ? "✅ vorhanden" : "❌ fehlt"}`);
});
