import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import cors from 'cors';

// Hilfsfunktion zur Signaturvalidierung
function validateSignature(body, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(body));
  const digest = hmac.digest('hex');
  return digest === signature;
}

const app = express();
const port = process.env.PORT || 3000;

dotenv.config();

const PI_API_KEY = process.env.PI_API_KEY;
const APP_SECRET_KEY = process.env.APP_SECRET_KEY;

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
    req.rawBody = buf.toString();
  }
}));

/**
 * 1. Payment erstellen
 */
app.post('/create-payment', async (req, res) => {
  try {
    const { to_username, amount, memo, metadata } = req.body;

    if (!to_username || !amount) {
      return res.status(400).json({ error: 'Fehlende Pflichtfelder' });
    }

    const response = await axios.post(
      'https://sandbox.minepi.com/v2/payments',
      {
        amount,
        memo: memo || 'Standard-Memo',
        metadata: metadata || {},
        to_username
      },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
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

    if (!validateSignature(req.rawBody, signature, APP_SECRET_KEY)) {
      console.error('⚠️ Ungültige Signatur!');
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const payment = req.body;
    console.log('✅ Payment approved:', payment);

    res.status(200).json({
      status: 'approved',
      payment_id: payment.identifier
    });

  } catch (err) {
    console.error('❌ Fehler bei /approve-payment:', err);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

/**
 * 3. Payment abgeschlossen (Webhook)
 */
app.post('/complete-payment', (req, res) => {
  const signature = req.headers['x-pi-signature'];

  if (!validateSignature(req.rawBody, signature, APP_SECRET_KEY)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const payment = req.body;
  console.log('✅ Payment completed:', payment);

  res.status(200).json({
    status: 'completed',
    payment_id: payment.identifier
  });
});

/**
 * Test-Endpunkt für Sandbox-Zahlung mit festen Werten
 */
/**app.post('/test-payment', async (req, res) => {
  try {
    const response = await axios.post('https://sandbox.minepi.com/v2/payments', {
      amount: '1',
      memo: 'Test',
      to_username: 'v1etx'
    }, {
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    res.status(200).json({
      success: true,
      response: response.data
    });
  } catch (err) {
    const error = err.response?.data || err.message;
    console.error('❌ Fehler bei /test-payment:', error);
    res.status(500).json({
      error: 'Zahlung fehlgeschlagen',
      details: error
    });
  }
});
*/

/**
 * Status-Check
 */
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    version: '1.0.0',
    endpoints: ['/create-payment', '/approve-payment', '/complete-payment', '/test-payment']
  });
});

app.listen(port, () => {
  console.log(`🚀 Server läuft auf http://localhost:${port}`);
  console.log('PI_API_KEY vorhanden:', !!PI_API_KEY);
  console.log('APP_SECRET_KEY vorhanden:', !!APP_SECRET_KEY);
});
