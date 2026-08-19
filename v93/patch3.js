/* Dashboard v9.3 patch — parte 3 */
function decisionScore(d){
 const blended=d._bestStrategy==='CONTRARIAN'?(d._cq??0):(d._fq??0);

 // Só há reforço histórico quando a direção histórica e o EV atual concordam.
 if(d._historyStrong&&d._historicalAgreement){
   const ownScore=45+.35*(d._priorityConviction||0);
   return Math.max(blended,ownScore)
 }

 return blended
}

function decisionConfidence(d){
 const blended=d._bestStrategy==='CONTRARIAN'
   ?(d._cconf??d._fconf??.20)
   :(d._fconf??.20);

 return (d._historyStrong&&d._historicalAgreement)
   ?Math.max(blended,d._autonomy||0)
   :blended
}

function riskSizing(d,b,opt=null){
 const odd=decisionOdd(d,opt);
 if(!odd||odd<=1||b.total<=0)return{pct:0,units:0,stake:0,reason:'sem odd/saldo'};

 const score=decisionScore(d),conf=clamp(decisionConfidence(d),0,1);
 if(score<45)return{pct:0,units:0,stake:0,odd,score,reason:'score < 45'};

 const pMarket=1/odd;
 let pModel=null,nEff=0;

 if(d._bestStrategy==='CONTRARIAN' || opt){
   const co=opt||d._bestContr;
   pModel=co?.probability??null;
   nEff=clamp(d._ownN||co?.sample||0,4,80);
 }else{
   // Exatamente a mesma probabilidade usada para mostrar o ROI da queda.
   pModel=d._pDrop??null;
   nEff=clamp(d._ownN||0,4,80);
 }

 if(pModel==null||!Number.isFinite(pModel))return{pct:0,units:0,stake:0,odd,score,reason:'sem probabilidade'};

 const scoreTrust=clamp((score-45)/35,0,1);
 const trust=Math.sqrt(clamp(conf,0,1)*scoreTrust);
 const modelWeight=clamp(.10+.55*trust,.10,.65);
 const pBlend=pMarket+modelWeight*(pModel-pMarket);

 const se=Math.sqrt(Math.max(.000001,pBlend*(1-pBlend)/(nEff+20)));
 const pLower=Math.max(0,pBlend-.84*se);
 const edgeConservative=odd*pLower-1;

 const visibleROI=(d._bestStrategy==='CONTRARIAN' || opt)
   ?((opt||d._bestContr)?.potential??d._roiContr??0)
   :(d._roiFollow??0);

 // Pontuação contínua de qualidade: valor + confiança + robustez.
 const roiScore=clamp(visibleROI/25,0,1.6);       // 25% ≈ referência forte
 const scoreScore=clamp((score-45)/30,0,1.25);
 const confScore=clamp(conf/.65,0,1.2);
 const edgeScore=clamp((edgeConservative+0.02)/.12,0,1.4);

 let quality=.38*roiScore+.27*scoreScore+.20*confScore+.15*edgeScore;

 // Curva de risco da odd: deliberadamente assimétrica.
 // Odds baixas/moderadas recebem um pequeno bónus de confiança quando o sinal é robusto;
 // odds altas são penalizadas agressivamente para proteger a banca.
 let oddFactor=1;
 if(odd<1.60)oddFactor=1.12;
 else if(odd<1.90)oddFactor=1.08;
 else if(odd<2.20)oddFactor=1.02;
 else if(odd<2.75)oddFactor=.92;
 else if(odd<3.50)oddFactor=.76;
 else if(odd<4.50)oddFactor=.58;
 else if(odd<5.50)oddFactor=.42;
 else if(odd<7.00)oddFactor=.28;
 else oddFactor=.18;

 quality*=oddFactor;

 // Bónus adicional quando a célula própria está madura e a odd é relativamente baixa.
 // Este é o mecanismo que permite aumentar confiança em casos tipo ATP+CCC com N forte.
 const ownMaturity=d._maturity??0;
 if(odd<=2.0 && ownMaturity>=.70 && score>=60 && visibleROI>=8){
   quality*=1.18;
 }
 if(odd<=1.85 && ownMaturity>=.85 && score>=65 && visibleROI>=10){
   quality*=1.12;
 }

 // Tradução para unidades discretas.
 let units=0;
 if(score>=50 && visibleROI>=4){
   if(quality>=1.18)units=2.0;
   else if(quality>=1.02)units=1.5;
   else if(quality>=.86)units=1.25;
   else if(quality>=.68)units=1.0;
   else if(quality>=.50)units=.75;
   else units=.5;
 }

 // Floors experimentais.
 if(score>=50 && visibleROI>=10 && units<.5)units=.5;
 if(score>=55 && visibleROI>=12 && odd<=2.2 && units<.75)units=.75;
 if(score>=60 && visibleROI>=10 && odd<=1.90 && ownMaturity>=.70 && units<1.0)units=1.0;
 if(score>=65 && visibleROI>=12 && odd<=1.85 && ownMaturity>=.85 && units<1.25)units=1.25;

 // Caps específicos por odd — bem mais agressivos nas odds altas.
 if(odd>=7.0)units=Math.min(units,.25);
 else if(odd>=5.5)units=Math.min(units,.25);
 else if(odd>=4.5)units=Math.min(units,.50);
 else if(odd>=3.5)units=Math.min(units,.75);
 else if(odd>=2.75)units=Math.min(units,1.0);
 else if(odd>=2.20)units=Math.min(units,1.25);
 else if(odd>=1.90)units=Math.min(units,1.50);
 // abaixo de 1.90 pode chegar a 2u se qualidade e banca permitirem

 // Piso explícito para células maduras + odd baixa/moderada.
 // Ex.: ATP + CCC com N forte e odd ~1.75 deve, no mínimo, chegar a 1u.
 let strongMatureFloor=0;
 if(ownMaturity>=.70 && score>=60 && visibleROI>=8 && odd<=2.0) strongMatureFloor=1.0;
 if(ownMaturity>=.85 && score>=65 && visibleROI>=12 && odd<=1.85) strongMatureFloor=1.25;
 if(ownMaturity>=.90 && score>=70 && visibleROI>=18 && odd<=1.80) strongMatureFloor=1.50;
 units=Math.max(units,strongMatureFloor);

 let stake=units*b.baseUnit;

 // Travão de banca por entrada:
 // para entradas maduras/fortes, nunca corta abaixo de 1u salvo se isso
 // representar mais de 3% da banca total.
 const pctCap=b.total*b.maxStakePct/100;
 const matureProtectedCap=(strongMatureFloor>0 && b.baseUnit/b.total<=.03)
   ?Math.max(pctCap,strongMatureFloor*b.baseUnit)
   :pctCap;
 stake=Math.min(stake,matureProtectedCap);
 units=b.baseUnit>0?stake/b.baseUnit:0;

 return{
   pct:b.total?100*stake/b.total:0,
   units,stake,odd,score,conf,pMarket,pModel,pBlend,pLower,nEff,
   edge:edgeConservative,visibleROI,quality,oddFactor,strongMatureFloor,
   reason:units>0?(strongMatureFloor>0?'amostra madura + odd favorável':'stake por unidades'):'sem valor suficiente'
 }
}

