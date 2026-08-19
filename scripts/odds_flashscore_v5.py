import json
import urllib.parse
import urllib.request
import re
import subprocess
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
DIAS_A_PROCURAR = 0
HORA_LIMITE = 8
COMPETICOES_FUTEBOL = ['ARÁBIA SAUDITA: Primeira Liga', 'ARGENTINA: Liga Profesional - Encerramento', 'ALEMANHA: 2. Bundesliga', 'AMÉRICA DO SUL: Taça dos Libertadores - Playoffs', 'AMÉRICA DO SUL: Taça Sul-Americana - Playoffs', 'BRASIL: Série A Betano', 'ESPANHA: LaLiga', 'ESPANHA: LaLiga2', 'INGLATERRA: Championship', 'PORTUGAL: Liga Portugal Betclic', 'PORTUGAL: Liga Portugal 2', 'EUROPA: Liga dos Campeões - Qualificação']
TENIS_ATP_INDIVIDUAIS = True
TENIS_WTA_INDIVIDUAIS = True
COMPETICOES_BASQUETEBOL = ['EUA: WNBA']
RAPIDO_FUTEBOL = {'ARGENTINA: Liga Profesional - Encerramento': 'Liga Profesional Argentina', 'ALEMANHA: 2. Bundesliga': '2. Bundesliga', 'AMÉRICA DO SUL: Taça dos Libertadores - Playoffs': 'Taça dos Libertadores', 'AMÉRICA DO SUL: Taça Sul-Americana - Playoffs': 'Taça Sul-Americana', 'ESPANHA: LaLiga2': 'LaLiga2', 'INGLATERRA: Championship': 'Championship', 'PORTUGAL: Liga Portugal Betclic': 'Liga Portugal', 'PORTUGAL: Liga Portugal 2': 'Liga Portugal 2', 'EUROPA: Liga dos Campeões - Qualificação': 'Champions League Q', 'ESPANHA: LaLiga': 'LaLiga', 'BRASIL: Série A Betano': 'Série A Brasil'}
RAPIDO_BASQUETEBOL = {}
RAPIDO_TENIS_ATP = True
RAPIDO_TENIS_WTA = True
RAPIDO_EXCLUIR = ['QUALIFICAÇÃO', 'PARES']
TIMEZONE = ZoneInfo('Europe/Lisbon')
SPORT_IDS = {'Futebol': 1, 'Ténis': 2, 'Basquetebol': 3}
URL_ODDS = 'https://global.ds.lsapp.eu/odds/pq_graphql'
HEADERS_FEED = {'Origin': 'https://www.flashscore.pt', 'Referer': 'https://www.flashscore.pt/', 'User-Agent': 'Mozilla/5.0', 'x-fsign': 'SW9D1eZo', 'X-GeoIP': '1'}
HEADERS_ODDS = {'Origin': 'https://www.flashscore.pt', 'Referer': 'https://www.flashscore.pt/', 'User-Agent': 'Mozilla/5.0'}
PARAMS_ODDS = {'_hash': 'oce', 'projectId': '20', 'geoIpCode': 'PT', 'geoIpSubdivisionCode': 'PT01'}
BOOKMAKERS = {545: 'Betano', 447: 'Betclic', 459: 'Bwin'}
ORDEM_CASAS = ['Betano', 'Betclic', 'Bwin']
ORDEM_CONTRARIAN = ['Bwin', 'Betano', 'Betclic', 'Solverde']

def normalizar(texto):
    return ' '.join(texto.strip().upper().split())

def campo(bloco, codigo):
    procura = re.search(re.escape(codigo) + '÷([^¬]*)', bloco)
    if procura:
        return procura.group(1).strip()
    return ''

def competicao_desejada(desporto, competicao):
    nome = normalizar(competicao)
    if desporto == 'Futebol':
        desejadas = {normalizar(c) for c in COMPETICOES_FUTEBOL}
        return nome in desejadas
    if desporto == 'Basquetebol':
        desejadas = {normalizar(c) for c in COMPETICOES_BASQUETEBOL}
        return nome in desejadas
    if desporto == 'Ténis':
        if TENIS_ATP_INDIVIDUAIS and nome.startswith('ATP - INDIVIDUAIS:'):
            return True
        if TENIS_WTA_INDIVIDUAIS and nome.startswith('WTA - INDIVIDUAIS:'):
            return True
        return False
    return False

