/* Dashboard v9.3 patch — parte 1 */
function contrMode(s){
 s=txt(s).toUpperCase();
 if(/X2|1X/.test(s))return'DOUBLE';
 if(/(?:^|\s)[12]$/.test(s))return'OUTRIGHT';
 return'OTHER'
}

function explicitContrarianChoice(r){
 const mode=contrMode(r.Casa_Contraria);
 if((mode==='OUTRIGHT'||mode==='DOUBLE') && r.Odd_Contraria!=null){
   return {mode,odd:r.Odd_Contraria,reason:'Casa_Contraria / Odd_Contraria'}
 }

 // Preparado para uma futura automatização do movimento, sem exigir já novas colunas.
 // Se um CSV futuro trouxer estes campos, a regra passa a funcionar automaticamente.
 const drawMove=txt(
   r.Mov_Empate ?? r['Mov. Empate'] ?? r['Movimento Empate'] ?? r['Movimento do Empate']
 ).toLowerCase();
 const oppMove=txt(
   r.Mov_Contrario ?? r['Mov. Contrário'] ?? r['Movimento Contrário'] ??
   r['Movimento Vencedor Contrário']
 ).toLowerCase();

 const drawMixed=/misto|mixed|↕|up.?down|sobe.*desce|desce.*sobe/.test(drawMove);
 const oppAllUp=/↑↑↑|todas.*sub|sub.*todas|3.*sub|all.*up/.test(oppMove);

 if(drawMixed&&oppAllUp){
   return {mode:'OUTRIGHT',odd:r.Odd_Contraria??r['cont 1ou2'],reason:'empate misto + vencedor contrário ↑ nas 3 casas'}
 }
 return null
}

function decisionDropKind(r){
  if(txt(r.Desporto)==='Futebol'){
    return dropSide(r)==='DRAW'?'FOOTBALL_DRAW':'FOOTBALL_TEAM'
  }
  return 'BINARY'
}

function sameDecisionDropKind(a,b){
  return decisionDropKind(a)===decisionDropKind(b)
}

function oppositeShareMetric(rows){
  // Futebol: entre as vezes em que a equipa em queda NÃO venceu,
  // qual foi a fração em que venceu a equipa contrária (vs empate)?
  let fails=0,oppWins=0;

  for(const r of rows){
    if(txt(r.Desporto)!=='Futebol')continue;

    const side=dropSide(r);
    if(!side||side==='DRAW')continue;

    const out=footballOutcome(r);
    if(!out)continue;

    const dropWon=(side==='HOME'&&out==='HOME')||(side==='AWAY'&&out==='AWAY');
    if(dropWon)continue;

    fails++;

    const oppWon=(side==='HOME'&&out==='AWAY')||(side==='AWAY'&&out==='HOME');
    if(oppWon)oppWins++;
  }

  // Beta(1,1): evita 0%/100% artificiais em amostras pequenas.
  const p=(oppWins+1)/(fails+2);

  return {
    n:fails,
    hits:oppWins,
    p,
    conf:Math.min(1,fails/16)
  };
}

function weightedOppositeShare(evidenceBuckets){
  let S=0,W=0;
  let own={n:0,hits:0,p:.5,conf:0};

  evidenceBuckets.forEach((e,i)=>{
    const m=oppositeShareMetric(e.rows);
    if(i===0)own=m;
    if(m.n===0)return;

    const reliability=.30+.70*m.conf;
    const w=e.weight*reliability;

    S+=w*m.p;
    W+=w;
  });

  return {
    p:W?S/W:.5,
    ownN:own.n,
    ownHits:own.hits,
    ownP:own.p
  };
}

function coherentDropDistribution(r,roiDropPct,evidenceBuckets){
  /*
    PRINCÍPIO CENTRAL v9.3

    A estimativa nasce APENAS do histórico da QUEDA:

      ROI_queda = p(queda) * odd_queda - 1

    Logo:
      p(queda) = (1 + ROI_queda) / odd_queda

    O ROI usado aqui já é o ROI histórico ponderado/shrunk do painel
    (competição + combinação domina; vizinhos entram sobretudo com N baixo).

    Depois, todas as alternativas são calculadas sobre a MESMA distribuição.
  */

  const oddDrop=num(r.Odd_Entrada);

  if(oddDrop==null||oddDrop<=1){
    return {
      pDrop:null,pDraw:null,pOpp:null,pDouble:null,
      roiDrop:null,rawPDrop:null,capped:false,
      oppositeShare:null,ownSplitN:0
    };
  }

  const edge=(roiDropPct||0)/100;
  const rawPDrop=(1+edge)/oddDrop;

  // Probabilidade tem de ser válida. O cap só afeta casos matematicamente
  // impossíveis (tipicamente odd muito baixa + ROI histórico muito elevado).
  const pDrop=Math.max(.005,Math.min(.995,rawPDrop));
  const capped=Math.abs(pDrop-rawPDrop)>1e-9;

  const kind=decisionDropKind(r);

  // O ROI coerente é recalculado depois do eventual cap.
  const roiDrop=(pDrop*oddDrop-1)*100;

  if(kind==='FOOTBALL_TEAM'){
    const split=weightedOppositeShare(evidenceBuckets);

    const pNotDrop=1-pDrop;
    const pOpp=pNotDrop*split.p;
    const pDraw=pNotDrop-pOpp;

    return {
      pDrop,pDraw,pOpp,pDouble:pNotDrop,
      roiDrop,rawPDrop,capped,
      oppositeShare:split.p,
      ownSplitN:split.ownN,
      ownSplitHits:split.ownHits
    };
  }

  if(kind==='BINARY'){
    return {
      pDrop,pDraw:0,pOpp:1-pDrop,pDouble:null,
      roiDrop,rawPDrop,capped,
      oppositeShare:null,ownSplitN:0
    };
  }

  // Queda no empate: apenas avaliamos seguir a queda.
  return {
    pDrop,pDraw:null,pOpp:null,pDouble:null,
    roiDrop,rawPDrop,capped,
    oppositeShare:null,ownSplitN:0
  };
}
