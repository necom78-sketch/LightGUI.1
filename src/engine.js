"use strict";
/* ================= CHESS ENGINE (self-contained; also compiled into an AI Web Worker) ================
   Fixed & upgraded: stronger search (PVS + null-move + LMR + killers/history + TT), better evaluation,
   repetition-safe position keys, mate-score handling, per-search context (no shared globals). */
const FILES='abcdefgh';
const VAL={p:100,n:320,b:330,r:500,q:900,k:0};
const PST={p:[0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0],n:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],b:[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],r:[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],k:[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20],ke:[-50,-40,-30,-20,-20,-30,-40,-50,-30,-20,-10,0,0,-10,-20,-30,-30,-10,20,30,30,20,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,20,30,30,20,-10,-30,-30,-30,0,0,0,0,-30,-30,-50,-30,-30,-30,-30,-30,-30,-50]};
const KNIGHT_D=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_D=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const BISHOP_D=[[-1,-1],[-1,1],[1,-1],[1,1]];
const ROOK_D=[[-1,0],[1,0],[0,-1],[0,1]];

function initialBoard(){const b=new Array(64).fill(null),back=['R','N','B','Q','K','B','N','R'];for(let i=0;i<8;i++){b[i]=back[i].toLowerCase();b[8+i]='p';b[48+i]='P';b[56+i]=back[i]}return b}
function initialState(){return{board:initialBoard(),turn:'w',castle:{K:true,Q:true,k:true,q:true},ep:-1,half:0,full:1}}
function cloneState(st){return{board:st.board.slice(),turn:st.turn,castle:{...st.castle},ep:st.ep,half:st.half,full:st.full}}
function kingSq(b,c){const k=c==='w'?'K':'k';for(let i=0;i<64;i++)if(b[i]===k)return i;return-1}

function isAttacked(b,sq,by){const r=sq>>3,c=sq&7;const pawn=by==='w'?'P':'p',pr=by==='w'?r+1:r-1;if(pr>=0&&pr<8){if(c>0&&b[pr*8+c-1]===pawn)return true;if(c<7&&b[pr*8+c+1]===pawn)return true}const kn=by==='w'?'N':'n';for(const[dr,dc]of KNIGHT_D){const rr=r+dr,cc=c+dc;if(rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr*8+cc]===kn)return true}const kg=by==='w'?'K':'k';for(const[dr,dc]of KING_D){const rr=r+dr,cc=c+dc;if(rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr*8+cc]===kg)return true}const rq=by==='w'?['R','Q']:['r','q'];for(const[dr,dc]of ROOK_D){let rr=r+dr,cc=c+dc;while(rr>=0&&rr<8&&cc>=0&&cc<8){const p=b[rr*8+cc];if(p){if(rq.includes(p))return true;break}rr+=dr;cc+=dc}}const bq=by==='w'?['B','Q']:['b','q'];for(const[dr,dc]of BISHOP_D){let rr=r+dr,cc=c+dc;while(rr>=0&&rr<8&&cc>=0&&cc<8){const p=b[rr*8+cc];if(p){if(bq.includes(p))return true;break}rr+=dr;cc+=dc}}return false}
function inCheck(st,c){const k=kingSq(st.board,c);return k>=0&&isAttacked(st.board,k,c==='w'?'b':'w')}

