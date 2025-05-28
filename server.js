import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import cors from 'cors';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const SECRET = process.env.APP_SECRET_KEY_TESTNET;
const API_KEY = process.env.PI_API_KEY_TESTNET;
const PI_API_BASE = process.env.PI_NETWORK === 'mainnet'
  ? 'https://api.minepi.com'
  : 'https://sandbox.minepi.com';

function validateSignature(rawBody, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return hmac.digest('hex') === signature;
}

app.use(cors());
app.use(bodyParser.json({
  verify: (req, res, buf) => req.rawBody = buf
}));

app.post('/approve-payment', (req, res) => {
  const sig = req.headers['x-pi-signature'];
  if (!validateSignature(req.rawBody, sig, SECRET)) {
    return res.status(403).json({ error: "Invalid signature" });
  }
  res.status(200).json({ status: "approved", payment_id: req.body.identifier });
});

app.post('/complete-payment', (req, res) => {
  const sig = req.headers['x-pi-signature'];
  if (!validateSignature(req.rawBody, sig, SECRET)) {
    return res.status(403).json({ error: "Invalid signature" });
  }
  res.status(200).json({ status: "completed", payment_id: req.body.identifier });
});

app.get('/', (req, res) => {
  res.json({ status: 'OK', env: process.env.PI_NETWORK });
});

app.listen(port, () => {
  console.log(`🚀 Backend läuft auf Port ${port}`);
});
