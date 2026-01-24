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

const express = require('express');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// rota teste
app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

// rota para ler o menu
app.get('/menu', (req, res) => {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');

    const workbook = xlsx.readFile(arquivo);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const dados = xlsx.utils.sheet_to_json(sheet);

    res.json(dados);
  } catch (erro) {
    res.status(500).send('Erro ao ler o menu');
  }
});

// webhook Mercado Pago (deixa quieto)
app.post('/webhook', (req, res) => {
  console.log('Webhook recebido');
  res.status(200).send('ok');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