def tem_exclusao_rapida(competicao):
    nome = normalizar(competicao)
    for exclusao in RAPIDO_EXCLUIR:
        if normalizar(exclusao) in nome:
            return True
    return False

def nome_tenis_curto(competicao):
    nome = competicao.strip()
    if nome.upper().startswith('ATP - INDIVIDUAIS:'):
        prefixo = 'ATP'
        resto = nome.split(':', 1)[1].strip()
    elif nome.upper().startswith('WTA - INDIVIDUAIS:'):
        prefixo = 'WTA'
        resto = nome.split(':', 1)[1].strip()
    else:
        return nome
    resto = resto.split('(', 1)[0].strip()
    resto = resto.split(',', 1)[0].strip()
    return f'{prefixo} {resto}'

def nome_competicao_rapida(desporto, competicao):
    if desporto == 'Ténis' and tem_exclusao_rapida(competicao):
        return None
    if desporto == 'Futebol':
        for original, curto in RAPIDO_FUTEBOL.items():
            if normalizar(original) == normalizar(competicao):
                return curto
        return None
    if desporto == 'Basquetebol':
        for original, curto in RAPIDO_BASQUETEBOL.items():
            if normalizar(original) == normalizar(competicao):
                return curto
        return None
    if desporto == 'Ténis':
        nome = normalizar(competicao)
        if RAPIDO_TENIS_ATP and nome.startswith('ATP - INDIVIDUAIS:'):
            return nome_tenis_curto(competicao)
        if RAPIDO_TENIS_WTA and nome.startswith('WTA - INDIVIDUAIS:'):
            return nome_tenis_curto(competicao)
    return None

def gerar_url_feed(desporto, deslocamento_dias):
    sport_id = SPORT_IDS[desporto]
    return f'https://global.flashscore.ninja/20/x/feed/f_{sport_id}_{deslocamento_dias}_1_pt_1'

def descarregar_feed(desporto, deslocamento):
    url = gerar_url_feed(desporto, deslocamento)
    try:
        pedido = urllib.request.Request(url, headers=HEADERS_FEED)
        with urllib.request.urlopen(pedido, timeout=30) as resposta:
            feed = resposta.read().decode('utf-8', errors='replace')
        if 'ZA÷' not in feed or 'AA÷' not in feed:
            return ''
        return feed
    except Exception as erro:
        print(f'   ERRO feed +{deslocamento}: {erro}')
        return ''

def extrair_eventos(feed, desporto):
    eventos = []
    posicoes_za = [m.start() for m in re.finditer(re.escape('ZA÷'), feed)]
    for indice, inicio in enumerate(posicoes_za):
        if indice + 1 < len(posicoes_za):
            fim = posicoes_za[indice + 1]
        else:
            fim = len(feed)
        bloco_competicao = feed[inicio:fim]
        competicao = campo(bloco_competicao, 'ZA')
        if not competicao:
            continue
        if not competicao_desejada(desporto, competicao):
            continue
        posicoes_aa = [m.start() for m in re.finditer(re.escape('AA÷'), bloco_competicao)]
        for indice_evento, inicio_evento in enumerate(posicoes_aa):
            if indice_evento + 1 < len(posicoes_aa):
                fim_evento = posicoes_aa[indice_evento + 1]
            else:
                fim_evento = len(bloco_competicao)
            bloco_evento = bloco_competicao[inicio_evento:fim_evento]
            event_id = campo(bloco_evento, 'AA')
            timestamp = campo(bloco_evento, 'AD')
            equipa1 = campo(bloco_evento, 'CX')
            equipa2 = campo(bloco_evento, 'AF')
            participante1_id = campo(bloco_evento, 'JA')
            participante2_id = campo(bloco_evento, 'JB')
            if not event_id or not timestamp or (not equipa1) or (not equipa2):
                continue
            try:
                data_hora = datetime.fromtimestamp(int(timestamp), tz=TIMEZONE)
            except Exception:
                continue
            eventos.append({'dia': data_hora.strftime('%Y-%m-%d'), 'data_hora': data_hora, 'desporto': desporto, 'competicao': competicao, 'equipa1': equipa1, 'equipa2': equipa2, 'participante1_id': participante1_id, 'participante2_id': participante2_id, 'event_id': event_id})
    return eventos

