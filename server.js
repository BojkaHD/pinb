import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  Server,
  Keypair,
  Transaction,
  Operation,
  Asset,
  Memo
} from 'stellar-sdk';

const PORT = process.env.PORT || 3000;

dotenv.config();

const app = express();
app.use(bodyParser.json());

// Supabase-Verbindung
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Stellar & Pi-Konfiguration
const PI_API_KEY = process.env.PI_API_KEY_TESTNET;
const WALLET_SECRET = process.env.APP_SECRET_KEY_TESTNET;
const WALLET_KEYPAIR = Keypair.fromSecret(WALLET_SECRET);
const HORIZON_URL = 'https://api.testnet.minepi.com';
const NETWORK_PASSPHRASE = 'Pi Testnet';

console.log('[DEBUG] Absender PublicKey:', WALLET_KEYPAIR.publicKey()); // 👈 HIER


// Route: create-payment
app.post('/createPayment', async (req, res) => {
  const { uid, amount, memo } = req.body;

  // 🔎 Nutzer validieren
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('uid')
    .eq('uid', uid)
    .single();

  if (userError || !user) {
    return res.status(400).json({ error: 'User nicht gefunden.' });
  }

  try {
    // 📦 Zahlung vorbereiten
    const paymentData = {
      payment: {
        amount,
        memo,
        metadata: { purpose: "App2User", uid },
        uid
      }
    };

    // 🚀 Zahlung bei Pi anlegen
    const piResponse = await axios.post(
      'https://api.minepi.com/v2/payments',
      paymentData,
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const piPayment = piResponse.data;

    // 💾 Speichern in Supabase (Table: payments)
    const { error: dbError } = await supabase.from('payments').insert([
      {
        payment_id: piPayment.identifier,
        uid: user.uid,
        sender: 'App',
        amount: parseFloat(amount),
        status: 'pending',
        metadata: { memo }
      }
    ]);

    if (dbError) {
      console.error('❌ Supabase Insert Fehler:', dbError);
      return res.status(500).json({ error: 'Fehler beim Speichern in Supabase' });
    }

    res.json({
      success: true,
      payment_id: piPayment.identifier,
      payment: piPayment
    });

  } catch (err) {
    console.error('❌ Fehler bei createPayment:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.error || err.message
    });
  }
});



app.post('/submitPayment', async (req, res) => {
  const { paymentId } = req.body;

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId fehlt im Body' });
  }

  console.log('[DEBUG] submitted paymentId:', paymentId);

  try {
    // 1️⃣ Zahlung bei Pi abrufen
    const piResponse = await axios.get(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      {
        headers: { Authorization: `Key ${PI_API_KEY}` },
      }
    );

    console.log('[DEBUG] piData:', piResponse);

    const piData = piResponse.data;
    const envelopeXDR = piData.envelope_xdr;

    console.log('[DEBUG] envelopeXDR von Pi:', piData.envelope_xdr);

    if (!envelopeXDR) {
      return res.status(400).json({ error: 'Keine envelope_xdr von Pi erhalten' });
    }

    // 2️⃣ Transaktion aus XDR laden
    const tx = new Transaction(envelopeXDR, NETWORK_PASSPHRASE);

    // 3️⃣ Mit App-Wallet signieren
    tx.sign(WALLET_KEYPAIR);

    const signedXDR = tx.toXDR();

    console.log('[DEBUG] paymentId für die Wallet-Signatur:', paymentId);
    console.log('[DEBUG] signed XDR:', signedXDR);

    // 4️⃣ Zurück an Pi übermitteln → Pi submitted zur Blockchain
    const submitResponse = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/submit`,
      {
        txid: signedXDR,
      },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
        },
      }
    );

    // 5️⃣ Optional: In Supabase speichern
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'submitted',
        txid: tx.hash().toString(),
      })
      .eq('payment_id', paymentId);

    if (updateError) {
      console.error('❌ Fehler beim Supabase-Update:', updateError);
    }

    res.json({
      success: true,
      paymentId,
      txid: tx.hash().toString(),
      pi: submitResponse.data,
    });

  } catch (err) {
    console.error('❌ Fehler bei /submitPayment:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.error || err.message,
      details: err.response?.data,
    });
  }
});


app.post('/completePayment', async (req, res) => {
  const { paymentId } = req.body;

  try {
    // 📡 Zahlung laden
    const piResponse = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
      },
    });

    const piData = piResponse.data;
    const recipient = piData.to_address;
    const amount = piData.amount.toString();

    const server = new Server(HORIZON_URL);
    const sourceKeypair = Keypair.fromSecret(WALLET_KEYPAIR);
    const account = await server.loadAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '1000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: recipient,
          asset: Asset.native(),
          amount,
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(sourceKeypair);

    const txResponse = await server.submitTransaction(tx);
    const txid = txResponse.hash;

    // ✅ Pi API updaten
    await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
        },
      }
    );

    // 🧾 Supabase aktualisieren
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        txid
      })
      .eq('payment_id', paymentId);

    if (updateError) {
      console.error('❌ Fehler beim Aktualisieren:', updateError);
      return res.status(500).json({ error: 'Fehler beim Speichern in Supabase' });
    }

    res.json({
      success: true,
      txid,
      status: 'completed'
    });

  } catch (err) {
    console.error('❌ Fehler bei /completePayment:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.error || err.message
    });
  }
});

app.post('/cancel-payment', async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) throw new Error("paymentId fehlt");

    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      {},
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
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

app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});