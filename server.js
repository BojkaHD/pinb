require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const pi = require('@pineapple-dev/sdk'); // SDK hinzugefügt

const app = express();
const PORT = process.env.PORT || 3000;

// 🔄 SDK-Konfiguration hinzugefügt
pi.configure({
  apiKey: process.env.PI_API_KEY,
  network: "Testnet", // Oder "Mainnet" für Produktion
});

// ✅ Domains
const allowedOrigins = [
  'https://pinb.app',
  'https://sandbox.minepi.com/mobile-app-ui/app/pnb-c7bb42c2c289a5f4',
];

const corsOptions = {
  origin: (origin, callback) => {
    (!origin || allowedOrigins.includes(origin)) 
      ? callback(null, true) 
      : callback(new Error(`❌ Nicht erlaubter Origin: ${origin}`));
  },
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// ✅ Zahlung genehmigen (mit SDK)
app.post('/approve-payment', async (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: '❌ paymentId fehlt' });

  console.log('🟢 Zahlung zur Genehmigung:', paymentId);

  try {
    await pi.approvePayment(paymentId); // SDK-Methode
    console.log('✅ Genehmigt:', paymentId);
    res.json({ approved: true });
  } catch (error) {
    console.error('❌ Genehmigungsfehler:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Zahlung abschließen (mit SDK)
app.post('/complete-payment', async (req, res) => {
  const { paymentId, txid } = req.body;
  if (!paymentId || !txid) return res.status(400).json({ error: '❌ Parameter fehlen' });

  console.log(`🟢 Abschlussversuch: ${paymentId}, txid: ${txid}`);

  try {
    await pi.completePayment(paymentId, { txid }); // SDK-Methode
    console.log('✅ Abgeschlossen:', paymentId);
    res.json({ completed: true });
  } catch (error) {
    console.error('❌ Abschlussfehler:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🛠️ Erzwungener Abschluss (SDK + manuelle txid)
app.post('/force-complete-payment', async (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: '❌ paymentId fehlt' });

  console.log('🔧 Erzwungener Abschluss für:', paymentId);

  try {
    await pi.completePayment(paymentId, { 
      txid: `manual_fix_${Date.now()}` // Simulierte txid
    });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erzwingen fehlgeschlagen:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🚨 Temporärer Endpunkt für spezifische hängige Zahlung
app.post('/force-complete-stuck-payment', async (req, res) => {
  try {
    await pi.completePayment("6lgvPEsmELkzHA8fdKyFvt2sc78K", {
      txid: "MANUAL_FIX_" + Date.now()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ⚠️ Ursprünglicher Cancel-Endpunkt (unverändert)
app.post('/cancel-payment', async (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: '❌ paymentId fehlt' });

  try {
    await pi.cancelPayment(paymentId); // SDK-Methode
    res.json({ cancelled: true });
  } catch (error) {
    console.error('❌ Abbrechen fehlgeschlagen:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Test-Endpunkt
app.get('/', (req, res) => {
  res.send('✅ Pi Payment Backend läuft');
});

app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});