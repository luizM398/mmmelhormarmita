// estadoClientes.js

// Armazenamento em memória (ATENÇÃO: É apagado se o servidor reiniciar)
const clientes = {};

function getEstado(numero) {
  if (!clientes[numero]) {
    clientes[numero] = {
      numero: numero,
      estado: 'INICIAL', // Estado inicial
      recebeuSaudacao: false,
      ultimoContato: Date.now(),
      ultimaMensagem: '',
      pedido: [], // Array para guardar os itens
      opcoesPrato: [], // Cache do menu atual
      endereco: '',
      // Variáveis auxiliares de fluxo
      estadoAnterior: null,
      mensagemAntesDoCancelar: null,
      precisaArroz: false,
      precisaStrogonoff: false
    };
  }
  return clientes[numero];
}

function limparPedido(numero) {
  if (clientes[numero]) {
    // Mantemos apenas dados básicos, resetamos o pedido
    clientes[numero].estado = 'INICIAL';
    clientes[numero].pedido = [];
    clientes[numero].recebeuSaudacao = false;
    clientes[numero].endereco = '';
    clientes[numero].opcoesPrato = [];
  }
}

module.exports = {
  getEstado,
  limparPedido
};
