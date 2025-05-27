import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';

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

app.set('trust proxy', true);  // Wichtig für korrekte IP/Header-Weiterleitung

app.use(bodyParser.json());

/**
 * 1. Payment erstellen (App initiates AppToUser or UserToApp)
 */
app.post('/create-payment', async (req, res) => {
  const { to_username, amount, memo, metadata } = req.body;

  try {
    const response = await axios.post(
      'https://sandbox.minepi.com/v2/payments',
      {
        amount,
        memo,
        metadata,
        to_username
      },
      {
        headers: {
          Authorization: `Key ${PI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).json({ success: true, payment: response.data });
  } catch (err) {
    console.error('❌ Fehler bei /create-payment:', err.response?.data || err.message);
    res.status(500).json({ error: 'Zahlung fehlgeschlagen' });
  }
});

/**
 * 2. Payment genehmigt (Client or Pi calls you here)
 */
app.post('/approve-payment', (req, res) => {
  const signature = req.headers['x-pi-signature'];
  if (!validateSignature(req.body, signature, APP_SECRET_KEY)) {
    console.error('⚠️ Ungültige Signatur!');
    return res.status(403).send('Unauthorized');
    }
});

/**
 * 3. Payment abgeschlossen
 */
app.post('/complete-payment', (req, res) => {
  const payment = req.body;
  console.log('✅ Payment completed:', payment);
  res.status(200).send('Payment completed received');
});

/**
 * 4. Zahlung abgebrochen
 */
app.post('/cancelled-payment', (req, res) => {
  const payment = req.body;
  console.log('⚠️ Payment cancelled:', payment);
  res.status(200).send('Payment cancelled received');
});

/**
 * 5. Zahlung nicht abgeschlossen
 */
app.post('/incomplete-payment', (req, res) => {
  const payment = req.body;
  console.log('⚠️ Payment incomplete:', payment);
  res.status(200).send('Payment incomplete received');
});

/**
 * 6. Zahlung ausstehend
 */
app.post('/pending-payment', (req, res) => {
  const payment = req.body;
  console.log('⏳ Payment pending:', payment);
  res.status(200).send('Payment pending received');
});

/**
 * Test-Route
 */
app.get('/', (req, res) => {
  res.send('✅ Pi Payment Backend läuft');
});

app.listen(port, () => {
  console.log(`🚀 Server läuft auf http://localhost:${port}`);
});
