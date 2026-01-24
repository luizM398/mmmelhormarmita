const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const estadoClientes = require('./estadoClientes');
const mensagens = require('./mensagens');

const app = express();
const PORT = process.env.PORT || 3000;

// permite receber dados em JSON
app.use(express.json());

// rota teste
app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

// rota do menu
app.get('/menu', (req, res) => {
  try {
    const arquivo = path.join(__dirname, 'menu.xlsx');

    const workbook = xlsx.readFile(arquivo);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const dados = xlsx.utils.sheet_to_json(sheet);

    res.json(dados);
  } catch (erro) {
    console.log(erro);
    res.status(500).send('Erro ao ler o menu');
  }
});

// webhook Mercado Pago (não mexe)
app.post('/webhook', (req, res) => {
  console.log('Webhook recebido');
  res.status(200).send('ok');
});

// inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
