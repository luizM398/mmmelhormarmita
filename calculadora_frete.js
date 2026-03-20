// ARQUIVO: calculadora_frete.js
const axios = require('axios');

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN; 
const COORD_COZINHA = "-51.11161606538164,-30.109913348576296"; 

async function calcularFreteGoogle(mensagemCliente) {
  if (!MAPBOX_ACCESS_TOKEN) return { erro: true, msg: "Erro interno (Token Mapbox ausente)." };
  
  try {
    const inputLimpo = String(mensagemCliente).trim();
    
    // 1. Acha o CEP (primeira sequência de 8 números na frase)
    const matchCep = inputLimpo.match(/\b\d{5}-?\d{3}\b/);
    if (!matchCep) return { erro: true, msg: "⚠️ Não encontrei o CEP. Por favor, digite o CEP, o Número e o Complemento juntos." };
    const cepSomenteNumeros = matchCep[0].replace(/\D/g, '');
    
    // 2. Acha o Número da Casa (o primeiro número depois do CEP)
    const textoSemCep = inputLimpo.replace(matchCep[0], '');
    const matchNumero = textoSemCep.match(/\b\d+\b/);
    const numeroDigitado = matchNumero ? matchNumero[0] : '';

    // ====================================================================
    // 🛑 NOVA TRAVA: Bloqueia se o cliente não digitar o número!
    // ====================================================================
    if (!numeroDigitado) {
        return { erro: true, msg: "⚠️ Falta o *NÚMERO* da residência.\nPor favor, digite o CEP e o Número juntos (Ex: 90000-000, 150)." };
    }

    // 3. Pega o resto e trata como Complemento (Ex: Bloco B, Apto 101)
    let complementoDigitado = textoSemCep.replace(numeroDigitado, '').trim();
    complementoDigitado = complementoDigitado.replace(/^[\s,]+/, ''); // Limpa vírgulas sobrando

    // 4. Puxa a Rua base nos Correios
    const urlViaCep = `https://viacep.com.br/ws/${cepSomenteNumeros}/json/`;
    const viaCepRes = await axios.get(urlViaCep);
    if (viaCepRes.data.erro) return { erro: true, msg: "❌ CEP não encontrado na base dos Correios." };
    const ruaCorreios = viaCepRes.data.logradouro;
    
    // ====================================================================
    // 🌟 REGRA SUPER VIP: Faculdade (Centro Histórico)
    // ====================================================================
    if (cepSomenteNumeros === '90020060' && numeroDigitado === '626') {
        let textoAviso = complementoDigitado ? ` (Compl: ${complementoDigitado})` : "";
        return { 
            valor: 0.00, 
            texto: "R$ 0,00 🎉 *(Frete VIP)*", 
            endereco: `${ruaCorreios}, 626 - Centro Histórico${textoAviso}` 
        };
    }

    // 5. Monta o endereço exato para o mapa (Rua + NÚMERO + Cidade)
    let enderecoParaMapbox = `${ruaCorreios}`;
    if (numeroDigitado) enderecoParaMapbox += `, ${numeroDigitado}`;
    enderecoParaMapbox += `, ${viaCepRes.data.localidade}, ${viaCepRes.data.uf}, Brasil`;

    // 6. Calcula a Rota Milimétrica
    const urlGeo = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(enderecoParaMapbox)}.json?country=br&limit=1&proximity=${COORD_COZINHA}&access_token=${MAPBOX_ACCESS_TOKEN}`;
    const geoRes = await axios.get(urlGeo);
    if (!geoRes.data.features || geoRes.data.features.length === 0) return { erro: true, msg: "❌ O mapa não conseguiu localizar a rota para essa rua." };
    
    const coordsDestino = geoRes.data.features[0].center.join(','); 
    const urlDist = `https://api.mapbox.com/directions/v5/mapbox/driving/${COORD_COZINHA};${coordsDestino}?access_token=${MAPBOX_ACCESS_TOKEN}`;
    const distRes = await axios.get(urlDist);
    if (!distRes.data.routes || distRes.data.routes.length === 0) return { erro: true, msg: "🚫 Rota não encontrada até o seu endereço." };
    
    const distanciaKm = distRes.data.routes[0].distance / 1000;
    
    // 7. Tabela Oficial de Frete
    let valor = 0, texto = "";
    if (distanciaKm <= 3.0) { valor = 0.00; texto = "R$ 0,00"; } 
    else if (distanciaKm <= 8.0) { valor = 10.00; texto = "R$ 10,00"; }
    else if (distanciaKm <= 14.0) { valor = 15.00; texto = "R$ 15,00"; }
    else if (distanciaKm <= 20.0) { valor = 20.00; texto = "R$ 20,00"; }
    else { return { erro: true, msg: `🚫 Endereço está a ${distanciaKm.toFixed(1)}km (máx de 20km).` }; }
    
    // 8. Arruma o endereço que vai para o Resumo do WhatsApp
    let enderecoFinalParaCliente = `${ruaCorreios}, ${numeroDigitado}`;
    if (complementoDigitado) enderecoFinalParaCliente += ` - ${complementoDigitado}`;
    
    return { valor, texto, endereco: enderecoFinalParaCliente };
    
  } catch (error) { 
    return { valor: 15.00, texto: "R$ 15,00 (Contingência)", endereco: "Endereço via mensagem" }; 
  }
}

module.exports = calcularFreteGoogle;
