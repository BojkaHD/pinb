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
  try {
    // 1️⃣ Neueste "pending" Zahlung aus Supabase abrufen
    const { data: payments, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

    if (paymentError || payments.length === 0) {
      return res.status(404).json({ error: 'Keine offene Zahlung gefunden.' });
    }

    const payment = payments[0];
    const paymentId = payment.payment_id;

    // 2️⃣ Zahlung bei Pi abrufen
    const piResponse = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
      },
    });

    const piData = piResponse.data;
    const recipient = piData.to_address;
    const amount = piData.amount.toString();

    // 3️⃣ Stellar-Konto laden & Gebühr berechnen
    const server = new Server(HORIZON_URL);
    const account = await server.loadAccount(WALLET_KEYPAIR.publicKey());

    const feeStats = await server.feeStats();
    const dynamicFee = feeStats?.fee_charged?.max || '1000'; // Fallback wenn leer

    // 4️⃣ Transaktion bauen
    const transaction = new TransactionBuilder(account, {
      fee: dynamicFee,
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

    transaction.sign(WALLET_KEYPAIR);

    // 5️⃣ Transaktion absenden
    const txResponse = await server.submitTransaction(transaction);
    const txid = txResponse.hash;

    // 6️⃣ Zahlung bei Pi als abgeschlossen markieren
    await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
        },
      }
    );

    // 7️⃣ Supabase-Eintrag aktualisieren
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        txid,
        sender: piData.user_uid,
      })
      .eq('payment_id', paymentId);

    if (updateError) {
      console.error('❌ Supabase Update-Fehler:', updateError);
      return res.status(500).json({ error: 'Datenbank-Update fehlgeschlagen.' });
    }

    res.json({
      success: true,
      txid,
      status: 'completed',
    });

  } catch (err) {
    console.error('❌ Fehler bei /submitPayment:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.error || err.message,
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

    const server = new Server('https://api.testnet.minepi.com');
    const sourceKeypair = Keypair.fromSecret(WALLET_SECRET);
    const account = await server.loadAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '1000',
      networkPassphrase: 'Pi Testnet',
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


app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});