def valor_abertura(odd):
    if not odd:
        return ''
    return odd.get('opening', '')

def valor_atual(odd):
    if not odd:
        return ''
    if odd.get('active') is False:
        return ''
    return odd.get('value', '')

def mercados_possiveis(desporto):
    if desporto == 'Futebol':
        return [('HOME_DRAW_AWAY', 'FULL_TIME'), ('DOUBLE_CHANCE', 'FULL_TIME')]
    if desporto == 'Ténis':
        return [('HOME_AWAY', 'FULL_TIME'), ('HOME_DRAW_AWAY', 'FULL_TIME')]
    if desporto == 'Basquetebol':
        return [('HOME_DRAW_AWAY', 'FULL_TIME'), ('HOME_AWAY', 'FULL_TIME')]
    return []

def extrair_mapa_bookmakers(objeto):
    encontrados = {}

    def visitar(valor):
        if isinstance(valor, dict):
            bookmaker_id = None
            bookmaker_nome = None
            for chave_id in ['bookmakerId', 'bookmaker_id']:
                if chave_id in valor:
                    bookmaker_id = valor.get(chave_id)
                    break
            for chave_nome in ['bookmakerName', 'bookmaker_name', 'name', 'title']:
                candidato = valor.get(chave_nome)
                if isinstance(candidato, str):
                    candidato_norm = normalizar(candidato)
                    if any((palavra in candidato_norm for palavra in ['BETANO', 'BETCLIC', 'BWIN', 'SOLVERDE'])):
                        bookmaker_nome = candidato
                        break
            if bookmaker_id is not None and bookmaker_nome:
                encontrados[bookmaker_id] = bookmaker_nome
            for filho in valor.values():
                visitar(filho)
        elif isinstance(valor, list):
            for filho in valor:
                visitar(filho)
    visitar(objeto)
    return encontrados

def normalizar_nome_casa(nome):
    nome_norm = normalizar(nome)
    if 'SOLVERDE' in nome_norm:
        return 'Solverde'
    if 'BETANO' in nome_norm:
        return 'Betano'
    if 'BETCLIC' in nome_norm:
        return 'Betclic'
    if 'BWIN' in nome_norm:
        return 'Bwin'
    return None

def identificar_selecao(odd, participante1_id, participante2_id):
    participante_odd = odd.get('eventParticipantId')
    if participante_odd is None or participante_odd == '':
        return 'X'
    if participante1_id and participante_odd == participante1_id:
        return '1'
    if participante2_id and participante_odd == participante2_id:
        return '2'
    return None

def identificar_dupla(odd, indice=None, total=None):
    selecao = odd.get('selection')
    if selecao is not None:
        s = normalizar(str(selecao))
        s = s.replace('HOME', '1').replace('AWAY', '2').replace('DRAW', 'X').replace('_', '').replace('-', '').replace('/', '').replace(' ', '')
        if s in {'1X', 'X1'}:
            return '1X'
        if s in {'X2', '2X'}:
            return 'X2'
        if s in {'12', '21'}:
            return '12'
    if total == 3 and indice is not None:
        fallback = ['1X', '12', 'X2']
        if 0 <= indice < 3:
            return fallback[indice]
    return None

