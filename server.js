import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(express.json());

const PI_API_KEY = process.env.PI_API_KEY;

app.post('/send-testnet-payment', async (req, res) => {
  const { username, amount, memo } = req.body;

  try {
    const response = await axios.post(
      'https://sandbox.minepi.com/v2/payments',
      {
        amount: amount || 0.01,
        memo: memo || 'Testzahlung',
        metadata: { testnet: true },
        to_username: username,
      },
      {
        headers: {
          Authorization: `Bearer ${PI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(200).json({
      message: `Zahlung an ${username} erfolgreich.`,
      data: response.data,
    });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: 'Fehler bei der Zahlung', details: error?.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
