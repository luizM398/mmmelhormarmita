// ARQUIVO: pagamentos.js
// Este arquivo cuida de toda a comunicação com o Mercado Pago (PIX, Link de Cartão e Consulta do Webhook).

const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

// Configuração de acesso puxando a sua chave secreta
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'SEU_TOKEN_MP_AQUI'
});

// 1. GERA O PIX COPIA E COLA
async function gerarPix(valor, clienteNome, clienteTelefone) {
  try {
    const payment = new Payment(client);
    const body = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: `Marmita - ${clienteNome}`, 
      payment_method_id: 'pix',
      notification_url: `${process.env.URL_DO_SEU_SITE}/webhook`, 
      external_reference: String(clienteTelefone).replace(/\D/g, ''), 
      payer: { email: `vendas.${Date.now()}@marmitaria.com` }
    };
    const response = await payment.create({ body });
    return { copiaCola: response.point_of_interaction.transaction_data.qr_code, idPagamento: response.id };
  } catch (error) { 
    console.error("Erro Pix:", error.message);
    return null; 
  }
}

// 2. GERA O LINK DE CARTÃO DE CRÉDITO
async function gerarLinkPagamento(itens, frete, clienteTelefone) {
  try {
    const SEU_NUMERO_LOJA = "5551984050946"; 
    const preference = new Preference(client);

    const items = itens.map(item => ({
      title: item.prato,
      quantity: Number(item.quantidade),
      unit_price: Number(item.valorAplicado), // Puxa o valor com o desconto já calculado!
      currency_id: 'BRL'
    }));

    if (frete > 0) {
      items.push({ title: 'Taxa de Entrega', quantity: 1, unit_price: Number(frete), currency_id: 'BRL' });
    }

    const response = await preference.create({
      body: {
        items: items,
        external_reference: String(clienteTelefone).replace(/\D/g, ''),
        back_urls: { 
          success: `https://wa.me/${SEU_NUMERO_LOJA}`, 
          failure: `https://wa.me/${SEU_NUMERO_LOJA}`, 
          pending: `https://wa.me/${SEU_NUMERO_LOJA}` 
        },
        auto_return: "approved"
      }
    });
    return response.init_point;
  } catch (error) { 
      console.error("Erro Link:", error);
      return null; 
  }
}

// 3. CONSULTA O PAGAMENTO (USADO PELO WEBHOOK)
async function consultarPagamento(idPagamento) {
    try {
        const payment = new Payment(client);
        return await payment.get({ id: idPagamento });
    } catch (error) {
        console.error("Erro ao consultar pagamento no webhook:", error.message);
        return null;
    }
}

// Exporta as três ferramentas para o seu robô usar
module.exports = { gerarPix, gerarLinkPagamento, consultarPagamento };