def consultar_odds(evento):
    event_id = evento['event_id']
    desporto = evento['desporto']
    participante1_id = evento.get('participante1_id', '')
    participante2_id = evento.get('participante2_id', '')
    params = PARAMS_ODDS.copy()
    params['eventId'] = event_id
    url_completa = URL_ODDS + '?' + urllib.parse.urlencode(params)
    pedido = urllib.request.Request(url_completa, headers=HEADERS_ODDS)
    with urllib.request.urlopen(pedido, timeout=20) as resposta:
        dados = json.loads(resposta.read().decode('utf-8'))
    comparacao = dados.get('data', {}).get('findOddsByEventId')
    if not comparacao:
        return {}
    resultado = {'__double_chance__': {}}
    mapa_bookmakers = dict(BOOKMAKERS)
    for bookmaker_id, bookmaker_nome in extrair_mapa_bookmakers(dados).items():
        nome_casa = normalizar_nome_casa(bookmaker_nome)
        if nome_casa:
            mapa_bookmakers[bookmaker_id] = nome_casa
    mercados_validos = mercados_possiveis(desporto)
    for mercado in comparacao.get('odds', []):
        chave_mercado = (mercado.get('bettingType'), mercado.get('bettingScope'))
        if chave_mercado not in mercados_validos:
            continue
        bookmaker_id = mercado.get('bookmakerId')
        casa = mapa_bookmakers.get(bookmaker_id)
        if not casa:
            for chave_nome in ['bookmakerName', 'bookmaker_name', 'name']:
                nome_direto = mercado.get(chave_nome)
                if isinstance(nome_direto, str):
                    casa = normalizar_nome_casa(nome_direto)
                    if casa:
                        break
        if casa not in {'Betano', 'Betclic', 'Bwin', 'Solverde'}:
            continue
        odds_mercado = mercado.get('odds', [])
        if not odds_mercado:
            continue
        betting_type = mercado.get('bettingType')
        if desporto == 'Futebol' and betting_type == 'DOUBLE_CHANCE':
            if casa not in resultado['__double_chance__']:
                resultado['__double_chance__'][casa] = {'1X_inicio': '', '1X_atual': '', '12_inicio': '', '12_atual': '', 'X2_inicio': '', 'X2_atual': ''}
            for indice, odd in enumerate(odds_mercado):
                selecao_dupla = identificar_dupla(odd, indice=indice, total=len(odds_mercado))
                if not selecao_dupla:
                    continue
                resultado['__double_chance__'][casa][f'{selecao_dupla}_inicio'] = valor_abertura(odd)
                resultado['__double_chance__'][casa][f'{selecao_dupla}_atual'] = valor_atual(odd)
            continue
        if casa not in resultado:
            resultado[casa] = {'1_inicio': '', '1_atual': '', '2_inicio': '', '2_atual': '', 'X_inicio': '', 'X_atual': ''}
        for odd in odds_mercado:
            selecao = identificar_selecao(odd, participante1_id, participante2_id)
            if not selecao:
                continue
            resultado[casa][f'{selecao}_inicio'] = valor_abertura(odd)
            resultado[casa][f'{selecao}_atual'] = valor_atual(odd)
    return resultado

def para_float(valor):
    try:
        if valor is None or valor == '':
            return None
        return float(valor)
    except Exception:
        return None

def esta_em_queda(odds, selecao):
    comparacoes = []
    for casa in ORDEM_CASAS:
        dados = odds.get(casa, {})
        inicio = para_float(dados.get(f'{selecao}_inicio', ''))
        atual = para_float(dados.get(f'{selecao}_atual', ''))
        if inicio is None or atual is None:
            continue
        comparacoes.append(atual < inicio)
    if not comparacoes:
        return False
    return all(comparacoes)

def odds_saida_rapida(odds, selecao):
    valores = []
    for casa in ORDEM_CASAS:
        valor = odds.get(casa, {}).get(f'{selecao}_atual', '')
        if valor is None or valor == '':
            valor = 0
        valores.append(str(valor))
    return valores

def melhor_odd_contrarian(odds, selecao, dupla=False, mostrar_selecao=True):
    melhor_casa = ''
    melhor_valor = None
    origem = odds.get('__double_chance__', {}) if dupla else odds
    for casa in ORDEM_CONTRARIAN:
        dados = origem.get(casa, {})
        valor = para_float(dados.get(f'{selecao}_atual', ''))
        if valor is None:
            continue
        if melhor_valor is None or valor > melhor_valor:
            melhor_valor = valor
            melhor_casa = casa
    if melhor_valor is None:
        return ('', '')
    nome_saida = f'{melhor_casa} {selecao}' if mostrar_selecao else melhor_casa
    return (nome_saida, melhor_valor)

