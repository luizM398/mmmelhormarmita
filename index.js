// index.js
const XLSX = require('xlsx');

// Lê o arquivo menu.xlsx que você subiu no repositório
const workbook = XLSX.readFile('menu.xlsx');

// Pega a primeira planilha
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Converte a planilha para um array de objetos
const data = XLSX.utils.sheet_to_json(sheet);

// Mostra no console
console.log("Conteúdo do menu:");
console.log(data);
