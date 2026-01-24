const clientes = {};

function getEstado(numero) {
  if (!clientes[numero]) {
    clientes[numero] = {
      estado: 'MENU',
      pedido: [],
      quantidadeTotal: 0
    };
  }
  return clientes[numero];
}

function setEstado(numero, novoEstado) {
  const cliente = getEstado(numero);
  cliente.estado = novoEstado;
}

function limparPedido(numero) {
  const cliente = getEstado(numero);
  cliente.pedido = [];
  cliente.quantidadeTotal = 0;
  cliente.estado = 'MENU';
}

module.exports = {
  getEstado,
  setEstado,
  limparPedido
};