def melhor_valor_contrarian(odds, selecao, dupla=False):
    origem = odds.get('__double_chance__', {}) if dupla else odds
    melhor_valor = None
    for casa in ORDEM_CONTRARIAN:
        dados = origem.get(casa, {})
        valor = para_float(dados.get(f'{selecao}_atual', ''))
        if valor is None:
            continue
        if melhor_valor is None or valor > melhor_valor:
            melhor_valor = valor
    if melhor_valor is None:
        return ''
    return melhor_valor

def valores_apoio_contrarian_futebol(odds, selecao_queda):
    if selecao_queda not in {'1', '2'}:
        return ('', '', '')
    oposta = '2' if selecao_queda == '1' else '1'
    dupla_contraria = 'X2' if selecao_queda == '1' else '1X'
    cont_x = melhor_valor_contrarian(odds, 'X', dupla=False)
    cont_1ou2 = melhor_valor_contrarian(odds, oposta, dupla=False)
    cont_1xoux2 = melhor_valor_contrarian(odds, dupla_contraria, dupla=True)
    return (cont_x, cont_1ou2, cont_1xoux2)

def movimentos_selecao(odds, selecao, casas=None):
    """
    Classifica abertura -> atual por casa.
    Por defeito usa Betano, Betclic e Bwin.
    """
    if casas is None:
        casas = ORDEM_CASAS
    resultado = {}
    for casa in casas:
        dados = odds.get(casa, {})
        inicio = para_float(dados.get(f'{selecao}_inicio', ''))
        atual = para_float(dados.get(f'{selecao}_atual', ''))
        if inicio is None or atual is None:
            resultado[casa] = 'sem_dados'
            continue
        if atual > inicio:
            resultado[casa] = 'subida'
        elif atual < inicio:
            resultado[casa] = 'queda'
        else:
            resultado[casa] = 'neutro'
    return resultado

def movimento_misto(odds, selecao):
    estados = list(movimentos_selecao(odds, selecao, ORDEM_CASAS).values())
    estados_validos = [estado for estado in estados if estado != 'sem_dados']
    return 'subida' in estados_validos and 'queda' in estados_validos

def sobe_em_todas_as_casas(odds, selecao):
    """
    Regra estrita:
    Betano, Betclic e Bwin têm abertura + atual válidas
    e a odd sobe nas três.
    """
    estados = movimentos_selecao(odds, selecao, ORDEM_CASAS)
    return all((estados.get(casa) == 'subida' for casa in ORDEM_CASAS))

def criterio_contrarian_futebol(odds, selecao_queda):
    """
    Escolhe vencedor contrário ou hipótese dupla.

    Prioridade:
      1) Empate misto + vencedor contrário sobe nas 3 casas
         -> vencedor contrário.
      2) Fallback da lógica anterior:
         empate em queda -> vencedor contrário;
         empate neutro/subida -> hipótese dupla.
    """
    if selecao_queda not in {'1', '2'}:
        return None
    oposta = '2' if selecao_queda == '1' else '1'
    dupla_contraria = 'X2' if selecao_queda == '1' else '1X'
    if movimento_misto(odds, 'X') and sobe_em_todas_as_casas(odds, oposta):
        return {'tipo': 'vencedor', 'selecao': oposta, 'dupla': False, 'motivo': 'empate misto + vencedor contrário a subir nas 3 casas'}
    tendencia = tendencia_empate(odds)
    if tendencia is None:
        return None
    if tendencia == 'queda':
        return {'tipo': 'vencedor', 'selecao': oposta, 'dupla': False, 'motivo': 'fallback: empate tendencialmente em queda'}
    return {'tipo': 'dupla', 'selecao': dupla_contraria, 'dupla': True, 'motivo': 'fallback: empate neutro/subida'}

