const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// middleware para JSON (IMPORTANTE)
app.use(express.json());

// rota de teste
app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

// webhook do Mercado Pago
app.post('/webhook', (req, res) => {
  console.log('Webhook recebido');
  console.log(req.body);

  res.status(200).send('ok');
});

// manter servidor vivo
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
