import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  Server,
  Keypair,
  TransactionBuilder,
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

  try {
    const server = new Server(HORIZON_URL);

    // 1️⃣ Zahldaten von Pi holen
    const piResponse = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_API_KEY}` },
    });

    const payment = piResponse.data;
    const recipient = payment.to_address;
    const amount = payment.amount.toString();

    if (paymentId.length > 28) {
      return res.status(400).json({ error: 'Memo zu lang (max. 28 Zeichen)' });
    }

    // 2️⃣ Aktuelle Kontodaten laden (frischer seq_num!)
    const account = await server.loadAccount(WALLET_KEYPAIR.publicKey());

    const feeStats = await server.feeStats();
    const dynamicFee = feeStats.fee_charged?.max || '1000';

    // 3️⃣ Transaktion bauen
    const tx = new TransactionBuilder(account, {
      fee: dynamicFee,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addMemo(Memo.text(paymentId))
      .addOperation(
        Operation.payment({
          destination: recipient,
          asset: Asset.native(),
          amount,
        })
      )
      .setTimeout(0)
      .build();

    tx.sign(WALLET_KEYPAIR);
    const txXDR = tx.toXDR();

    console.log('[DEBUG] paymentId:', paymentId);
    console.log('[DEBUG] recipient:', recipient);
    console.log('[DEBUG] amount:', amount);
    console.log('[DEBUG] SeqNum:', account.sequence);

    // 4️⃣ Transaktion an Pi übermitteln
    const completeResponse = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid: txXDR },
      { headers: { Authorization: `Key ${PI_API_KEY}` } }
    );

    // 5️⃣ Optional: Supabase-Status aktualisieren
    await supabase
      .from('payments')
      .update({ status: 'completed', txid: tx.hash().toString() })
      .eq('payment_id', paymentId);

    res.json({
      success: true,
      paymentId,
      txid: tx.hash().toString(),
      pi: completeResponse.data,
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