def tendencia_empate(odds):
    variacoes = []
    for casa in ORDEM_CONTRARIAN:
        dados = odds.get(casa, {})
        inicio = para_float(dados.get('X_inicio', ''))
        atual = para_float(dados.get('X_atual', ''))
        if inicio is None or atual is None or inicio == 0:
            continue
        variacoes.append((atual - inicio) / inicio)
    if not variacoes:
        return None
    media = sum(variacoes) / len(variacoes)
    if media < 0:
        return 'queda'
    return 'subida'

def calcular_contrarian(evento, odds, selecao_queda):
    desporto = evento['desporto']
    if selecao_queda == 'X':
        return ('', '')
    if desporto in {'Ténis', 'Basquetebol'}:
        oposta = '2' if selecao_queda == '1' else '1'
        return melhor_odd_contrarian(odds, oposta, dupla=False, mostrar_selecao=False)
    if desporto == 'Futebol':
        criterio = criterio_contrarian_futebol(odds, selecao_queda)
        if criterio is None:
            return ('', '')
        return melhor_odd_contrarian(odds, criterio['selecao'], dupla=criterio['dupla'])
    return ('', '')
agora = datetime.now(TIMEZONE)
ultimo_dia = agora.date() + timedelta(days=DIAS_A_PROCURAR)
dia_fim_completo = ultimo_dia + timedelta(days=1)
fim_completo = datetime(dia_fim_completo.year, dia_fim_completo.month, dia_fim_completo.day, HORA_LIMITE, 0, 0, tzinfo=TIMEZONE)
amanha = agora.date() + timedelta(days=1)
fim_rapido = datetime(amanha.year, amanha.month, amanha.day, 8, 0, 0, tzinfo=TIMEZONE)
print()
print('=' * 76)
print('FLASHSCORE ODDS — AUTOMÁTICO')
print('=' * 76)
print()
print('Completo:', agora.strftime('%Y-%m-%d %H:%M'), '→', fim_completo.strftime('%Y-%m-%d %H:%M'))
print('Rápido:  ', agora.strftime('%Y-%m-%d %H:%M'), '→', fim_rapido.strftime('%Y-%m-%d %H:%M'))
todos_eventos = []
ultimo_feed = DIAS_A_PROCURAR + 1
for desporto in SPORT_IDS:
    print()
    print(f'--- {desporto.upper()} ---')
    for deslocamento in range(0, ultimo_feed + 1):
        feed = descarregar_feed(desporto, deslocamento)
        if not feed:
            print(f'   +{deslocamento}: sem feed válido')
            continue
        eventos_feed = extrair_eventos(feed, desporto)
        print(f'   +{deslocamento}: {len(eventos_feed)} eventos selecionados')
        todos_eventos.extend(eventos_feed)
eventos = [evento for evento in todos_eventos if agora <= evento['data_hora'] <= fim_completo]
eventos_unicos = {}
for evento in eventos:
    eventos_unicos[evento['event_id']] = evento