function genMoves(st){const b=st.board,moves=[],turn=st.turn,w=turn==='w';for(let s=0;s<64;s++){const p=b[s];if(!p||(p<'a')!==w)continue;const t=w?p:p.toUpperCase(),r=s>>3,c=s&7;if(t==='P'){const dir=w?-1:1,startRow=w?6:1,promoRow=w?0:7;const f1=s+dir*8;if(f1>=0&&f1<64&&!b[f1]){if((f1>>3)===promoRow){for(const q of['Q','R','B','N'])moves.push({from:s,to:f1,piece:p,promo:q})}else{moves.push({from:s,to:f1,piece:p});if(r===startRow&&!b[s+dir*16])moves.push({from:s,to:s+dir*16,piece:p,dbl:true})}}for(const dc of[-1,1]){const cc=c+dc;if(cc<0||cc>7)continue;const to=(r+dir)*8+cc;if(to<0||to>63)continue;const tp=b[to];if(tp&&(tp<'a')!==w){if((to>>3)===promoRow){for(const q of['Q','R','B','N'])moves.push({from:s,to,piece:p,captured:tp,promo:q})}else moves.push({from:s,to,piece:p,captured:tp})}else if(to===st.ep&&!tp){moves.push({from:s,to,piece:p,captured:w?'p':'P',ep:true})}}}else if(t==='N'||t==='K'){const D=t==='N'?KNIGHT_D:KING_D;for(const[dr,dc]of D){const rr=r+dr,cc=c+dc;if(rr<0||rr>7||cc<0||cc>7)continue;
const to=rr*8+cc,tp=b[to];if(!tp)moves.push({from:s,to,piece:p});else if((tp<'a')!==w)moves.push({from:s,to,piece:p,captured:tp})}if(t==='K'){if(w&&s===60){if(st.castle.K&&!b[61]&&!b[62]&&b[63]==='R'&&!isAttacked(b,60,'b')&&!isAttacked(b,61,'b')&&!isAttacked(b,62,'b'))moves.push({from:60,to:62,piece:'K',castle:'K'});if(st.castle.Q&&!b[59]&&!b[58]&&!b[57]&&b[56]==='R'&&!isAttacked(b,60,'b')&&!isAttacked(b,59,'b')&&!isAttacked(b,58,'b'))moves.push({from:60,to:58,piece:'K',castle:'Q'})}if(!w&&s===4){if(st.castle.k&&!b[5]&&!b[6]&&b[7]==='r'&&!isAttacked(b,4,'w')&&!isAttacked(b,5,'w')&&!isAttacked(b,6,'w'))moves.push({from:4,to:6,piece:'k',castle:'k'});if(st.castle.q&&!b[3]&&!b[2]&&!b[1]&&b[0]==='r'&&!isAttacked(b,4,'w')&&!isAttacked(b,3,'w')&&!isAttacked(b,2,'w'))moves.push({from:4,to:2,piece:'k',castle:'q'})}}}else{const dirs=t==='B'?BISHOP_D:t==='R'?ROOK_D:BISHOP_D.concat(ROOK_D);for(const[dr,dc]of dirs){let rr=r+dr,cc=c+dc;while(rr>=0&&rr<8&&cc>=0&&cc<8){const to=rr*8+cc,tp=b[to];
if(!tp)moves.push({from:s,to,piece:p});else{if((tp<'a')!==w)moves.push({from:s,to,piece:p,captured:tp});break}rr+=dr;cc+=dc}}}}return moves}

function doMove(st,m){const b=st.board,w=m.piece<'a';const u={m,captured:m.captured||null,castle:{...st.castle},ep:st.ep,half:st.half};b[m.from]=null;if(m.ep)b[m.to+(w?8:-8)]=null;b[m.to]=m.promo?(w?m.promo:m.promo.toLowerCase()):m.piece;if(m.castle){if(m.castle==='K'){b[61]=b[63];b[63]=null}if(m.castle==='Q'){b[59]=b[56];b[56]=null}if(m.castle==='k'){b[5]=b[7];b[7]=null}if(m.castle==='q'){b[3]=b[0];b[0]=null}}if(m.piece==='K'){st.castle.K=false;st.castle.Q=false}if(m.piece==='k'){st.castle.k=false;st.castle.q=false}if(m.from===63||m.to===63)st.castle.K=false;if(m.from===56||m.to===56)st.castle.Q=false;if(m.from===7||m.to===7)st.castle.k=false;if(m.from===0||m.to===0)st.castle.q=false;st.ep=m.dbl?m.from+(w?-8:8):-1;st.half=(m.piece.toUpperCase()==='P'||u.captured)?0:st.half+1;if(st.turn==='b')st.full++;st.turn=w?'b':'w';return u}
function undoMove(st,u){const m=u.m,b=st.board,w=m.piece<'a';st.turn=w?'w':'b';if(st.turn==='b')st.full--;b[m.to]=null;b[m.from]=m.piece;if(m.ep)b[m.to+(w?8:-8)]=w?'p':'P';else if(u.captured)b[m.to]=u.captured;if(m.castle){if(m.castle==='K'){b[63]=b[61];b[61]=null}if(m.castle==='Q'){b[56]=b[59];b[59]=null}if(m.castle==='k'){b[7]=b[5];b[5]=null}if(m.castle==='q'){b[0]=b[3];b[3]=null}}st.castle=u.castle;st.ep=u.ep;st.half=u.half}
function legalMoves(st){const out=[];for(const m of genMoves(st)){const u=doMove(st,m);if(!inCheck(st,m.piece<'a'?'w':'b'))out.push(m);undoMove(st,u)}return out}

/* Position key: include en-passant square only when an en-passant capture is actually possible,
   so threefold repetition / TT keys follow the FIDE "same position" rule much more closely. */
