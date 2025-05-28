import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import cors from 'cors';

// Initialisiere Umgebungsvariablen
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Umgebungsvariablen (bleiben bei ihren ursprünglichen Namen)
const PI_API_KEY_TESTNET = process.env.PI_API_KEY_TESTNET;
const APP_SECRET_KEY_TESTNET = process.env.APP_SECRET_KEY_TESTNET;

// API-URL Konfiguration
const PI_API_BASE = process.env.PI_NETWORK === 'mainnet' 
  ? 'https://api.minepi.com' 
  : 'https://api.testnet.minepi.com';  // Korrigierte Testnet-URL

// Middleware-Konfiguration
app.set('trust proxy', true);
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-pi-signature']
}));

// Body-Parser mit raw-Body-Speicherung für Signaturvalidierung
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Hilfsfunktion zur Signaturvalidierung (vollständig korrigiert)
function validateSignature(rawBody, signature, secret) {
  if (!secret) {
    throw new Error("APP_SECRET_KEY_TESTNET ist nicht definiert");
  }
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');
  return digest === signature;
}

/**
 * 1. Payment erstellen
 */
app.post('/create-payment', async (req, res) => {
  try {
    const { to, amount, memo, metadata } = req.body;

    if (!to || !amount) {
      return res.status(400).json({ error: 'Fehlende Pflichtfelder (to, amount)' });
    }

    const response = await axios.post(
      `${PI_API_BASE}/v2/payments`,
      {
        amount,
        memo: memo || 'Standard-Memo',
        metadata: metadata || {},
        to
      },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY_TESTNET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).json({
      success: true,
      payment: response.data,
      payment_id: response.data.identifier
    });

  } catch (err) {
    const error = err.response?.data || err.message;
    console.error('❌ Fehler bei /create-payment:', error);
    res.status(500).json({
      error: 'Zahlung fehlgeschlagen',
      details: error
    });
  }
});

/**
 * 2. Payment genehmigt (Webhook)
 */
app.post('/approve-payment', (req, res) => {
  try {
    const signature = req.headers['x-pi-signature'];
    
    if (!signature) {
      return res.status(401).json({ error: 'Signatur-Header fehlt' });
    }
    
    if (!validateSignature(req.rawBody, signature, APP_SECRET_KEY_TESTNET)) {
      console.error('⚠️ Ungültige Signatur! Erwartet vs Empfangen:');
      return res.status(403).json({ error: 'Unauthorized - Signatur ungültig' });
    }

    const payment = req.body;
    console.log('✅ Payment approved:', payment.identifier);

    // Hier würdest du die Zahlung in deiner DB speichern
    // z.B.: database.savePayment(payment);

    res.status(200).json({
      status: 'approved',
      payment_id: payment.identifier
    });

  } catch (err) {
    console.error('❌ Fehler bei /approve-payment:', err);
    res.status(500).json({ error: 'Serverfehler', details: err.message });
  }
});

/**
 * 3. Payment abgeschlossen (Webhook)
 */
app.post('/complete-payment', (req, res) => {
  try {
    const signature = req.headers['x-pi-signature'];
    
    if (!signature) {
      return res.status(401).json({ error: 'Signatur-Header fehlt' });
    }
    
    if (!validateSignature(req.rawBody, signature, APP_SECRET_KEY_TESTNET)) {
      console.error('⚠️ Ungültige Signatur!');
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const payment = req.body;
    console.log('✅ Payment completed:', payment.identifier);

    // Hier würdest du die Zahlung in deiner DB als abgeschlossen markieren
    // z.B.: database.completePayment(payment.identifier);

    res.status(200).json({
      status: 'completed',
      payment_id: payment.identifier
    });
    
  } catch (err) {
    console.error('❌ Fehler bei /complete-payment:', err);
    res.status(500).json({ error: 'Serverfehler', details: err.message });
  }
});

/**
 * Status-Check Endpoint
 */
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    version: '1.0.0',
    environment: process.env.PI_NETWORK || 'testnet',
    endpoints: ['/create-payment', '/approve-payment', '/complete-payment'],
    config: {
      api_base: PI_API_BASE,
      api_key_set: !!PI_API_KEY_TESTNET,
      secret_key_set: !!APP_SECRET_KEY_TESTNET
    }
  });
});

// Server starten
app.listen(port, () => {
  console.log(`🚀 Server läuft auf http://localhost:${port}`);
  console.log('-------------------------------------------');
  console.log('Konfigurationsstatus:');
  console.log(`PI_API_KEY_TESTNET: ${PI_API_KEY_TESTNET ? 'gesetzt' : 'FEHLT!'}`);
  console.log(`APP_SECRET_KEY_TESTNET: ${APP_SECRET_KEY_TESTNET ? 'gesetzt' : 'FEHLT!'}`);
  console.log(`PI_NETWORK: ${process.env.PI_NETWORK || 'testnet (default)'}`);
  console.log(`API_BASE: ${PI_API_BASE}`);
  console.log('-------------------------------------------');
  
  if (!PI_API_KEY_TESTNET || !APP_SECRET_KEY_TESTNET) {
    console.error('⚠️ WARNUNG: Essentielle Umgebungsvariablen fehlen!');
    console.error('Stelle sicher, dass PI_API_KEY_TESTNET und APP_SECRET_KEY_TESTNET in .env gesetzt sind');
  }
});