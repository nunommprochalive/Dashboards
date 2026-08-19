/* Dashboard v9.3 patch — parte 2 */
function buildModel(){
 const data=buildResults(RESCSV),profiles=buildMargins(MARGCSV),clusters=[...clusterMargins(profiles,'Futebol'),...clusterMargins(profiles,'Ténis'),...clusterMargins(profiles,'Basquetebol')],closed=data.filter(r=>!missing(r.Resultado)&&r['P&L flat']!=null),open=data.filter(r=>missing(r.Resultado)&&!missing(r.Seleção)),assign=assignZonas(data,closed,profiles,clusters);
 const contrHist=closed.filter(r=>!missing(r.Casa_Contraria)&&r['P&L Real']!=null&&(r['Stake Real']||0)>0);
 const seqInfo=buildSequence(data,closed,assign),sequenceByZone=seqInfo.sequenceByZone;
 function cid(r){return assign[txt(r.Competição)]?.cluster}
 const decisions=open.map(r=>{
  const comp=r.Comp_Full,level=txt(r.NIVEL),band=r._band,house=txt(r.Casa_Entrada),a=assign[txt(r.Competição)]||{},
        ownAll=perf(closed.filter(x=>x.Comp_Full===comp&&txt(x.NIVEL)===level)),
        ownRowsComparable=closed.filter(x=>x.Comp_Full===comp&&txt(x.NIVEL)===level&&sameDecisionDropKind(x,r)),
        own=perf(ownRowsComparable);

  const neigh=neighborsFor(r,closed,assign,sequenceByZone);
  const neighborMetrics=neigh.map(n=>({
    meta:n,
    m:perf(closed.filter(x=>
      x.Comp_Full===n.comp &&
      txt(x.NIVEL)===level &&
      sameDecisionDropKind(x,r)
    ))
  })).filter(x=>x.m.vol>0);
  let nWeightSum=0,nSignal=0,nVol=0,nN=0;
  for(const x of neighborMetrics){const w=1/Math.pow(x.meta.distance,1.35);nWeightSum+=w;nSignal+=w*x.m.shrunk;nVol+=w*x.m.vol;nN+=x.m.n}
  const neighborMetric={n:nN,vol:nWeightSum?nVol/nWeightSum:0,pnl:0,roi:nWeightSum?nSignal/nWeightSum:null,shrunk:nWeightSum?nSignal/nWeightSum:0,conf:Math.min(1,(nWeightSum?nVol/nWeightSum:0)/10)};

  const isOther=(a.source==='other');
  const zoneMetric=isOther?perf([]):perf(closed.filter(x=>
    cid(x)===a.cluster &&
    txt(x.NIVEL)===level &&
    sameDecisionDropKind(x,r)
  ));

  const rowsOwn=ownRowsComparable,
        rowsComp=closed.filter(x=>x.Comp_Full===comp&&sameDecisionDropKind(x,r)),
        rowsNeigh=closed.filter(x=>neighborMetrics.some(n=>n.meta.comp===x.Comp_Full)&&txt(x.NIVEL)===level&&sameDecisionDropKind(x,r)),
        rowsZone=isOther?[]:closed.filter(x=>cid(x)===a.cluster&&txt(x.NIVEL)===level&&sameDecisionDropKind(x,r)),
        rowsLevel=closed.filter(x=>txt(x.NIVEL)===level&&sameDecisionDropKind(x,r)),
        rowsBand=closed.filter(x=>x.Comp_Full===comp&&x._band===band&&sameDecisionDropKind(x,r)),
        rowsHouse=closed.filter(x=>txt(x.Casa_Entrada)===house&&txt(x.NIVEL)===level&&sameDecisionDropKind(x,r));

  // AUTONOMIA PELO N da própria célula Competição × Delta.
  const ownN=Math.max(own.n||0,Math.round((own.vol||0)*2));

  function autonomyFromN(n){
    if(n>=30)return .94;
    if(n>=20)return .86+(n-20)*.008;
    if(n>=10)return .68+(n-10)*.018;
    if(n>=5)return .48+(n-5)*.04;
    return .28+n*.04;
  }

  const autonomy=autonomyFromN(ownN);
  const maturity=autonomy;
  const wOwn=autonomy;
  const residual=1-wOwn;

  // Um vizinho só é válido se tiver N próprio na MESMA combinação.
  const qualifiedNeighbors=neighborMetrics.map(x=>{
    const nn=Math.max(x.m.n||0,Math.round((x.m.vol||0)*2));
    const nConf=nn>=20?1:nn>=12?.75:nn>=6?.45:nn>=3?.20:0;
    return {...x,nN:nn,nConf};
  }).filter(x=>x.nConf>0);

  let qW=0,qSignal=0,qVol=0,qN=0;
  for(const x of qualifiedNeighbors){
    const distW=1/Math.pow(x.meta.distance,1.35);
    const w=distW*x.nConf;
    qW+=w;
    qSignal+=w*x.m.shrunk;
    qVol+=w*x.m.vol;
    qN+=x.nN;
  }

  const qualifiedNeighborMetric={
    n:qN,
    vol:qW?qVol/qW:0,
    pnl:0,
    roi:qW?qSignal/qW:null,
    shrunk:qW?qSignal/qW:0,
    conf:Math.min(1,(qW?qVol/qW:0)/10)
  };

  const hasQualifiedNeighbors=qW>0 && !isOther;

  // O residual só é usado para apoio. Quanto maior o N próprio, menor este residual.
  let wNeigh=hasQualifiedNeighbors?residual*.42:0;
  let wZone=!isOther?residual*.10:0;
  let wComp=residual*.25;
  let wLevel=residual*.10;
  let wBand=residual*.08;
  let wHouse=residual*.05;

  // Redistribuir o que não pode ser usado em vizinhos/grupo.
  let unused=residual-(wNeigh+wZone+wComp+wLevel+wBand+wHouse);
  if(unused<0)unused=0;
  wComp+=unused*.50;
  wLevel+=unused*.30;
  wBand+=unused*.20;

  const rowsQualifiedNeigh=closed.filter(x=>
    qualifiedNeighbors.some(n=>n.meta.comp===x.Comp_Full) &&
    txt(x.NIVEL)===level &&
    sameDecisionDropKind(x,r)
  );

  const follow=[
    ['Competição + combinação',wOwn,own],
    ['Competição global',wComp,perf(rowsComp)],
    ['Vizinhos qualificados',wNeigh,qualifiedNeighborMetric],
    ['Grupo estrutural + combinação',wZone,zoneMetric],
    ['Combinação global',wLevel,perf(rowsLevel)],
    ['Competição + gama odd',wBand,perf(rowsBand)],
    ['Casa + combinação',wHouse,perf(rowsHouse)]
  ];

  const probEvidence=[
    {weight:wOwn,rows:rowsOwn},
    {weight:wComp,rows:rowsComp},
    {weight:wNeigh,rows:rowsQualifiedNeigh},
    {weight:wZone,rows:rowsZone},
    {weight:wLevel,rows:rowsLevel},
    {weight:wBand,rows:rowsBand},
    {weight:wHouse,rows:rowsHouse}
  ];
  const fq=qscore(follow,false),anti=qscore(follow,true),
        isF=txt(r.Desporto)==='Futebol'&&txt(r.Mercado)==='1X2',
        isDraw=txt(r.Seleção).toLowerCase().includes('empate');

  // ROI histórico da queda, já ponderado e reduzido pela confiança.
  const roiFHistorical=potentialROI(fq.signal,fq.conf);

  // Uma única distribuição coerente para QUEDA e CONTRARIAN.
  const distribution=coherentDropDistribution(r,roiFHistorical,probEvidence);
  const roiF=distribution.roiDrop;

  const cq=isDraw?null:anti.q;
  const opts=[],explicitChoice=explicitContrarianChoice(r);

  if(!isDraw){
    if(isF){
      // Se Casa_Contraria/Odd_Contraria já escolheu a execução,
      // essa odd tem prioridade para essa modalidade.
      const oddO=(explicitChoice?.mode==='OUTRIGHT'&&explicitChoice.odd!=null)
        ?explicitChoice.odd:r['cont 1ou2'];
      const oddD=(explicitChoice?.mode==='DOUBLE'&&explicitChoice.odd!=null)
        ?explicitChoice.odd:r['cont 1xoux2'];

      const pO=distribution.pOpp;
      const pD=distribution.pDouble;

      opts.push({
        mode:'OUTRIGHT',label:'Vencedor contrário: '+oppositeLabel(r),odd:oddO,
        probability:pO,sample:ownN,
        probabilitySource:'ROI histórico da queda + odd da queda + repartição dos resultados das quedas',
        potential:(oddO!=null&&pO!=null)?(pO*oddO-1)*100:null,
        explicit:explicitChoice?.mode==='OUTRIGHT'
      });

      opts.push({
        mode:'DOUBLE',label:'Dupla hipótese: '+doubleLabel(r),odd:oddD,
        probability:pD,sample:ownN,
        probabilitySource:'complemento coerente da probabilidade da queda',
        potential:(oddD!=null&&pD!=null)?(pD*oddD-1)*100:null,
        explicit:explicitChoice?.mode==='DOUBLE'
      });

    }else if(['Ténis','Basquetebol'].includes(txt(r.Desporto))){
      const odd=r.Odd_Contraria,
            pO=distribution.pOpp;

      opts.push({
        mode:'OUTRIGHT',label:'Vencedor contrário: '+oppositeLabel(r),odd,
        probability:pO,sample:ownN,
        probabilitySource:'complemento coerente da probabilidade da queda',
        potential:(odd!=null&&pO!=null)?(pO*odd-1)*100:null,
        explicit:true
      });
    }
  }

  // Histórico contrarian real continua apenas como validação informativa.
  for(const o of opts){
    const vm=perf(
      contrHist.filter(x=>x.Comp_Full===comp&&txt(x.NIVEL)===level&&contrMode(x.Casa_Contraria)===o.mode),
      'P&L Real','Stake Real',5
    );
    o.validationVol=vm.vol;
    o.validationRoi=vm.roi==null?null:vm.roi*100;
    o.score=cq;
  }

  const rankedOpts=[...opts].sort((x,y)=>(y.potential??-999)-(x.potential??-999));
  const explicitOpt=explicitChoice
    ?rankedOpts.find(o=>o.mode===explicitChoice.mode&&o.odd!=null)
    :null;

  // Se existe Casa_Contraria/Odd_Contraria preenchida, tratamo-la como
  // confirmação de execução do teu processo de leitura do mercado.
  const best=explicitOpt || rankedOpts.find(o=>o.potential!=null) || rankedOpts[0] || null;
  const contrSelectionSource=explicitOpt
    ?(explicitChoice?.reason||'seleção registada')
    :'modelo risco/ROI';
  const roiC=best?.potential??null;
  const maxPotential=Math.max(roiF??-Infinity,roiC??-Infinity);

  // A direção da decisão é agora escolhida pelo EV atual calculado
  // sobre a mesma distribuição de probabilidades.
  const bestStrategy=isDraw
    ?'QUEDA'
    :((roiC!=null&&roiC>(roiF??-Infinity))?'CONTRARIAN':'QUEDA');

  const ownRoiPct=own.roi==null?null:own.roi*100,
        ownEffect=Math.abs(own.shrunk),
        historyStrong=
          (ownN>=20&&ownEffect>=.08) ||
          (ownN>=12&&ownEffect>=.12) ||
          (ownN>=8&&ownEffect>=.18);

  let historicalStrategy=own.shrunk<0?'CONTRARIAN':'QUEDA';
  if(isDraw&&historicalStrategy==='CONTRARIAN')historicalStrategy='QUEDA';

  const historicalAgreement=bestStrategy===historicalStrategy;

  // Convicção histórica: N + magnitude do efeito.
  const nStrength=Math.min(1,ownN/24),
        effectStrength=Math.min(1,ownEffect/.15),
        directConviction=Math.max(0,Math.min(100,
          100*nStrength*(.15+.85*effectStrength)
        ));

  const selectedPotential=bestStrategy==='CONTRARIAN'
    ?(roiC??maxPotential)
    :(roiF??maxPotential);

  // A evidência histórica serve para aumentar/diminuir PRIORIDADE,
  // mas já não força a direção contra o EV atual.
  const valueFactor=selectedPotential<=0?.35:selectedPotential<4?.65:1;
  const agreementFactor=historicalAgreement?1:.55;
  const executionConfirmed=bestStrategy==='CONTRARIAN'&&!!explicitOpt;

  const priorityConviction=Math.min(
    100,
    directConviction*agreementFactor*valueFactor+
    (executionConfirmed&&selectedPotential>0?10:0)
  );

  const focusTier=
    priorityConviction>=75?'FOCO':
    priorityConviction>=55?'BOA':
    priorityConviction>=35?'EXPERIMENTAL':'FRACA';

  let rec;
  if(selectedPotential<=0){
    rec='PASSAR';
  }else if(bestStrategy==='CONTRARIAN'&&cq!=null&&cq>=55){
    rec='CONTRARIAN';
  }else if(bestStrategy==='QUEDA'&&fq.q>=55){
    rec='QUEDA';
  }else{
    rec='OBSERVAR';
  }

  return {...r,
    _fq:fq.q,_fconf:fq.conf,_cq:cq,_cconf:isDraw?null:anti.conf,
    _roiFollow:roiF,_roiFollowHistorical:roiFHistorical,
    _roiContr:roiC,_bestContr:best,_bestModelContr:rankedOpts.find(o=>o.potential!=null)||rankedOpts[0]||null,_opts:rankedOpts,
    _contrSelectionSource:contrSelectionSource,
    _bestPotential:selectedPotential,_maxPotential:maxPotential,_bestStrategy:bestStrategy,_rec:rec,
    _followEv:evList(follow),_cluster:a.cluster,_assignSource:a.source,
    _assignConf:a.confidence,_assignVia:a.via,_ownVol:own.vol,
    _peerVol:qualifiedNeighborMetric.vol,_clusterWeight:wNeigh,
    _ownN:ownN,_heatOwnN:ownAll.n||0,_heatOwnRoi:ownAll.roi==null?null:ownAll.roi*100,
    _dropKind:decisionDropKind(r),
    _pDrop:distribution.pDrop,_pDraw:distribution.pDraw,_pOpp:distribution.pOpp,_pDouble:distribution.pDouble,
    _probCapped:distribution.capped,_oppSplit:distribution.oppositeShare,_oppSplitN:distribution.ownSplitN,
    _maturity:maturity,_ownWeight:wOwn,_autonomy:autonomy,
    _ownRoi:ownRoiPct,_ownShrunk:own.shrunk*100,
    _historyStrong:historyStrong,_historicalStrategy:historicalStrategy,_historicalAgreement:historicalAgreement,
    _executionConfirmed:executionConfirmed,
    _directConviction:directConviction,_priorityConviction:priorityConviction,_focusTier:focusTier,
    _qualifiedNeighbors:qualifiedNeighbors.map(x=>({comp:x.meta.comp,distance:x.meta.distance,n:x.nN})),
    _neighbors:qualifiedNeighbors.map(x=>x.meta),_isDraw:isDraw
  };
 });
 decisions.sort((a,b)=>b._bestPotential-a._bestPotential);
 const overall=perf(closed),hmG=heatMatrix(closed,r=>r.Comp_Full,r=>r._group),hmL=heatMatrix(closed,r=>r.Comp_Full,r=>txt(r.NIVEL));
 return{data,profiles,clusters,assign,closed,open,decisions,hmG,hmL,contrHist,sequenceByZone,summary:{n:closed.length,vol:overall.vol,pnl:overall.pnl,roi:overall.roi?overall.roi*100:0,open:open.length,marginCats:Object.keys(profiles).length,estimated:Object.values(assign).filter(x=>x.source==='other').length},comp:[...new Set(closed.map(x=>x.Comp_Full))].map(k=>({key:k,...perf(closed.filter(x=>x.Comp_Full===k))})).sort((a,b)=>b.vol-a.vol)}
}
