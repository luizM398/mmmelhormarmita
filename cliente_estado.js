// ARQUIVO: estado_cliente.js
// Este arquivo vai gerenciar a memória e o carrinho de cada cliente.

const clientes = {};

const estadoClientes = {
  getEstado: (numero) => {
    if (!clientes[numero]) {
      clientes[numero] = { 
        estado: 'INICIAL', 
        pedido: [], 
        nome: '', 
        recebeuSaudacao: false,
        pagamentoConfirmado: false,
        ultimoContato: Date.now()
      };
    }
    return clientes[numero];
  },

  resetarCliente: (numero) => {
    clientes[numero] = { 
      estado: 'INICIAL', 
      pedido: [], 
      nome: '',
      recebeuSaudacao: false,
      pagamentoConfirmado: false,
      ultimoContato: Date.now()
    };
  },

  limparCarrinhoManterMenu: (numero) => {
    if (clientes[numero]) {
      clientes[numero].pedido = []; 
      clientes[numero].estado = 'MENU';
      clientes[numero].pagamentoConfirmado = false;
    }
  }
};

// 🧹 MANUTENÇÃO: Limpa sessões inativas após 60 minutos
setInterval(() => {
  const agora = Date.now();
  for (const numero in clientes) {
    if (agora - clientes[numero].ultimoContato > 60 * 60 * 1000) {
      delete clientes[numero];
    }
  }
}, 60000);

// Exporta as funções para o index.js poder usar no fim de semana
module.exports = estadoClientes;
