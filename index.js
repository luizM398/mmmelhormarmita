const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

app.post('/webhook', express.json(), (req, res) => {
  console.log('Webhook recebido');
  console.log(req.body);

  res.status(200).send('ok');
});
