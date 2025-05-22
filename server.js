// backend/server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// ✅ CORS nur für deine Live-Domain erlauben:
app.use(cors({
  origin: 'https://pinb.app'  // oder ['https://pinb.app', 'http://localhost:5173'] für Testzwecke
}));

app.use(bodyParser.json());

app.post('/approve-payment', (req, res) => {
  const { paymentId } = req.body;

  console.log("✅ Zahlung empfangen:", paymentId);

  // Optional: Logging, Validierung, Weiterleitung etc.
  res.json({ approved: true }); // sofortige Genehmigung
});

app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
