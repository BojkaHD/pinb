const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const StellarSdk = require('stellar-sdk');
const { createClient } = require('@supabase/supabase-js');

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
const WALLET_KEYPAIR = StellarSdk.Keypair.fromSecret(WALLET_SECRET);
const HORIZON_URL = 'https://api.testnet.minepi.com';
const NETWORK_PASSPHRASE = 'Pi Testnet';

// Route zum Erstellen einer Zahlung
app.post('/create-payment', async (req, res) => {
  const { uid, amount, memo, metadata } = req.body;

  try {
    // Schritt 1: Zahlung bei Pi anlegen
    const response = await axios.post(
      'https://api.minepi.com/v2/payments',
      {
        amount,
        memo,
        metadata,
        uid,
      },
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
        },
      }
    );

    const paymentId = response.data.identifier;

    // Schritt 2: Eintrag in Supabase-Tabelle "payments"
    const { error } = await supabase.from('payments').insert([
      {
        sender: null, // wird später gefüllt (z. B. beim Abschluss)
        amount,
        payment_id: paymentId,
        status: 'pending',
        metadata,
        uid,
        memo,
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) {
      throw error;
    }

    res.json({ paymentId });
  } catch (error) {
    console.error('Fehler beim Erstellen der Zahlung:', error.message);
    res.status(500).json({ error: 'Fehler beim Erstellen der Zahlung' });
  }
});

app.post('/submit-payment', async (req, res) => {
  const { uid } = req.body;

  try {
    // 1. Offene Zahlung zu diesem Benutzer aus Supabase laden
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

    // 2. Zahlung über Pi API abrufen
    const paymentResponse = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
      },
    });

    const payment = paymentResponse.data;
    const recipient = payment.to_address;
    const amount = payment.amount.toString();

    // 3. Stellar-Transaktion vorbereiten und signieren
    const server = new StellarSdk.Server(HORIZON_URL);
    const account = await server.loadAccount(WALLET_KEYPAIR.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: recipient,
          asset: StellarSdk.Asset.native(),
          amount,
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(WALLET_KEYPAIR);

    // 4. Transaktion einreichen
    const txResponse = await server.submitTransaction(transaction);
    const txid = txResponse.hash;

    // 5. Zahlung bei Pi als abgeschlossen markieren
    await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
        },
      }
    );

    // 6. Supabase-Eintrag aktualisieren
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        txid,
      })
      .eq('payment_id', paymentId);

    if (updateError) {
      throw updateError;
    }

    res.json({ txid });
  } catch (error) {
    console.error('Fehler beim Einreichen der Zahlung:', error.response?.data || error.message);
    res.status(500).json({ error: 'Fehler beim Einreichen der Zahlung' });
  }
});

const { Keypair, Server, Networks, TransactionBuilder, Operation, Asset } = require('stellar-sdk');

app.post('/complete-payment', async (req, res) => {
  const { paymentId } = req.body;

  try {
    // 1. Pi-Zahlung abrufen
    const paymentResponse = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Key ${process.env.PI_API_KEY}`,
      },
    });

    const payment = paymentResponse.data;
    const recipient = payment.to_address;
    const amount = payment.amount.toString();
    const sender = payment.user_uid; // oder payment.from_uid, je nach API-Version

    // 2. Stellar-Transaktion bauen
    const server = new Server('https://api.testnet.minepi.com');
    const sourceKeypair = Keypair.fromSecret(process.env.WALLET_SECRET);
    const account = await server.loadAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
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

    // 3. Transaktion einreichen
    const txResponse = await server.submitTransaction(tx);
    const txid = txResponse.hash;

    // 4. Zahlung bei Pi als "complete" markieren
    await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { txid },
      {
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
        },
      }
    );

    // 5. Supabase-Eintrag aktualisieren
    const { error } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        txid,
        sender,
      })
      .eq('payment_id', paymentId);

    if (error) {
      throw error;
    }

    res.json({ txid, status: 'completed' });
  } catch (error) {
    console.error('Fehler beim Abschließen der Zahlung:', error.response?.data || error.message);
    res.status(500).json({ error: 'Fehler beim Abschließen der Zahlung' });
  }
});

// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});