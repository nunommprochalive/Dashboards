/* Dashboard v9.3 patch — parte 4 */
function renderDecision(){
 const cf=document.getElementById('dfComp').value,rf=document.getElementById('dfRec').value,
 allDs=[...MODEL.decisions],
 plan=stakePlan(allDs),stakeMap=new Map(plan.rows.map(x=>[x.d,x])),
 maxScore=d=>Math.max(d._fq??0,d._cq??0),
 ds=allDs.filter(d=>(!cf||txt(d.Competição)===cf)&&(!rf||d._rec===rf))
   .sort((a,b)=>{
      const ca=a._priorityConviction||a._directConviction||0,
            cb=b._priorityConviction||b._directConviction||0,
            sa=stakeMap.get(a)?.stake||0,sb=stakeMap.get(b)?.stake||0;
      return cb-ca || sb-sa || maxScore(b)-maxScore(a) ||
             (b._bestPotential??-999)-(a._bestPotential??-999);
   });
 if(document.getElementById('bankSummary')){
   document.getElementById('bankSummary').innerHTML=plan.b.total>0?
     `Saldo total: <b>${eur(plan.b.total)}</b> · exposição sugerida do painel completo: <b>${eur(plan.total)}</b> (${pct(plan.b.total?100*plan.total/plan.b.total:0)})${plan.scale<1?' · <span class="amber">reduzida pelo limite diário</span>':''}`:
     'Preenche os saldos para calcular as stakes sugeridas.';
 }

 document.getElementById('decisionNotice').innerHTML=
 `<div class="warn"><b>${MODEL.open.length}</b> entradas em aberto. O ranking usa um EV coerente: o ROI histórico ajustado da queda é convertido em p(queda) através da odd atual; QUEDA, vencedor contrário e dupla hipótese são depois avaliados sobre a mesma distribuição. N e magnitude histórica determinam a força/prioridade, mas já não forçam uma direção contra o EV atual. Se Casa_Contraria/Odd_Contraria estiver preenchida, essa execução é respeitada como confirmação do teu processo de leitura do mercado. Quedas no Empate são avaliadas apenas como QUEDA.</div>`;

 document.getElementById('decisions').innerHTML=ds.map((d,i)=>{
   const sclass=d._assignSource==='real'?'real':'estimated',
         src=d._assignSource==='real'?'margem real':'Outras';

   let contr='Sem contrarian — queda no Empate';
   if(!d._isDraw){
     const modes=d._opts.map(o=>{
       const odd=o.odd!=null?` @ ${fmt(o.odd,2)}`:' · odd por confirmar';
       const pot=o.potential!=null?` · <b class="${o.potential>=0?'good':'bad'}">ROI pot. ${pct(o.potential)}</b>`:' · ROI pot. aguarda odd';
       const prob=o.probability!=null?` · p modelo ${pct(o.probability*100)} · N próprio ${o.sample||0}`:'';
       const formula=(o.probability!=null&&o.odd!=null)
         ?`<div class="meta">EV: ${pct(o.probability*100)} × ${fmt(o.odd,2)} − 1 = <b>${pct(o.potential)}</b></div>`
         :'';
       const validation=o.validationVol?
         ` · validação real: ${fmt(o.validationVol,1)}u / ${o.validationRoi==null?'—':pct(o.validationRoi)}`:
         '';
       const picked=o.mode===d._bestContr?.mode&&o.odd===d._bestContr?.odd
         ?` <span class="pill">${d._contrSelectionSource?.startsWith('Casa_')?'seleção registada':'selecionada'}</span>`:'';
       return `<div style="margin-top:5px"><b>${esc(o.label)}</b>${picked}${odd}${pot}${prob}${validation}${formula}</div>`;
     }).join('');
     contr=`<div><b>Sinal base contra a queda</b> · score ${fmt(d._cq,0)} · ROI pot. <span class="${(d._roiContr||0)>=0?'good':'bad'}">${pct(d._roiContr)}</span>${modes}</div>`;
   }

   return `<div class="decision">
     <div class="rank">#${i+1}</div>
     <div>
       <div class="teams">${esc(d['Equipa 1'])} — ${esc(d['Equipa 2'])}<span class="cluster">${esc(d._cluster||'?')}</span><span class="source ${sclass}">${src}</span></div>
       <div class="meta">${esc(d.Dia)} · ${esc(d.Competição)} · queda: <b>${esc(d.Seleção)}</b> · ${esc(d.NIVEL)} / ${esc(d._group)}</div>
       <div class="meta">Odds ${fmt(d.Betano,2)} / ${fmt(d.Betclic,2)} / ${fmt(d.Bwin,2)} · melhor ${esc(d.Casa_Entrada)} ${fmt(d.Odd_Entrada,2)}</div>
       <div class="meta">Hist. próprio combinação ${fmt(d._ownVol,1)}u / N≈${d._ownN||0} · autonomia ${fmt((d._autonomy||0)*100,0)}% · peso próprio ${fmt((d._ownWeight||0)*100,0)}% · peso vizinhos ${fmt((d._clusterWeight||0)*100,0)}%</div>
       <div class="meta"><b>Heat map célula:</b> ROI ${d._heatOwnRoi==null?'—':pct(d._heatOwnRoi)} · N ${d._heatOwnN||0}</div>
       <div class="meta"><b>Amostra relevante para esta decisão:</b> ${d._dropKind==='FOOTBALL_TEAM'?'quedas em equipas':d._dropKind==='FOOTBALL_DRAW'?'quedas no empate':'quedas equivalentes'} · ROI ${d._ownRoi==null?'—':pct(d._ownRoi)} · ROI ajustado ${pct(d._ownShrunk||0)} · N ${d._ownN||0}</div>
       <div class="meta"><b>Direção histórica:</b> ${esc(d._historicalStrategy||'—')} ${d._historicalAgreement?'<span class="pill">confirma o EV atual</span>':'<span class="pill">em conflito com o EV atual</span>'} · força ${fmt(d._directConviction||0,0)}/100 · prioridade ${fmt(d._priorityConviction||0,0)}/100 · <b>${esc(d._focusTier||'—')}</b></div>
       <div class="meta"><b>Probabilidade coerente:</b> ${
         d._dropKind==='FOOTBALL_TEAM'
           ?`queda ${pct((d._pDrop||0)*100)} · empate ${pct((d._pDraw||0)*100)} · vencedor contrário ${pct((d._pOpp||0)*100)} = 100%`
           :d._dropKind==='BINARY'
             ?`queda ${pct((d._pDrop||0)*100)} · contrário ${pct((d._pOpp||0)*100)} = 100%`
             :`empate em queda ${pct((d._pDrop||0)*100)}`
       }${d._probCapped?' · <span class="amber">probabilidade limitada a intervalo válido</span>':''}</div>
       <div class="meta">Vizinhos qualificados: ${d._qualifiedNeighbors?.length?d._qualifiedNeighbors.map(n=>`${esc(n.comp)} · N≈${n.n} · dist.${n.distance}`).join(' · '):'—'}</div><details><summary>Ver ponderação histórica usada para QUEDA e CONTRARIAN</summary><div class="evgrid">${evidence(d._followEv)}</div></details>
     </div>
     <div class="box ${d._bestStrategy==='QUEDA'?'best':''}">
       <div class="meta">Queda · score ${fmt(d._fq,0)}</div>
       <div class="roi ${d._roiFollow>=0?'good':'bad'}">${pct(d._roiFollow)}</div>
       <div class="meta">EV atual coerente</div>
       <div class="meta">p ${d._pDrop==null?'—':pct(d._pDrop*100)} · odd ${fmt(d.Odd_Entrada,2)} · break-even ${d.Odd_Entrada?pct(100/d.Odd_Entrada):'—'}</div>
       ${d._pDrop!=null&&d.Odd_Entrada?`<div class="meta">${pct(d._pDrop*100)} × ${fmt(d.Odd_Entrada,2)} − 1 = <b>${pct(d._roiFollow)}</b></div>`:''}
       <div class="meta">ROI histórico ajustado usado na calibração: ${pct(d._roiFollowHistorical)}</div>
     </div>
     <div class="box ${d._bestStrategy==='CONTRARIAN'?'best':''}">
       <div class="meta">${d._isDraw?'Contrarian não aplicável':'Contrarian · score '+fmt(d._cq,0)}</div>
       <div class="roi ${d._roiContr==null?'':(d._roiContr>=0?'good':'bad')}">${d._roiContr==null?'—':pct(d._roiContr)}</div>
       <div class="meta">${d._isDraw?'queda no Empate':`execução do feed: ${esc(d._bestContr?.label||'—')}`}</div>
       ${!d._isDraw?`<div class="meta">${esc(d._contrSelectionSource||'')}</div>`:''}
       ${!d._isDraw&&d._bestModelContr&&d._bestContr&&d._bestModelContr.mode!==d._bestContr.mode
         ?`<div class="meta amber">Maior EV entre contrarians: ${esc(d._bestModelContr.label)} · ${pct(d._bestModelContr.potential)}</div>`
         :''}
     </div>
     <div class="box">
       <div class="meta">Execução contrarian</div>
       <div class="meta" style="font-size:11px;color:var(--t)">${contr}</div>
     </div>
     <div class="rec">
       <span class="badge ${d._rec}">${esc(d._rec)}</span>
       <div class="meta">melhor potencial</div>
       <div class="roi ${d._bestPotential>=0?'good':'bad'}">${pct(d._bestPotential)}</div>
       <div class="meta">${esc(d._bestStrategy)}</div>
       ${(()=>{
 const sp=stakeMap.get(d);if(!sp)return'<div class="meta">Stake indisponível</div>';

 if(d._bestStrategy==='CONTRARIAN'&&!d._isDraw&&d._opts?.length){
   const xs=contrarianExecutionStakes(d,plan.b);
   if(!xs.length)return'<div class="meta">Stake contrarian indisponível</div>';
   return `<div style="margin-top:7px">
     <div class="meta"><b>Stake por execução contrarian</b></div>
     ${xs.map((x,j)=>{
       const selected=x.opt.mode===d._bestContr?.mode&&x.opt.odd===d._bestContr?.odd;
       const main=selected
         ?`<span class="pill">${d._contrSelectionSource?.startsWith('Casa_')?'seleção registada':'selecionada pelo modelo'}</span>`
         :(j===0?'<span class="pill">melhor stake ajustada</span>':'');
       const h=x.house?` · ${esc(x.house)}`:'';
       const det=x.risk?.pLower!=null?`p conserv. ${pct(x.risk.pLower*100)} · qualidade ${fmt((x.risk.quality||0)*100,0)}`:esc(x.risk?.reason||'');
       return `<div style="margin-top:6px;padding-top:5px;border-top:1px solid var(--line)">
         <div class="meta">${main} <b>${esc(x.opt.label)}</b>${h}</div>
         <div class="meta">Odd ${x.opt.odd!=null?fmt(x.opt.odd,2):'—'} · ROI pot. ${x.opt.potential!=null?pct(x.opt.potential):'—'}</div>
         <div class="roi ${x.stake>0?'blue':'bad'}">${eur(x.stake)}</div>
         <div class="meta">${fmt(x.units,2)}u · ${pct(x.pct)} da banca · ${det}</div>
       </div>`
     }).join('')}
   </div>`;
 }

 const h=sp.house?` · ${esc(sp.house)}`:'';
 const detail=sp.risk?.pLower!=null?`p conserv. ${pct(sp.risk.pLower*100)} · edge ${pct((sp.risk.edge||0)*100)} · qualidade ${fmt((sp.risk.quality||0)*100,0)} · curva odd ${fmt((sp.risk.oddFactor||1)*100,0)}%${sp.risk.strongMatureFloor?` · piso maduro ${fmt(sp.risk.strongMatureFloor,2)}u`:''}`:esc(sp.risk?.reason||'');
 return`<div style="margin-top:7px"><div class="meta">Stake sugerida${h}</div><div class="roi ${sp.stake>0?'blue':'bad'}">${eur(sp.stake)}</div><div class="meta">${fmt(sp.units,2)}u · ${pct(sp.pct)} do saldo total</div><div class="meta">${detail}</div>${sp.units>0&&sp.units<1?'<div class="meta">stake reduzida / experimental</div>':''}</div>`
})()}
     </div>
   </div>`;
 }).join('')||'<div class="mini">Sem entradas para este filtro.</div>';
}

document.title='Dashboard Apostas v9.3 — EV Coerente Calibrado pela Queda';
const h1=document.querySelector('header h1');if(h1)h1.textContent='Dashboard de Apostas v9.3 — EV Coerente, Decisão & Stake';
const dn=document.getElementById('decisionNotice');if(dn)dn.insertAdjacentHTML('beforebegin',`<div class="note"><b>EV coerente v9.3:</b> QUEDA e CONTRARIAN usam a mesma distribuição de probabilidades, calibrada pelo ROI histórico ajustado da queda e pela odd atual. O histórico contrarian real é apenas validação.</div>`);
load();