eventos = list(eventos_unicos.values())
ORDEM_DESPORTOS = {'Futebol': 1, 'Ténis': 2, 'Basquetebol': 3}
eventos.sort(key=lambda e: (e['data_hora'], ORDEM_DESPORTOS.get(e['desporto'], 99), e['competicao']))
cabecalho_grupos = ['', '', '', '', '', '', 'Início', '', '', '', '', '', '', '', '', 'Atual', '', '', '', '', '', '', '', '']
cabecalho = ['Dia', 'Desporto', 'Competição', 'Equipa 1', 'Equipa 2', 'EventID', 'Betano 1', 'Betclic 1', 'Bwin 1', 'Betano 2', 'Betclic 2', 'Bwin 2', 'Betano X', 'Betclic X', 'Bwin X', 'Betano 1', 'Betclic 1', 'Bwin 1', 'Betano 2', 'Betclic 2', 'Bwin 2', 'Betano X', 'Betclic X', 'Bwin X']
resultado_completo = ['\t'.join(cabecalho_grupos), '\t'.join(cabecalho)]
resultado_rapido = ['\t'.join(['Dia', 'Desporto', 'Competição', 'Equipa 1', 'Equipa 2', 'Seleção', 'Mercado', 'Betano', 'Betclic', 'Bwin', 'Casa_Contraria', 'Odd_Contraria', 'cont x', 'cont 1ou2', 'cont 1xoux2'])]
print()
print('=' * 76)
print('A CONSULTAR ODDS')
print('=' * 76)
print()
for numero, evento in enumerate(eventos, start=1):
    print(f"[{numero}/{len(eventos)}] {evento['dia']} | {evento['desporto']} | {evento['equipa1']} vs {evento['equipa2']}")
    try:
        odds = consultar_odds(evento)
    except Exception as erro:
        print(f'   ERRO: {erro}')
        odds = {}
    linha_completa = [evento['dia'], evento['desporto'], evento['competicao'], evento['equipa1'], evento['equipa2'], evento['event_id']]
    for selecao in ['1', '2', 'X']:
        for casa in ORDEM_CASAS:
            linha_completa.append(odds.get(casa, {}).get(f'{selecao}_inicio', ''))
    for selecao in ['1', '2', 'X']:
        for casa in ORDEM_CASAS:
            linha_completa.append(odds.get(casa, {}).get(f'{selecao}_atual', ''))
    resultado_completo.append('\t'.join((str(valor) for valor in linha_completa)))
    if not agora <= evento['data_hora'] <= fim_rapido:
        continue
    nome_curto = nome_competicao_rapida(evento['desporto'], evento['competicao'])
    if not nome_curto:
        continue
    if esta_em_queda(odds, '1'):
        mercado = '1X2' if evento['desporto'] == 'Futebol' else 'Vencedor'
        valores = odds_saida_rapida(odds, '1')
        casa_contraria, odd_contraria = calcular_contrarian(evento, odds, '1')
        if evento['desporto'] == 'Futebol':
            cont_x, cont_1ou2, cont_1xoux2 = valores_apoio_contrarian_futebol(odds, '1')
        else:
            cont_x = ''
            cont_1ou2 = ''
            cont_1xoux2 = ''
        resultado_rapido.append('\t'.join([evento['dia'], evento['desporto'], nome_curto, evento['equipa1'], evento['equipa2'], evento['equipa1'], mercado, valores[0], valores[1], valores[2], str(casa_contraria), str(odd_contraria), str(cont_x), str(cont_1ou2), str(cont_1xoux2)]))
    if esta_em_queda(odds, '2'):
        mercado = '1X2' if evento['desporto'] == 'Futebol' else 'Vencedor'
        valores = odds_saida_rapida(odds, '2')
        casa_contraria, odd_contraria = calcular_contrarian(evento, odds, '2')
        if evento['desporto'] == 'Futebol':
            cont_x, cont_1ou2, cont_1xoux2 = valores_apoio_contrarian_futebol(odds, '2')
        else:
            cont_x = ''
            cont_1ou2 = ''
            cont_1xoux2 = ''
        resultado_rapido.append('\t'.join([evento['dia'], evento['desporto'], nome_curto, evento['equipa1'], evento['equipa2'], evento['equipa2'], mercado, valores[0], valores[1], valores[2], str(casa_contraria), str(odd_contraria), str(cont_x), str(cont_1ou2), str(cont_1xoux2)]))
    if evento['desporto'] == 'Futebol' and esta_em_queda(odds, 'X'):
        valores = odds_saida_rapida(odds, 'X')
        casa_contraria = ''
        odd_contraria = ''
        resultado_rapido.append('\t'.join([evento['dia'], evento['desporto'], nome_curto, evento['equipa1'], evento['equipa2'], 'Empate', '1X2', valores[0], valores[1], valores[2], str(casa_contraria), str(odd_contraria), '', '', '']))

def chave_evento_rapido(dia, desporto, competicao, equipa1, equipa2):
    return (dia, desporto, normalizar(competicao), normalizar(equipa1), normalizar(equipa2))