function epRelevant(st){if(st.ep<0)return false;const b=st.board,to=st.ep,r=to>>3,c=to&7;const pr=st.turn==='w'?r+1:r-1;if(pr<0||pr>7)return false;const p=st.turn==='w'?'P':'p';if(c>0&&b[pr*8+c-1]===p)return true;if(c<7&&b[pr*8+c+1]===p)return true;return false}
function positionKey(st){let k=st.board.map(p=>p||'.').join('')+st.turn;k+=(st.castle.K?'K':'')+(st.castle.Q?'Q':'')+(st.castle.k?'k':'')+(st.castle.q?'q':'');k+=epRelevant(st)?st.ep:-1;return k}
function insufficient(b){const minors=[];for(let s=0;s<64;s++){const p=b[s];if(!p)continue;const t=p.toUpperCase();if(t==='K')continue;if(t==='P'||t==='R'||t==='Q')return false;minors.push({t,sq:s,w:p<'a'})}if(minors.length<=1)return true;if(minors.length===2&&minors[0].t==='B'&&minors[1].t==='B'&&minors[0].w!==minors[1].w){const col=s=>((s>>3)+(s&7))&1;if(col(minors[0].sq)===col(minors[1].sq))return true}return false}

/* ============================ EVALUATION ============================
   Material + piece-square tables (kept from the original) plus cheap extras:
   bishop pair, doubled/isolated pawns, passed pawns, rooks on (semi-)open files. */
function pawnBlockedInfo(b){const wf=[0,0,0,0,0,0,0,0],bf=[0,0,0,0,0,0,0,0];for(let s=0;s<64;s++){const p=b[s];if(p==='P')wf[s&7]++;else if(p==='p')bf[s&7]++}return{wf,bf}}
function passedPawn(b,s,w){const r=s>>3,c=s&7;if(w){for(let rr=r-1;rr>=0;rr--){if(c>0&&b[rr*8+c-1]==='p')return false;if(b[rr*8+c]==='p')return false;if(c<7&&b[rr*8+c+1]==='p')return false}return true}for(let rr=r+1;rr<8;rr++){if(c>0&&b[rr*8+c-1]==='P')return false;if(b[rr*8+c]==='P')return false;if(c<7&&b[rr*8+c+1]==='P')return false}return true}
function evaluate(st){const b=st.board;let phase=0,bw=0,bb=0;for(let s=0;s<64;s++){const p=b[s];if(!p)continue;const t=p.toLowerCase();if(t!=='p'&&t!=='k')phase+=VAL[t];if(t==='b'){if(p<'a')bw++;else bb++}}const{wf,bf}=pawnBlockedInfo(b);let score=0;for(let s=0;s<64;s++){const p=b[s];if(!p)continue;const w=p<'a',t=w?p:p.toLowerCase(),idx=w?s:s^56;let v=0;if(t==='p'){v=100+PST.p[idx];const f=s&7,r=s>>3;if(w){if(wf[f]>1)v-=10;if((f===0||wf[f-1]===0)&&(f===7||wf[f+1]===0))v-=14;if(passedPawn(b,s,true))v+=14+(6-r)*7}else{if(bf[f]>1)v-=10;if((f===0||bf[f-1]===0)&&(f===7||bf[f+1]===0))v-=14;if(passedPawn(b,s,false))v+=14+r*7}}else if(t==='n')v=320+PST.n[idx];else if(t==='b')v=330+PST.b[idx];else if(t==='r'){v=500+PST.r[idx];const f=s&7;const own=w?wf[f]:bf[f],opp=w?bf[f]:wf[f];if(own===0)v+=opp===0?14:7}else if(t==='q')v=900+PST.q[idx];else v=phase<1400?PST.ke[idx]:PST.k[idx];score+=w?v:-v}if(bw>=2)score+=32;if(bb>=2)score-=32;return(st.turn==='w'?score:-score)+8}

/* ============================ SEARCH ============================ */
const MATE=99999,MATE_BOUND=MATE-1000,MAX_PLY=64;
const TT=new Map();
const LEVELS={1:{budget:500,maxD:2,qs:4,noise:90},2:{budget:1500,maxD:4,qs:8,noise:35},3:{budget:3200,maxD:8,qs:12,noise:10},4:{budget:6000,maxD:64,qs:16,noise:0}};
const LEVEL_NAMES=['','Easy','Medium','Hard','Expert'];

function newCtx(budgetMs,qsDepth){return{nodes:0,stopTime:performance.now()+budgetMs,aborted:false,qd:qsDepth||16,killers:[],history:new Int32Array(4096),path:[],depth:0}}