function contrarianExecutionStakes(d,b){
 if(d._isDraw||!d._opts?.length)return[];
 return d._opts.map(opt=>{
   const risk=riskSizing(d,b,opt);
   let stake=risk.stake||0;
   const house=normalizeHouse(d.Casa_Contraria);

   // Limite adicional por saldo da casa.
   if(house&&b[house]>0){
     const normalHouseCap=b[house]*.08;
     const floorStake=(risk.strongMatureFloor||0)*b.baseUnit;
     const protectedHouseCap=(floorStake>0 && floorStake/b[house]<=.10)?Math.max(normalHouseCap,floorStake):normalHouseCap;
     stake=Math.min(stake,protectedHouseCap);
   }

   return{
     opt,risk,stake,
     units:b.baseUnit?stake/b.baseUnit:0,
     pct:b.total?100*stake/b.total:0,
     house
   }
 }).sort((a,b)=>{
   // Casa_Contraria/Odd_Contraria representa a execução escolhida
   // pelo processo de leitura do mercado; aparece primeiro.
   const ae=a.opt.mode===d._bestContr?.mode&&a.opt.odd===d._bestContr?.odd,
         be=b.opt.mode===d._bestContr?.mode&&b.opt.odd===d._bestContr?.odd;
   if(ae!==be)return be-ae;

   return b.stake-a.stake ||
          (b.risk?.quality||0)-(a.risk?.quality||0) ||
          (b.opt?.potential??-999)-(a.opt?.potential??-999)
 })
}