HORAS_EVENTOS_RAPIDO = {}
for evento in eventos:
    nome_curto_evento = nome_competicao_rapida(evento['desporto'], evento['competicao'])
    if not nome_curto_evento:
        continue
    chave = chave_evento_rapido(evento['dia'], evento['desporto'], nome_curto_evento, evento['equipa1'], evento['equipa2'])
    HORAS_EVENTOS_RAPIDO[chave] = evento['data_hora']

def dados_linha_rapida(linha):
    colunas = linha.split('\t')
    return {'dia': colunas[0] if len(colunas) > 0 else '', 'desporto': colunas[1] if len(colunas) > 1 else '', 'competicao': colunas[2] if len(colunas) > 2 else '', 'equipa1': colunas[3] if len(colunas) > 3 else '', 'equipa2': colunas[4] if len(colunas) > 4 else '', 'selecao': colunas[5] if len(colunas) > 5 else ''}

def hora_linha_rapida(linha):
    dados = dados_linha_rapida(linha)
    chave = chave_evento_rapido(dados['dia'], dados['desporto'], dados['competicao'], dados['equipa1'], dados['equipa2'])
    return HORAS_EVENTOS_RAPIDO.get(chave, datetime.max.replace(tzinfo=TIMEZONE))
if len(resultado_rapido) > 1:
    cabecalho_rapido = resultado_rapido[0]
    linhas_rapidas = resultado_rapido[1:]
    primeira_hora_desporto = {}
    primeira_hora_competicao = {}
    for linha in linhas_rapidas:
        dados = dados_linha_rapida(linha)
        hora = hora_linha_rapida(linha)
        desporto = dados['desporto']
        competicao = normalizar(dados['competicao'])
        if desporto not in primeira_hora_desporto or hora < primeira_hora_desporto[desporto]:
            primeira_hora_desporto[desporto] = hora
        chave_comp = (desporto, competicao)
        if chave_comp not in primeira_hora_competicao or hora < primeira_hora_competicao[chave_comp]:
            primeira_hora_competicao[chave_comp] = hora

    def chave_ordenacao_rapida(linha):
        dados = dados_linha_rapida(linha)
        hora = hora_linha_rapida(linha)
        desporto = dados['desporto']
        competicao = normalizar(dados['competicao'])
        return (primeira_hora_desporto.get(desporto, datetime.max.replace(tzinfo=TIMEZONE)), primeira_hora_competicao.get((desporto, competicao), datetime.max.replace(tzinfo=TIMEZONE)), hora, normalizar(dados['equipa1']), normalizar(dados['equipa2']), normalizar(dados['selecao']))
    linhas_rapidas.sort(key=chave_ordenacao_rapida)
    resultado_rapido = [cabecalho_rapido, *linhas_rapidas]
pasta_script = Path(__file__).resolve().parent
ficheiro_completo = pasta_script / 'odds_flashscore.tsv'
ficheiro_rapido = pasta_script / 'entradas_flashscore.tsv'
texto_completo = '\n'.join(resultado_completo)
texto_rapido = '\n'.join(resultado_rapido)
with open(ficheiro_completo, 'w', encoding='utf-8') as ficheiro:
    ficheiro.write(texto_completo)
with open(ficheiro_rapido, 'w', encoding='utf-8') as ficheiro:
    ficheiro.write(texto_rapido)
clipboard_ok = False
if sys.platform == 'darwin':
    try:
        subprocess.run(['pbcopy'], input=texto_rapido, text=True, check=True)
        clipboard_ok = True
    except Exception:
        clipboard_ok = False
numero_entradas_rapidas = max(0, len(resultado_rapido) - 1)
print()
print('=' * 76)
print('CONCLUÍDO')
print('=' * 76)
print()
print(f'Eventos completos: {len(eventos)}')
print(f'Entradas rápidas: {numero_entradas_rapidas}')
print()
print('Ficheiro completo:')
print(ficheiro_completo)
print()
print('Ficheiro rápido:')
print(ficheiro_rapido)
if clipboard_ok:
    print()
    print('A versão RÁPIDA também foi copiada para a área de transferência.')
print()