function mvv(m){let s=0;if(m.captured)s+=100000+10*VAL[m.captured.toLowerCase()]-VAL[m.piece.toLowerCase()];if(m.promo)s+=90000+(VAL[m.promo.toLowerCase()]||900);return s}
function hasNonPawn(st,c){const b=st.board;if(c==='w'){for(let i=0;i<64;i++){const p=b[i];if(p==='N'||p==='B'||p==='R'||p==='Q')return true}}else{for(let i=0;i<64;i++){const p=b[i];if(p==='n'||p==='b'||p==='r'||p==='q')return true}}return false}

function qsearch(st,alpha,beta,ctx,qd,ply){
  if(ctx.aborted)return 0;
  ctx.nodes++;
  if((ctx.nodes&1023)===0&&performance.now()>ctx.stopTime){ctx.aborted=true;return 0}
  const inChk=inCheck(st,st.turn);
  const stand=evaluate(st);
  if(!inChk){
    if(stand>=beta)return beta;
    if(stand>alpha)alpha=stand;
    if(qd<=0)return alpha;
  }
  let moves=genMoves(st);
  if(!inChk)moves=moves.filter(m=>m.captured||m.promo);
  for(const m of moves)m._s=mvv(m);
  moves.sort((a,b)=>b._s-a._s);
  let legalFound=false;
  for(const m of moves){
    const u=doMove(st,m);
    if(inCheck(st,m.piece<'a'?'w':'b')){undoMove(st,u);continue}
    legalFound=true;
    const sc=-qsearch(st,-beta,-alpha,ctx,inChk?qd:qd-1,ply+1);
    undoMove(st,u);
    if(ctx.aborted)return alpha;
    if(sc>alpha){alpha=sc;if(alpha>=beta)return beta}
  }
  if(inChk&&!legalFound)return-(MATE-ply);
  return alpha;
}

function negamax(st,depth,alpha,beta,ctx,ply,noNull){
  if(ctx.aborted)return 0;
  ctx.nodes++;
  if((ctx.nodes&1023)===0&&performance.now()>ctx.stopTime){ctx.aborted=true;return 0}
  if(st.half>=100)return 0;
  const key=positionKey(st);
  if(ctx.path.indexOf(key)!==-1)return 0;
  const inChk0=inCheck(st,st.turn);
  if(inChk0&&ply<MAX_PLY-8)depth++;
  if(depth<=0)return qsearch(st,alpha,beta,ctx,ctx.qd,ply);
  const e=TT.get(key);
  let ttMove=null;
  if(e){
    if(e.depth>=depth){
      let s=e.score;
      if(s>MATE_BOUND)s-=ply;else if(s<-MATE_BOUND)s+=ply;
      if(e.flag===0)return s;
      if(e.flag===1&&s<=alpha)return s;
      if(e.flag===2&&s>=beta)return s;
    }
    ttMove=e.move||null;
  }
  if(!noNull&&!inChk0&&depth>=3&&ply>0&&hasNonPawn(st,st.turn)){
    const savedEp=st.ep,savedHalf=st.half,savedTurn=st.turn;
    st.turn=savedTurn==='w'?'b':'w';st.ep=-1;st.half=0;
    const v=-negamax(st,depth-1-(2+(depth>>2)),-beta,-beta+1,ctx,ply+1,true);
    st.turn=savedTurn;st.ep=savedEp;st.half=savedHalf;
    if(ctx.aborted)return 0;
    if(v>=beta)return beta;
  }
  const moves=legalMoves(st);
  if(!moves.length)return inChk0?-(MATE-ply):0;
  const kk=ctx.killers[ply]||[null,null];
  for(const m of moves){
    let s=mvv(m);
    if(ttMove&&m.from===ttMove.from&&m.to===ttMove.to&&(m.promo||'')===(ttMove.promo||''))s+=1e9;
    else if(kk[0]&&m.from===kk[0].from&&m.to===kk[0].to&&(m.promo||'')===(kk[0].promo||''))s+=80000;
    else if(kk[1]&&m.from===kk[1].from&&m.to===kk[1].to&&(m.promo||'')===(kk[1].promo||''))s+=79000;
    else if(!m.captured&&!m.promo)s+=ctx.history[m.from*64+m.to]||0;
    m._s=s;
  }
  moves.sort((a,b)=>b._s-a._s);
  ctx.path.push(key);
  let best=-Infinity,bestMv=null;
  const a0=alpha;
  let i=0;
  for(const m of moves){
    const u=doMove(st,m);
    let sc;
    if(i===0){sc=-negamax(st,depth-1,-beta,-alpha,ctx,ply+1,false)}
    else{
      const quiet=!m.captured&&!m.promo;
      const red=(depth>=3&&i>=4&&quiet&&!inChk0)?1:0;
      sc=-negamax(st,depth-1-red,-alpha-1,-alpha,ctx,ply+1,false);
      if(!ctx.aborted&&sc>alpha&&red)sc=-negamax(st,depth-1,-alpha-1,-alpha,ctx,ply+1,false);
      if(!ctx.aborted&&sc>alpha&&sc<beta)sc=-negamax(st,depth-1,-beta,-alpha,ctx,ply+1,false);
    }
    undoMove(st,u);
    if(ctx.aborted){ctx.path.pop();return best===-Infinity?0:best}
    i++;
    if(sc>best){best=sc;bestMv=m}
    if(sc>alpha)alpha=sc;
    if(alpha>=beta){
      if(!m.captured&&!m.promo){
        ctx.history[m.from*64+m.to]=(ctx.history[m.from*64+m.to]||0)+depth*depth;
        const kl=ctx.killers[ply]||(ctx.killers[ply]=[null,null]);
        if(!kl[0]||kl[0].from!==m.from||kl[0].to!==m.to){kl[1]=kl[0];kl[0]={from:m.from,to:m.to,promo:m.promo||''}}
      }
      break;
    }
  }
  ctx.path.pop();
  let flag=0;
  if(best<=a0)flag=1;else if(best>=beta)flag=2;
  let ss=best;
  if(ss>MATE_BOUND)ss+=ply;else if(ss<-MATE_BOUND)ss-=ply;
  if(TT.size>150000)TT.clear();
  if(isFinite(ss)&&isFinite(best))TT.set(key,{depth,score:ss,flag,move:bestMv?{from:bestMv.from,to:bestMv.to,promo:bestMv.promo||''}:null});
  return best;
}

