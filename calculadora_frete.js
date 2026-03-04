// ARQUIVO: calculadora_frete.js
// Este arquivo cuida de calcular a distância e o valor do frete usando Mapbox e ViaCEP.

const axios = require('axios');

// Configurações do Frete (Puxando lá do seu .env)
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN; 
const COORD_COZINHA = "-51.11161606538164,-30.109913348576296"; // Coordenadas da Rua Guaíba

async function calcularFreteGoogle(cepDestino) {
  if (!MAPBOX_ACCESS_TOKEN) return { erro: true, msg: "Erro interno (Token Mapbox ausente)." };
  
  try {
    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) return { erro: true, msg: "⚠️ CEP inválido. Digite os 8 números." };
    
    // 1. Pega o endereço pelo CEP nos Correios
    const urlViaCep = `https://viacep.com.br/ws/${cepLimpo}/json/`;
    const viaCepRes = await axios.get(urlViaCep);
    if (viaCepRes.data.erro) return { erro: true, msg: "❌ CEP não encontrado na base dos Correios." };
    const enderecoTexto = `${viaCepRes.data.logradouro}, ${viaCepRes.data.localidade}, ${viaCepRes.data.uf}, Brasil`;
    
    // 2. Transforma o endereço em Coordenadas (Latitude/Longitude)
    const urlGeo = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(enderecoTexto)}.json?country=br&limit=1&proximity=${COORD_COZINHA}&access_token=${MAPBOX_ACCESS_TOKEN}`;
    const geoRes = await axios.get(urlGeo);
    if (!geoRes.data.features || geoRes.data.features.length === 0) return { erro: true, msg: "❌ O mapa não conseguiu localizar a rua." };
    
    const destino = geoRes.data.features[0];
    const coordsDestino = destino.center.join(','); 
    
    // 3. Calcula a rota e a distância da cozinha até o destino
    const urlDist = `https://api.mapbox.com/directions/v5/mapbox/driving/${COORD_COZINHA};${coordsDestino}?access_token=${MAPBOX_ACCESS_TOKEN}`;
    const distRes = await axios.get(urlDist);
    if (!distRes.data.routes || distRes.data.routes.length === 0) return { erro: true, msg: "🚫 Rota não encontrada." };
    
    const distanciaKm = distRes.data.routes[0].distance / 1000;
    
    // 4. Aplica as regras de preço (Menos de 3km = Grátis, etc)
    let valor = 0, texto = "";
    if (distanciaKm <= 3.0) { valor = 0.00; texto = "R$ 0,00"; } 
    else if (distanciaKm <= 8.0) { valor = 10.00; texto = "R$ 10,00"; }
    else if (distanciaKm <= 14.0) { valor = 15.00; texto = "R$ 15,00"; }
    else if (distanciaKm <= 20.0) { valor = 20.00; texto = "R$ 20,00"; }
    else { return { erro: true, msg: "🚫 Muito distante (fora da área de entrega de 20km)." }; }
    
    return { valor, texto, endereco: enderecoTexto };
    
  } catch (error) { 
    console.error("Erro no cálculo do frete:", error.message);
    return { valor: 15.00, texto: "R$ 15,00 (Contingência)", endereco: "Endereço via CEP" }; 
  }
}

// Exporta a função para o index.js poder usar
module.exports = calcularFreteGoogle;
