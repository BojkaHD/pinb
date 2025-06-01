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
  BASE_FEE
} from 'stellar-sdk';

dotenv.config();

const app = express();
app.use(bodyParser.json());

// Supabase-Verbindung
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Konfiguration
const PI_API_KEY = process.env.PI_API_KEY_TESTNET;
const WALLET_SECRET = process.env.APP_SECRET_KEY_TESTNET;
const WALLET_KEYPAIR = Keypair.fromSecret(WALLET_SECRET);
const HORIZON_URL = 'https://api.testnet.minepi.com';
const NETWORK_PASSPHRASE = 'Pi Testnet';

// Route: create-payment
app.post('/create-payment', async (req, res) => {
  const { uid, amount, memo, metadata } = req.body;

  try {
    const response = await axios.post(
      'https://api.minepi.com/v2/payments',
      { amount, memo, metadata, uid },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
        },
      }
    );

    const paymentId = response.data.identifier;

    const { error } = await supabase.from('payments').insert([
      {
        sender: null,
        amount,
        payment_id: paymentId,
        status: 'pending',
        metadata,
        uid,
        memo,
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;

    res.json({ paymentId });
  } catch (error) {
    console.error('Fehler bei /create-payment:', error.message);
    res.status(500).json({ error: 'Zahlung konnte nicht erstellt werden' });
  }
});

// Route: submit-payment
app.post('/submit-payment', async (req, res) => {
  const { uid } = req.body;

  try {
    const { data: payments, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('uid', uid)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError || payments.length === 0) {
      return res.status(404).json({ error: 'Keine offene Zahlung gefunden.' });
    }

    const { payment_id: paymentId } = payments[0];

    const paymentResponse = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
      },
    });

    const payment = paymentResponse.data;
    const recipient = payment.to_address;
    const amount = payment.amount.toString();

    const server = new Server(HORIZON_URL);
    const account = await server.loadAccount(WALLET_KEYPAIR.publicKey());

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
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

    const txResponse = await server.submitTransaction(transaction);
    const txid = txResponse.hash;

    await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
        },
      }
    );

    const { error: updateError } = await supabase
      .from('payments')
      .update({ status: 'completed', txid })
      .eq('payment_id', paymentId);

    if (updateError) throw updateError;

    res.json({ txid });
  } catch (error) {
    console.error('Fehler bei /submit-payment:', error.response?.data || error.message);
    res.status(500).json({ error: 'Zahlung konnte nicht abgeschlossen werden' });
  }
});

// Route: complete-payment (manuelle Übergabe von paymentId)
app.post('/complete-payment', async (req, res) => {
  const { paymentId } = req.body;

  try {
    const paymentResponse = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
      },
    });

    const payment = paymentResponse.data;
    const recipient = payment.to_address;
    const amount = payment.amount.toString();
    const sender = payment.user_uid;

    const server = new Server(HORIZON_URL);
    const account = await server.loadAccount(WALLET_KEYPAIR.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
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

    tx.sign(WALLET_KEYPAIR);
    const txResponse = await server.submitTransaction(tx);
    const txid = txResponse.hash;

    await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
        },
      }
    );

    const { error } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        txid,
        sender,
      })
      .eq('payment_id', paymentId);

    if (error) throw error;

    res.json({ txid, status: 'completed' });
  } catch (error) {
    console.error('Fehler bei /complete-payment:', error.response?.data || error.message);
    res.status(500).json({ error: 'Fehler beim Abschließen der Zahlung' });
  }
});

// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});