/* Root search: iterative deepening; exact full-window scores at shallow depths & for "human" levels,
   PVS at full strength. Small selection jitter gives opening variety without weakening tactics. */
function thinkMoveSync(st,level,ctx,rootPly){
  const cfg=LEVELS[level]||LEVELS[2];
  const legal=legalMoves(st);
  if(!legal.length)return null;
  if(legal.length===1)return legal[0];
  const c=ctx||newCtx(cfg.budget,cfg.qs);
  c.nodes=0;c.aborted=false;c.stopTime=performance.now()+cfg.budget;c.qd=cfg.qs;
  c.killers=[];c.history=new Int32Array(4096);c.path=[positionKey(st)];c.depth=0;
  let ordered=legal.slice();
  for(const m of ordered)m._s=mvv(m);
  ordered.sort((a,b)=>b._s-a._s);
  let best=ordered[0];
  const jitter=cfg.noise>0?cfg.noise:((rootPly||0)<10?8:0);
  for(let d=1;d<=cfg.maxD;d++){
    let alpha=-Infinity;
    const exactWindow=cfg.noise>0||d<=2;
    const scored=[];
    for(let i=0;i<ordered.length;i++){
      const m=ordered[i];
      const u=doMove(st,m);
      let sc;
      /* first root move always gets a full window (PVS); with alpha=-Infinity a
         null-window would degenerate to (Inf,Inf) and poison the TT with Inf scores */
      if(exactWindow||i===0)sc=-negamax(st,d-1,-Infinity,Infinity,c,1,false);
      else{
        sc=-negamax(st,d-1,-alpha-1,-alpha,c,1,false);
        if(!c.aborted&&sc>alpha)sc=-negamax(st,d-1,-Infinity,-alpha,c,1,false);
      }
      undoMove(st,u);
      if(c.aborted)break;
      scored.push({m,sc,exact:exactWindow||sc>alpha});
      if(sc>alpha)alpha=sc;
    }
    if(c.aborted)break;
    c.depth=d;
    let bm=null;
    if(jitter>0){
      let top=-Infinity;
      for(const e of scored)if(e.sc>top)top=e.sc;
      const cand=scored.filter(e=>e.exact&&e.sc>=top-jitter);
      if(cand.length)bm=cand[(Math.random()*cand.length)|0].m;
    }
    if(!bm){let top=-Infinity;for(const e of scored)if(e.sc>top){top=e.sc;bm=e.m}}
    if(bm)best=bm;
    scored.sort((a,b)=>b.sc-a.sc);
    ordered=scored.map(e=>e.m);
    if(topMate(scored))break;
    if(performance.now()>=c.stopTime)break;
  }
  return best;
}
function topMate(scored){let top=-Infinity;for(const e of scored)if(e.sc>top)top=e.sc;return top>MATE_BOUND}
