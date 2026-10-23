const $=id=>document.getElementById(id), svg=$('canvas'), wallLayer=$('walls'), objLayer=$('objects'), draftLayer=$('draft');
const NS='http://www.w3.org/2000/svg';
let state={room:[],columns:[],items:[],wallColors:[],wallHeight:250};
let selected=null,selectedVertex=null,selectedWallIndex=0,tool='select',drawing=[],history=[],future=[],drag=null,nextId=1,lastWallClick=null,pendingWallEdit=null;
const SNAP=12; let threeScene=null,threeCamera=null,threeRenderer=null,threeFrame=null,threeYaw=.75,threePitch=.65,threeZoom=1,threeDrag=null;
const WALL_DEFAULT_COLOR='#d5ddd5';
const PALETTE=[
 {name:'Mur clair',value:'#d5ddd5'}, {name:'Vert sauge',value:'#d7e1d8'},
 {name:'Bois miel',value:'#c9a77b'}, {name:'Bois naturel',value:'#bda78d'},
 {name:'Bleu pâle',value:'#dce8f5'}, {name:'Bleu vitre',value:'#b7d8e9'},
 {name:'Gris clair',value:'#d9d9d9'}, {name:'Jaune sable',value:'#f4d9a5'},
 {name:'Graphite',value:'#59645b'}, {name:'Terre cuite',value:'#c98067'}
];
const colors={furniture:'#d7e1d8',table:'#c9a77b',chair:'#bda78d',shelf:'#bda78d',door:'#dce8f5',window:'#b7d8e9',appliance:'#d9d9d9',column:WALL_DEFAULT_COLOR,note:'#f4d9a5'};
const paletteHas=value=>PALETTE.some(c=>c.value.toLowerCase()===String(value||'').toLowerCase());
function paletteColor(value,fallback=WALL_DEFAULT_COLOR){return paletteHas(value)?String(value).toLowerCase():fallback}
function fillColorSelect(select){select.innerHTML='';PALETTE.forEach(c=>{const option=document.createElement('option');option.value=c.value;option.textContent=c.name+' · '+c.value.toUpperCase();select.appendChild(option)})}
fillColorSelect($('pColor'));fillColorSelect($('pWallColor'));
function ensureState(){if(!Array.isArray(state.columns))state.columns=[];if(!Array.isArray(state.items))state.items=[];if(!Array.isArray(state.room))state.room=[];if(!Array.isArray(state.wallColors))state.wallColors=[];state.wallColors=state.room.map((_,i)=>paletteColor(state.wallColors[i],WALL_DEFAULT_COLOR));if(!Number.isFinite(Number(state.wallHeight))||Number(state.wallHeight)<=0)state.wallHeight=250} function snapshot(){ensureState();return JSON.stringify(state)} function checkpoint(){history.push(snapshot());if(history.length>80)history.shift();future=[]}
function el(tag,attrs={},parent){const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));if(parent)parent.appendChild(n);return n}
function setTool(t){tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));$('status').textContent=t==='wall'?'Clique les angles du contour. Clique près du premier point pour fermer.':t==='object'?'Clique dans le plan pour placer un objet.':'Sélectionne et déplace les objets ou les sommets du contour.';drawing=[];renderDraft()}
function render(){ensureState();wallLayer.innerHTML='';objLayer.innerHTML='';if(state.room.length){const p=el('polygon',{points:state.room.map(p=>`${p.x},${p.y}`).join(' '),class:'wall'+(selected==='room'?' selected':''),'data-room':'1'},wallLayer);p.addEventListener('pointerdown',e=>{
 if(tool!=='select'||e.target!==p)return;
 const q=point(e),now=Date.now();
 if(lastWallClick&&now-lastWallClick.time<500&&Math.hypot(q.x-lastWallClick.point.x,q.y-lastWallClick.point.y)<22){
  lastWallClick=null;e.preventDefault();e.stopPropagation();if(editWallLengthAt(q))return;
 }else lastWallClick={time:now,point:q};
 e.stopPropagation();selected='room';selectedVertex=null;let best=Infinity;
 state.room.forEach((a,i)=>{const b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/l2)):0,d=Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy);if(d<best){best=d;selectedWallIndex=i}});
 showProps();render()
 });state.room.forEach((pt,i)=>{const c=el('circle',{cx:pt.x,cy:pt.y,r:selected==='room'?6:3.5,class:'vertex',opacity:selected==='room'?1:.65},wallLayer);c.addEventListener('pointerdown',e=>{if(tool!=='select')return;e.stopPropagation();selected='room';selectedVertex=i;selectedWallIndex=i;drag={kind:'vertex',index:i};checkpoint();showProps();render()})})}
state.columns.forEach((col,ci)=>{const poly=el('polygon',{points:col.points.map(p=>`${p.x},${p.y}`).join(' '),class:'wall column-contour'+(selected===col.id?' selected':''),fill:paletteColor(col.color,WALL_DEFAULT_COLOR),style:`fill:${paletteColor(col.color,WALL_DEFAULT_COLOR)}`,'fill-opacity':'.55','data-column':col.id},wallLayer);poly.addEventListener('pointerdown',e=>{if(tool==='select'){e.stopPropagation();selected=col.id;selectedVertex=null;showProps();render()}});col.points.forEach((pt,i)=>{const c=el('circle',{cx:pt.x,cy:pt.y,r:selected===col.id?6:3.5,class:'vertex',opacity:selected===col.id?1:.65},wallLayer);c.addEventListener('pointerdown',e=>{if(tool!=='select')return;e.stopPropagation();selected=col.id;selectedVertex=i;drag={kind:'columnVertex',id:col.id,index:i};checkpoint();showProps();render()})})});
state.items.forEach(it=>{
 const g=el('g',{class:'object'+(selected===it.id?' selected':''),transform:`translate(${it.x} ${it.y}) rotate(${it.rot||0} ${it.w/2} ${it.d/2})`,'data-id':it.id},objLayer);
 const stroke=selected===it.id?'#2d7450':'#58655a',sw=selected===it.id?3:1.5;
 const objectColor=paletteColor(it.color,colors[it.type]||colors.furniture);
 const drawRect=(x,y,w,h,fill,cls='detail',rx=0)=>el('rect',{x,y,width:w,height:h,rx,fill,stroke:cls==='shape'?stroke:'#655e52','stroke-width':cls==='shape'?sw:1,class:cls},g);
 if(it.type==='table'){
  const leg=Math.max(4,Math.min(8,Math.min(it.w,it.d)*.09)),ix=Math.max(leg+2,it.w*.10),iy=Math.max(leg+2,it.d*.10),legFill=objectColor;
  [[ix-leg/2,iy-leg/2],[it.w-ix-leg/2,iy-leg/2],[ix-leg/2,it.d-iy-leg/2],[it.w-ix-leg/2,it.d-iy-leg/2]].forEach(([x,y])=>drawRect(x,y,leg,leg,legFill));
  drawRect(3,3,Math.max(1,it.w-6),Math.max(1,it.d-6),objectColor,'shape',2);
 }else if(it.type==='chair'){
  const leg=Math.max(3,Math.min(6,Math.min(it.w,it.d)*.12)),ix=Math.max(leg+2,it.w*.18),iy=Math.max(leg+2,it.d*.18),legFill=objectColor;
  [[ix-leg/2,iy-leg/2],[it.w-ix-leg/2,iy-leg/2],[ix-leg/2,it.d-iy-leg/2],[it.w-ix-leg/2,it.d-iy-leg/2]].forEach(([x,y])=>drawRect(x,y,leg,leg,legFill));
  drawRect(5,5,Math.max(1,it.w-10),Math.max(1,it.d-10),objectColor,'shape',2);
  drawRect(5,2,Math.max(1,it.w-10),Math.max(3,leg), objectColor,'detail',1);
 }else if(it.type==='shelf'){
  drawRect(0,0,it.w,it.d,objectColor,'shape',1);
  const divisions=Math.max(2,Math.min(8,Math.floor((Number(it.height)||180)/35)));
  for(let level=1;level<divisions;level++){const yy=it.d*level/divisions;el('line',{x1:4,y1:yy,x2:Math.max(4,it.w-4),y2:yy,stroke:'#655e52','stroke-width':1,'stroke-opacity':.75},g)}
 }else if(it.type==='column'&&(it.shape||'round')==='round'){
  el('ellipse',{cx:it.w/2,cy:it.d/2,rx:it.w/2,ry:it.d/2,fill:objectColor,stroke, 'stroke-width':sw,class:'shape'},g);
 }else{
  drawRect(0,0,it.w,it.d,objectColor,'shape',it.type==='note'?5:1);
 }
 if(it.type==='door'){
  const pct=Math.max(0,Math.min(100,Number(it.openPercent)||0)),swing=pct/100*Math.PI/2,hingeEnd=it.hingeSide==='end';
  const hx=hingeEnd?it.w:0,dir=hingeEnd?-1:1,ex=hx+dir*it.w*Math.cos(swing),ey=-dir*it.w*Math.sin(swing);
  el('line',{x1:hx,y1:0,x2:ex,y2:ey,stroke:'#657a89','stroke-width':2},g);
  if(pct>0){const sweep=hingeEnd?0:1;el('path',{d:`M ${hx+dir*it.w} 0 A ${it.w} ${it.w} 0 0 ${sweep} ${ex} ${ey}`,fill:'none',stroke:'#657a89','stroke-width':1.2,'stroke-dasharray':'3 3'},g)}
 }
 const tx=el('text',{x:it.w/2,y:it.d/2+4,'text-anchor':'middle','font-size':Math.max(8,Math.min(13,it.d/4)),fill:'#344239','pointer-events':'none'},g);tx.textContent=it.name;
 g.addEventListener('pointerdown',e=>{if(tool==='wall')return;e.stopPropagation();if(tool==='object'){placeObject(e);return}selected=it.id;drag={kind:'item',id:it.id,dx:0,dy:0};checkpoint();showProps();render();const pt=point(e);drag.dx=pt.x-it.x;drag.dy=pt.y-it.y});
 });;renderList();if(selected!=='room'&&!state.items.some(i=>i.id===selected)&&!state.columns.some(c=>c.id===selected))selected=null;}
function renderList(){$('itemList').innerHTML='';$('emptyList').classList.toggle('hidden',state.items.length>0);state.items.forEach(it=>{const li=document.createElement('li');li.className=selected===it.id?'selected':'';li.innerHTML=`<span class="dot" style="background:${paletteColor(it.color,colors[it.type]||colors.furniture)}"></span><span class="name"></span><small>${Math.round(it.w)}×${Math.round(it.d)}</small>`;li.querySelector('.name').textContent=it.name;li.onclick=()=>{selected=it.id;setTool('select');showProps();render()};$('itemList').appendChild(li)})}
function showProps(){
 ensureState();
 const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected),hasProps=!!it||!!col,roomSelected=selected==='room';
 $('props').classList.toggle('hidden',!hasProps);
 $('wallColorField').classList.toggle('hidden',!roomSelected);
 if(roomSelected)$('pWallColor').value=paletteColor(state.wallColors[selectedWallIndex],WALL_DEFAULT_COLOR);
 $('elementColorField').classList.toggle('hidden',!hasProps);
 if(hasProps)$('pColor').value=paletteColor(it?.color||col?.color,it?(colors[it.type]||colors.furniture):WALL_DEFAULT_COLOR);
 $('roomPanel').classList.toggle('hidden',hasProps);
 $('propDimensions').classList.toggle('hidden',!!col&&!it);
 $('propPosition').classList.toggle('hidden',!!col&&!it);
 $('propRotation').classList.toggle('hidden',!!col&&!it);
 $('columnShapeField').classList.toggle('hidden',!it||it.type!=='column');
 $('doorSettingsField').classList.toggle('hidden',!it||it.type!=='door');
 $('propTypeField').classList.toggle('hidden',!it);
 $('duplicateBtn').classList.toggle('hidden',!!col&&!it);
 $('propCommentField')?.classList.toggle('hidden',!!col&&!it);
 if(col&&!it){
  $('status').textContent='Colonne/pilier sélectionné : déplace ses sommets ou modifie sa hauteur et son élévation.';
  $('pName').value=col.name||'Colonne';
  $('pH').value=Math.max(1,Number(col.height)||Number(state.wallHeight)||250);
  $('pElev').value=Math.max(0,Number(col.elevation)||0);
  $('pComment').value=col.comment||'';
  return;
 }
 if(it){
  $('pType').value=it.type;
  $('pName').value=it.name;
  $('pW').value=it.w;$('pD').value=it.d;
  $('pX').value=Math.round(it.x);$('pY').value=Math.round(it.y);
  $('pRot').value=it.rot||0;$('pComment').value=it.comment||'';
  const defaults={furniture:75,table:75,chair:85,shelf:180,door:205,window:100,appliance:85,column:250,note:2};
  const legacyWindowElevation=Number.isFinite(Number(it.sillHeight))?Number(it.sillHeight):90;
  $('pH').value=Math.max(1,Number.isFinite(Number(it.height))?Number(it.height):(it.type==='window'&&Number.isFinite(Number(it.headHeight))?Number(it.headHeight)-legacyWindowElevation:defaults[it.type]||75));
  $('pElev').value=Math.max(0,Number.isFinite(Number(it.elevation))?Number(it.elevation):(it.type==='window'?legacyWindowElevation:0));
  $('pColumnShape').value=it.shape||'round';
  $('pDoorOpen').value=String(Math.max(0,Math.min(100,Number(it.openPercent)||0)));
  $('pDoorOpenValue').textContent=$('pDoorOpen').value+' %';
  $('pHingeSide').value=it.hingeSide==='end'?'end':'start';
 }
}
function point(e){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());return{x:q.x,y:q.y}}
function snapPoint(p,excludeId=null){let q={x:Math.round(p.x/5)*5,y:Math.round(p.y/5)*5};const candidates=[];state.room.forEach(v=>candidates.push(v));state.items.filter(it=>it.id!==excludeId).forEach(it=>{candidates.push({x:it.x,y:it.y},{x:it.x+it.w,y:it.y},{x:it.x,y:it.y+it.d},{x:it.x+it.w,y:it.y+it.d},{x:it.x+it.w/2,y:it.y+it.d/2})});let best=SNAP;for(const c of candidates){const d=Math.hypot(c.x-p.x,c.y-p.y);if(d<best){best=d;q={x:c.x,y:c.y}}}return q}
function snapToWall(it){if(!['door','window'].includes(it.type)||state.room.length<2)return;const cx=it.x+it.w/2,cy=it.y+it.d/2;let best=null;for(let i=0;i<state.room.length;i++){const a=state.room[i],b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;if(!len2)continue;const t=Math.max(0,Math.min(1,((cx-a.x)*dx+(cy-a.y)*dy)/len2));const px=a.x+t*dx,py=a.y+t*dy,dist=Math.hypot(cx-px,cy-py);if(!best||dist<best.dist)best={a,b,t,px,py,dist,angle:Math.atan2(dy,dx)*180/Math.PI,len:Math.sqrt(len2)}}if(best&&best.dist<90){const along=Math.max(it.w,it.d),across=Math.min(it.w,it.d);it.rot=best.angle;it.x=best.px-it.w/2;it.y=best.py-it.d/2;it.wallIndex=state.room.indexOf(best.a)}}
function classifyWallSegment(index){
 const a=state.room[index],b=state.room[(index+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y;
 if(Math.abs(dx)>=Math.abs(dy)*1.3)return {axis:'horizontal',options:[{value:'left',label:'Vers la gauche'},{value:'right',label:'Vers la droite'}],default: b.x>=a.x?'right':'left'};
 if(Math.abs(dy)>=Math.abs(dx)*1.3)return {axis:'vertical',options:[{value:'up',label:'Vers le haut'},{value:'down',label:'Vers le bas'}],default:b.y>=a.y?'down':'up'};
 return {axis:'diagonal',options:[{value:'a',label:'Déplacer le sommet A (garder B fixe)'},{value:'b',label:'Déplacer le sommet B (garder A fixe)'}],default:'b'};
}
function openWallLengthModal(index){
 const a=state.room[index],b=state.room[(index+1)%state.room.length],old=Math.hypot(b.x-a.x,b.y-a.y),classification=classifyWallSegment(index);
 pendingWallEdit={index,old,axis:classification.axis};
 $('wallLengthInput').value=String(Math.round(old));
 $('wallExtendSide').innerHTML='';classification.options.forEach(option=>{const el=document.createElement('option');el.value=option.value;el.textContent=option.label;$('wallExtendSide').appendChild(el)});
 $('wallExtendSide').value=classification.default;$('wallLengthError').textContent='';
 $('wallLengthModal').classList.remove('hidden');requestAnimationFrame(()=>{$('wallLengthInput').focus();$('wallLengthInput').select()});
}
function closeWallLengthModal(){pendingWallEdit=null;$('wallLengthModal').classList.add('hidden');$('wallLengthError').textContent=''}
function applyWallLength(index,desired,side){
 const j=(index+1)%state.room.length,a=state.room[index],b=state.room[j],dx=b.x-a.x,dy=b.y-a.y,old=Math.hypot(dx,dy);
 if(old<1e-6)return false;
 const unit={x:dx/old,y:dy/old};let movedIndex=j,newPoint;
 if(side==='left'||side==='right'){
  const leftIndex=a.x<=b.x?index:j,rightIndex=a.x<=b.x?j:index,left=state.room[leftIndex],right=state.room[rightIndex];
  const vx=(right.x-left.x)/old,vy=(right.y-left.y)/old;
  if(side==='left'){movedIndex=leftIndex;newPoint={x:right.x-vx*desired,y:right.y-vy*desired}}
  else{movedIndex=rightIndex;newPoint={x:left.x+vx*desired,y:left.y+vy*desired}}
 }else if(side==='up'||side==='down'){
  const topIndex=a.y<=b.y?index:j,bottomIndex=a.y<=b.y?j:index,top=state.room[topIndex],bottom=state.room[bottomIndex];
  const vx=(bottom.x-top.x)/old,vy=(bottom.y-top.y)/old;
  if(side==='up'){movedIndex=topIndex;newPoint={x:bottom.x-vx*desired,y:bottom.y-vy*desired}}
  else{movedIndex=bottomIndex;newPoint={x:top.x+vx*desired,y:top.y+vy*desired}}
 }else if(side==='a'){
  movedIndex=index;newPoint={x:b.x-unit.x*desired,y:b.y-unit.y*desired}
 }else{
  movedIndex=j;newPoint={x:a.x+unit.x*desired,y:a.y+unit.y*desired}
 }
 checkpoint();state.room[movedIndex]=newPoint;selected='room';selectedVertex=movedIndex;selectedWallIndex=index;showProps();render();$('status').textContent='Longueur du mur mise à jour : '+Math.round(desired*100)/100+' cm.';return true;
}
function editWallLengthAt(q){
 if(state.room.length<2)return false;
 let best=Infinity,bestIndex=0;
 state.room.forEach((a,i)=>{const b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/l2)):0,d=Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy);if(d<best){best=d;bestIndex=i}});
 if(best>24)return false;
 openWallLengthModal(bestIndex);return true;
}
$('wallLengthForm').addEventListener('submit',e=>{
 e.preventDefault();if(!pendingWallEdit)return;
 const desired=Number($('wallLengthInput').value),side=$('wallExtendSide').value;
 if(!Number.isFinite(desired)||desired<=0){$('wallLengthError').textContent='Saisis une longueur positive en centimètres.';return}
 const {index}=pendingWallEdit;if(applyWallLength(index,desired,side))closeWallLengthModal();
});
$('wallLengthCancel').addEventListener('click',closeWallLengthModal);
$('wallLengthModal').addEventListener('pointerdown',e=>{if(e.target===$('wallLengthModal'))closeWallLengthModal()});
function samePoint(a,b){return Math.hypot(a.x-b.x,a.y-b.y)<1} function pointInPolygon(pt,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a.y>pt.y)!==(b.y>pt.y))&&(pt.x<(b.x-a.x)*(pt.y-a.y)/(b.y-a.y)+a.x))inside=!inside}return inside} function constrainWall(p,base,shift){if(!shift||!base)return p;const dx=p.x-base.x,dy=p.y-base.y;return Math.abs(dx)>=Math.abs(dy)?{x:p.x,y:base.y}:{x:base.x,y:p.y}}
function renderDraft(){draftLayer.innerHTML='';if(drawing.length){el('polyline',{points:drawing.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#2d7450','stroke-width':3,'stroke-dasharray':'7 5'},draftLayer);drawing.forEach(p=>el('circle',{cx:p.x,cy:p.y,r:5,fill:'#fff',stroke:'#2d7450','stroke-width':2},draftLayer))}}
const objectDefaults={furniture:[90,60,'Meuble'],table:[120,80,'Table'],chair:[45,45,'Chaise'],shelf:[80,35,'Étagère'],door:[80,8,'Porte'],window:[100,8,'Fenêtre'],appliance:[60,60,'Électroménager'],column:[35,35,'Colonne'],note:[100,35,'Repère']};
const objectVerticalDefaults={furniture:{height:75,elevation:0},table:{height:75,elevation:0},chair:{height:85,elevation:0},shelf:{height:180,elevation:0},door:{height:205,elevation:0},window:{height:100,elevation:90},appliance:{height:85,elevation:0},column:{height:250,elevation:0},note:{height:2,elevation:0}};
function createObjectAt(center,type=$('objectType').value,{snapOpeningToWall=false}={}){
 const [w,d,name]=objectDefaults[type]||objectDefaults.furniture;
 checkpoint();
 // Place the object's centre at the requested plan coordinate; keep the model on a 5 cm grid.
 const cx=Math.round(center.x/5)*5,cy=Math.round(center.y/5)*5;
 const vertical=objectVerticalDefaults[type]||objectVerticalDefaults.furniture;
 const it={id:'o'+nextId++,type,name,w,d,x:cx-w/2,y:cy-d/2,rot:0,height:vertical.height,elevation:vertical.elevation,color:colors[type]||WALL_DEFAULT_COLOR,comment:'',shape:type==='column'?'rect':undefined,openPercent:type==='door'?0:undefined,hingeSide:type==='door'?'start':undefined};
 if(snapOpeningToWall)snapToWall(it);
 state.items.push(it);selected=it.id;selectedVertex=null;setTool('select');showProps();render();
 $('status').textContent=name+' ajouté au plan.';
 return it;
}
function placeObject(e){createObjectAt(snapPoint(point(e)),$('objectType').value,{snapOpeningToWall:true})}
function roomInteriorCenter(){
 const poly=state.room;
 if(poly.length<3){const vb=svg.viewBox.baseVal;return{x:vb.x+vb.width/2,y:vb.y+vb.height/2}}
 let sumCross=0,cx=0,cy=0;
 for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],cross=a.x*b.y-b.x*a.y;sumCross+=cross;cx+=(a.x+b.x)*cross;cy+=(a.y+b.y)*cross}
 let center=Math.abs(sumCross)>1e-8?{x:cx/(3*sumCross),y:cy/(3*sumCross)}:{x:poly.reduce((s,p)=>s+p.x,0)/poly.length,y:poly.reduce((s,p)=>s+p.y,0)/poly.length};
 if(pointInPolygon(center,poly))return center;
 // For concave rooms the mathematical centroid may fall outside. Find an interior point
 // with the greatest clearance from the walls on a modest grid.
 const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 let best=null;
 for(let iy=1;iy<30;iy++)for(let ix=1;ix<30;ix++){
  const q={x:minX+(maxX-minX)*ix/30,y:minY+(maxY-minY)*iy/30};if(!pointInPolygon(q,poly))continue;
  let clearance=Infinity;
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/l2)):0;clearance=Math.min(clearance,Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy))}
  if(!best||clearance>best.clearance)best={...q,clearance};
 }
 return best||center;
}
svg.addEventListener('pointerdown',e=>{if(e.target.closest('.object')||e.target.classList.contains('vertex'))return;let p=point(e);if(tool==='wall'){p=snapPoint(p);p=constrainWall(p,drawing[drawing.length-1],e.shiftKey);if(drawing.length>2&&Math.hypot(p.x-drawing[0].x,p.y-drawing[0].y)<18){const contour=drawing.slice();checkpoint();if(state.room.length>=3&&contour.every(pt=>pointInPolygon(pt,state.room))&&contour.some(pt=>!samePoint(pt,state.room[0]))){const id='col'+nextId++;state.columns.push({id,name:'Colonne '+nextId,points:contour,height:250,elevation:0,color:WALL_DEFAULT_COLOR});selected=id;$('status').textContent='Contour intérieur reconnu comme colonne/pilier.'}else{state.room=contour;state.wallColors=[];selected='room';$('status').textContent='Contour de la pièce fermé.'}drawing=[];setTool('select');showProps();render();return}drawing.push(p);renderDraft();return}if(tool==='object'){placeObject(e);return}selected=null;showProps();render()});
svg.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);if(drag.kind==='item'){const it=state.items.find(x=>x.id===drag.id);if(it){const q=snapPoint({x:p.x-drag.dx,y:p.y-drag.dy},it.id);it.x=q.x;it.y=q.y;snapToWall(it);render()}}else if(drag.kind==='vertex'){const q=snapPoint(p);state.room[drag.index]=q;selectedVertex=drag.index;render()}else if(drag.kind==='columnVertex'){const q=snapPoint(p);const col=state.columns.find(c=>c.id===drag.id);if(col){col.points[drag.index]=q;selectedVertex=drag.index;render()}}});window.addEventListener('pointerup',()=>{drag=null});
$('addVertexBtn').onclick=()=>{if(state.room.length<3){alert('Crée d’abord le contour de la pièce.');return}checkpoint();const i=selectedWallIndex%state.room.length,a=state.room[i],b=state.room[(i+1)%state.room.length];const pt={x:(a.x+b.x)/2,y:(a.y+b.y)/2};state.room.splice(i+1,0,pt);state.wallColors.splice(i+1,0,state.wallColors[i]||WALL_DEFAULT_COLOR);selected='room';selectedVertex=i+1;selectedWallIndex=i;showProps();render();$('status').textContent='Point ajouté au milieu du mur sélectionné. Glisse-le pour le positionner.'};$('removeVertexBtn').onclick=()=>{if(selected!=='room'||selectedVertex===null||state.room.length<=3){alert('Sélectionne un sommet (et conserve au moins 3 points).');return}checkpoint();state.room.splice(selectedVertex,1);state.wallColors.splice(selectedVertex,1);selectedVertex=null;selectedWallIndex=Math.min(selectedWallIndex,state.room.length-1);showProps();render()};
$('addObject').onclick=()=>{
 const center=roomInteriorCenter();
 // The explicit sidebar action creates the chosen object immediately at the room centre.
 // The separate toolbar tool still permits click-to-place; doors/windows snap when placed that way.
 createObjectAt(center,$('objectType').value,{snapOpeningToWall:false});
};document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$('pType').addEventListener('change',()=>{
 const it=state.items.find(x=>x.id===selected),nextType=$('pType').value;
 if(!it||it.type===nextType)return;
 const previousType=it.type,previousDefault=colors[previousType]||WALL_DEFAULT_COLOR,hadDefaultColor=paletteColor(it.color,previousDefault)===previousDefault;
 const defs=objectDefaults[nextType]||objectDefaults.furniture;
 checkpoint();
 // Type conversion changes the object's representation only. Preserve its centre,
 // footprint, height, elevation, rotation, position and custom properties.
 it.type=nextType;it.name=defs[2];
 if(hadDefaultColor)it.color=colors[nextType]||WALL_DEFAULT_COLOR;
 if(nextType==='column')it.shape=it.shape||'rect';else delete it.shape;
 if(nextType==='door'){
  if(!Number.isFinite(Number(it.openPercent)))it.openPercent=0;
  if(!['start','end'].includes(it.hingeSide))it.hingeSide='start';
 }else{delete it.openPercent;delete it.hingeSide;}
 if(nextType==='door'||nextType==='window')snapToWall(it);else delete it.wallIndex;
 showProps();render();$('status').textContent='Type de l’objet modifié. Dimensions et hauteur conservées.';
});
function bindProp(id,key,cast=v=>v){$(id).addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();if(it)it[key]=cast($(id).value);else if(key==='name'||key==='comment')col[key]=cast($(id).value);render()})}
bindProp('pName','name',v=>v);bindProp('pW','w',v=>Math.max(1,Number(v)||1));bindProp('pD','d',v=>Math.max(1,Number(v)||1));bindProp('pX','x',Number);bindProp('pY','y',Number);bindProp('pRot','rot',Number);bindProp('pComment','comment',v=>v);
$('pColor').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();if(it)it.color=paletteColor($('pColor').value,colors[it.type]||WALL_DEFAULT_COLOR);else col.color=paletteColor($('pColor').value,WALL_DEFAULT_COLOR);render();showProps()});
$('pWallColor').addEventListener('change',()=>{if(selected!=='room'||!state.room.length)return;checkpoint();state.wallColors[selectedWallIndex]=paletteColor($('pWallColor').value,WALL_DEFAULT_COLOR);render();showProps()});
$('pH').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();const h=Math.max(1,Number($('pH').value)||1);if(it)it.height=h;else col.height=h;showProps();render()});
$('pElev').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();const elevation=Math.max(0,Number($('pElev').value)||0);if(it)it.elevation=elevation;else col.elevation=elevation;showProps();render()});
$('pColumnShape').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected);if(!it||it.type!=='column')return;checkpoint();it.shape=$('pColumnShape').value;render()});
$('pDoorOpen').addEventListener('input',()=>{$('pDoorOpenValue').textContent=$('pDoorOpen').value+' %'});
$('pDoorOpen').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected);if(!it||it.type!=='door')return;checkpoint();it.openPercent=Math.max(0,Math.min(100,Number($('pDoorOpen').value)||0));render();showProps();if($('view3d').classList.contains('active'))build3D()});
$('pHingeSide').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected);if(!it||it.type!=='door')return;checkpoint();it.hingeSide=$('pHingeSide').value;render();showProps();if($('view3d').classList.contains('active'))build3D()});
function deleteSelected(){
 if(!selected)return;
 if(selected==='room'){
  if(selectedVertex!==null&&state.room.length>3){checkpoint();state.room.splice(selectedVertex,1);state.wallColors.splice(selectedVertex,1);selectedVertex=null;selectedWallIndex=Math.min(selectedWallIndex,state.room.length-1);showProps();render();$('status').textContent='Sommet du mur supprimé.'}
  return;
 }
 const isItem=state.items.some(i=>i.id===selected),isColumn=state.columns.some(c=>c.id===selected);
 if(!isItem&&!isColumn)return;
 const deletedId=selected;checkpoint();state.items=state.items.filter(i=>i.id!==deletedId);state.columns=state.columns.filter(c=>c.id!==deletedId);selected=null;selectedVertex=null;showProps();render();$('status').textContent='Élément supprimé.';
}
$('deleteBtn').onclick=deleteSelected;
$('duplicateBtn').onclick=()=>{const it=state.items.find(i=>i.id===selected);if(!it)return;checkpoint();const copy={...it,id:'o'+nextId++,name:it.name+' (copie)',x:it.x+20,y:it.y+20};state.items.push(copy);selected=copy.id;showProps();render()};
$('makeRect').onclick=()=>{const w=Math.max(50,Number($('roomWidth').value)||500),h=Math.max(50,Number($('roomLength').value)||400);checkpoint();state.room=[{x:300,y:250},{x:300+w,y:250},{x:300+w,y:250+h},{x:300,y:250+h}];state.wallColors=[];selected='room';setTool('select');showProps();render();fit()};
$('gridToggle').onchange=()=> $('gridBg').setAttribute('opacity',$('gridToggle').checked?'1':'0');
$('undoBtn').onclick=undo;$('redoBtn').onclick=redo;function undo(){if(!history.length)return;future.push(snapshot());state=JSON.parse(history.pop());selected=null;showProps();render()}function redo(){if(!future.length)return;history.push(snapshot());state=JSON.parse(future.pop());selected=null;showProps();render()}
window.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!$('wallLengthModal').classList.contains('hidden')){e.preventDefault();closeWallLengthModal();return}
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
 if(e.key==='Escape'){setTool('select');return}
 if(e.key==='Delete'||e.key==='Backspace'){
  const target=e.target;
  const editing=target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if(editing||!selected)return;
  e.preventDefault();deleteSelected();
 }
});
$('newBtn').onclick=()=>{if(!confirm('Créer un nouveau plan ? Le plan actuel sera remplacé dans cette session.'))return;checkpoint();state={room:[],columns:[],items:[],wallColors:[],wallHeight:250};nextId=1;selected=null;setTool('wall');showProps();render();$('status').textContent='Nouvelle pièce : clique les angles de son contour.'};
function projectForExport(){
 ensureState();
 return {
  format:'planificateur-piece',
  version:5,
  units:'cm',
  exportedAt:new Date().toISOString(),
  wallHeight:Number(state.wallHeight)||250,
  room:state.room.map(p=>({x:Number(p.x),y:Number(p.y)})),
  wallColors:state.room.map((_,i)=>paletteColor(state.wallColors[i],WALL_DEFAULT_COLOR)),
  columns:state.columns.map(c=>({id:String(c.id),name:String(c.name||'Colonne'),points:(c.points||[]).map(p=>({x:Number(p.x),y:Number(p.y)})),height:Math.max(1,Number(c.height)||Number(state.wallHeight)||250),elevation:Math.max(0,Number(c.elevation)||0),color:paletteColor(c.color,WALL_DEFAULT_COLOR)})),
  items:state.items.map(it=>({...it,x:Number(it.x),y:Number(it.y),w:Number(it.w),d:Number(it.d),rot:Number(it.rot)||0,color:paletteColor(it.color,colors[it.type]||WALL_DEFAULT_COLOR),height:Math.max(1,Number(it.height)||({door:205,window:100,furniture:75,table:75,chair:85,appliance:85,column:250,note:2,shelf:180}[it.type]||75)),elevation:Math.max(0,Number.isFinite(Number(it.elevation)) ? Number(it.elevation) : (it.type==='window' && Number.isFinite(Number(it.sillHeight)) ? Number(it.sillHeight) : 0))}))
 };
}
function validateProject(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Le fichier doit contenir un objet JSON.');
 if(!Array.isArray(data.room)||!Array.isArray(data.items))throw new Error('Le JSON doit contenir les tableaux « room » et « items ».');
 const pointList=(arr,label,min=0)=>{
  if(!Array.isArray(arr)||arr.length<min)throw new Error(label+' : nombre de points insuffisant.');
  return arr.map((p,i)=>{if(!p||!Number.isFinite(Number(p.x))||!Number.isFinite(Number(p.y)))throw new Error(label+' : point '+(i+1)+' invalide.');return{x:Number(p.x),y:Number(p.y)}});
 };
 const room=pointList(data.room,'Contour de la pièce',data.room.length?3:0);
 const validTypes=new Set(['furniture','table','chair','shelf','door','window','appliance','column','note']);
 const usedIds=new Set();
 const columns=(Array.isArray(data.columns)?data.columns:[]).map((c,i)=>{
  if(!c||typeof c!=='object')throw new Error('Colonne '+(i+1)+' invalide.');
  const points=pointList(c.points,'Colonne '+(i+1),3);
  let id=String(c.id||'col'+(i+1));while(usedIds.has(id))id+='-';usedIds.add(id);
  return {...c,id,name:String(c.name||('Colonne '+(i+1))),points,height:Math.max(1,Number(c.height)||Number(data.wallHeight)||250),elevation:Math.max(0,Number.isFinite(Number(c.elevation))?Number(c.elevation):0),color:paletteColor(c.color,WALL_DEFAULT_COLOR)};
 });
 const items=data.items.map((raw,i)=>{
  if(!raw||typeof raw!=='object')throw new Error('Objet '+(i+1)+' invalide.');
  const type=String(raw.type||'furniture');if(!validTypes.has(type))throw new Error('Type d’objet inconnu : '+type);
  const number=(key,fallback)=>{const n=Number(raw[key]);return Number.isFinite(n)?n:fallback};
  let id=String(raw.id||'o'+(i+1));while(usedIds.has(id))id+='-';usedIds.add(id);
  const oldWindowElevation=number('sillHeight',90);
  const defaultHeight={door:205,window:100,furniture:75,table:75,chair:85,shelf:180,appliance:85,column:250,note:2}[type]||75;
  const legacyWindowHeight=Number.isFinite(Number(raw.headHeight))?Math.max(1,Number(raw.headHeight)-oldWindowElevation):defaultHeight;
  const height=Number.isFinite(Number(raw.height))?Math.max(1,number('height',defaultHeight)):(type==='window'?legacyWindowHeight:defaultHeight);
  const elevation=Number.isFinite(Number(raw.elevation))?Math.max(0,number('elevation',0)):(type==='window'?Math.max(0,oldWindowElevation):0);
  return {...raw,id,type,name:String(raw.name||({door:'Porte',window:'Fenêtre',column:'Colonne',note:'Repère',appliance:'Électroménager',furniture:'Meuble',table:'Table',chair:'Chaise',shelf:'Étagère'}[type])),x:number('x',0),y:number('y',0),w:Math.max(1,number('w',80)),d:Math.max(1,number('d',8)),rot:number('rot',0),height,elevation,color:paletteColor(raw.color,colors[type]||WALL_DEFAULT_COLOR),comment:String(raw.comment||''),...(type==='door'?{openPercent:Math.max(0,Math.min(100,number('openPercent',0))),hingeSide:raw.hingeSide==='end'?'end':'start'}:{})};
 });
 const wallColors=room.map((_,i)=>paletteColor(Array.isArray(data.wallColors)?data.wallColors[i]:null,WALL_DEFAULT_COLOR));
 return {room,columns,items,wallColors,wallHeight:Math.max(1,Number(data.wallHeight)||Number(data.settings?.wallHeight)||250)};
}
$('exportJsonBtn').onclick=()=>{
 const blob=new Blob([JSON.stringify(projectForExport(),null,2)+'\n'],{type:'application/json;charset=utf-8'});
 download(blob,'planificateur-plan.json');
 $('status').textContent='Plan exporté en JSON (géométrie, couleurs, colonnes, objets et hauteurs).';
};
$('importJsonBtn').onclick=()=>{$('fileInput').click()};
$('fileInput').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;
 try{
  const data=JSON.parse(await f.text());
  const imported=validateProject(data);
  checkpoint();state=imported;
  const allIds=[...state.items,...state.columns].map(x=>Number((String(x.id||'').match(/\d+/g)||[]).join('')||0));
  nextId=Math.max(1,...allIds)+1;
  selected=null;selectedVertex=null;drawing=[];setTool('select');showProps();render();fit();
  $('status').textContent='JSON importé : '+state.room.length+' sommets de pièce, '+state.columns.length+' colonne(s), '+state.items.length+' objet(s).';
 }catch(err){alert('Import JSON impossible : '+(err?.message||'fichier invalide'));}
 finally{e.target.value='';}
};
$('exportBtn').onclick=()=>{const clone=svg.cloneNode(true);clone.setAttribute('xmlns',NS);clone.querySelector('#gridBg')?.remove();clone.querySelector('#draft')?.remove();clone.querySelectorAll('.vertex').forEach(n=>n.remove());const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'});download(blob,'plan.svg')};function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function fit(){
 if(!state.room.length)return;
 const xs=state.room.map(p=>p.x),ys=state.room.map(p=>p.y),pad=100;
 const x=Math.min(...xs)-pad,y=Math.min(...ys)-pad;
 const w=Math.max(...xs)-Math.min(...xs)+2*pad,h=Math.max(...ys)-Math.min(...ys)+2*pad;
 svg.setAttribute('viewBox',`${x} ${y} ${Math.max(w,200)} ${Math.max(h,200)}`);
}
$('fitBtn').onclick=fit;
// Wheel zoom in the 2D editor, centred on the cursor position.
svg.addEventListener('wheel',e=>{
 if($('view3d').classList.contains('active'))return;
 e.preventDefault();
 const vb=svg.viewBox.baseVal,q=point(e),factor=e.deltaY<0?.88:1/.88;
 const minW=160,maxW=10000,newW=Math.max(minW,Math.min(maxW,vb.width*factor)),scale=newW/vb.width,newH=vb.height*scale;
 const nx=q.x-(q.x-vb.x)*scale,ny=q.y-(q.y-vb.y)*scale;
 svg.setAttribute('viewBox',`${nx} ${ny} ${newW} ${newH}`);
},{passive:false});

function build3D(){
 if(!window.THREE){$('status').textContent='Three.js n’a pas pu être chargé. Vérifie la connexion internet.';return}
 if(!Array.isArray(state.room)||state.room.length<3){$('status').textContent='Dessine une pièce fermée en 2D avant d’ouvrir la vue 3D.';return}
 const host=$('view3d');
 const preserveCamera=host.classList.contains('active'),savedYaw=threeYaw,savedPitch=threePitch,savedZoom=threeZoom;
 host.classList.add('active');
 svg.style.visibility='hidden';
 if(threeFrame)cancelAnimationFrame(threeFrame);
 if(threeRenderer){
  threeRenderer.dispose();
  threeRenderer.forceContextLoss?.();
  host.querySelector('canvas')?.remove();
 }
 threeScene=new THREE.Scene();
 threeScene.background=new THREE.Color(0xeef1ee);
 const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
 threeCamera=new THREE.PerspectiveCamera(42,width/height,0.1,100000);
 threeRenderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
 threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
 threeRenderer.setSize(width,height);
 threeRenderer.outputColorSpace=THREE.SRGBColorSpace;
 threeRenderer.shadowMap.enabled=true;
 host.appendChild(threeRenderer.domElement);
 threeScene.add(new THREE.HemisphereLight(0xffffff,0x8b968b,2));
 const light=new THREE.DirectionalLight(0xffffff,2.2);
 light.position.set(700,1100,500);light.castShadow=true;threeScene.add(light);

 // Coordinate convention: plan (x,y) -> world (x, elevation, +y).
 // The plan's lower edge (+Y in SVG coordinates) is kept on the camera-facing side (+Z),
 // so the 3D view does not appear mirrored. Every architectural element uses this mapping.
 const wallHeight=Number(state.wallHeight)||250;
 const wallThickness=12;
 const room=state.room;
 const makeShape=points=>{
  const sh=new THREE.Shape();
  sh.moveTo(points[0].x,points[0].y);
  for(let i=1;i<points.length;i++)sh.lineTo(points[i].x,points[i].y);
  sh.closePath();
  return sh;
 };
 const floorMat=new THREE.MeshStandardMaterial({color:0xfafbf9,roughness:.95,side:THREE.DoubleSide});
 const floor=new THREE.Mesh(new THREE.ShapeGeometry(makeShape(room)),floorMat);
 floor.rotation.x=Math.PI/2;
 floor.position.y=0.01;
 floor.receiveShadow=true;
 floor.userData.isFloor=true;
 threeScene.add(floor);

 // ExtrudeGeometry grows along local +Z. Invert the shape's Y coordinates and rotate -90°
 // so plan (x,y) becomes world (x,+height,+y) and the extrusion rises from the floor.
 for(const col of (state.columns||[])){
  if(!Array.isArray(col.points)||col.points.length<3)continue;
  const h=Math.max(1,Number(col.height)||wallHeight);
  const geom=new THREE.ExtrudeGeometry(makeShape(col.points.map(p=>({x:p.x,y:-p.y}))),{depth:h,bevelEnabled:false,curveSegments:16});
  const mat=new THREE.MeshStandardMaterial({color:paletteColor(col.color,WALL_DEFAULT_COLOR),roughness:.85,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geom,mat);
  mesh.rotation.x=-Math.PI/2;mesh.position.y=Math.max(0,Number(col.elevation)||0);mesh.castShadow=true;mesh.receiveShadow=true;
  threeScene.add(mesh);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geom),new THREE.LineBasicMaterial({color:0x46534a}));
  edges.rotation.x=-Math.PI/2;edges.position.y=Math.max(0,Number(col.elevation)||0)+0.01;threeScene.add(edges);
 }

 const solidWallMat=new THREE.MeshStandardMaterial({color:0xd5ddd5,roughness:.85,side:THREE.DoubleSide});
 const windowMat=new THREE.MeshStandardMaterial({color:0x75b8d2,roughness:.25,metalness:.05,transparent:true,opacity:.38,side:THREE.DoubleSide,depthWrite:false});
 const wallMeshes=[];
 // Polygon winding is evaluated in world X/Z space using the shared mapping z = plan y.
 const worldPoints=room.map(p=>({x:p.x,z:p.y}));
 let signedArea=0;
 for(let i=0;i<worldPoints.length;i++){
  const a=worldPoints[i],b=worldPoints[(i+1)%worldPoints.length];
  signedArea+=a.x*b.z-b.x*a.z;
 }
 const winding=Math.sign(signedArea)||1;

 // Associate every door/window with exactly one nearest wall. A stored wallIndex is
 // preferred when still valid; otherwise nearest segment wins, supporting older JSON files.
 const openingByWall=room.map(()=>[]);
 for(const it of (state.items||[]).filter(x=>x.type==='door'||x.type==='window')){
  const cx=it.x+it.w/2,cy=it.y+it.d/2;
  let best=null;
  for(let i=0;i<room.length;i++){
   const a=room[i],b=room[(i+1)%room.length],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
   if(len2<1)continue;
   const tRaw=((cx-a.x)*dx+(cy-a.y)*dy)/len2;
   const t=Math.max(0,Math.min(1,tRaw));
   const px=a.x+t*dx,py=a.y+t*dy,dist=Math.hypot(cx-px,cy-py),len=Math.sqrt(len2);
   const preferred=Number.isInteger(it.wallIndex)&&it.wallIndex===i;
   const candidate={i,a,b,dx,dy,len,t,dist,s:t*len,preferred};
   if(!best || (preferred&&!best.preferred) || (preferred===best.preferred&&dist<best.dist))best=candidate;
  }
  if(!best)continue;
  const across=Math.max(1,Math.min(Number(it.w)||8,Number(it.d)||8));
  if(best.dist>Math.max(30,across/2+22))continue;
  const along=Math.max(1,Number(it.w)||80); // item width follows its snapped wall direction
  const half=along/2;
  const start=Math.max(0,best.s-half),end=Math.min(best.len,best.s+half);
  if(end-start<2)continue;
  openingByWall[best.i].push({start,end,type:it.type,item:it,center:best.s,bottom:Math.max(0,Number.isFinite(Number(it.elevation))?Number(it.elevation):(it.type==='window'&&Number.isFinite(Number(it.sillHeight))?Number(it.sillHeight):0)),height:Math.max(1,Number.isFinite(Number(it.height))?Number(it.height):(it.type==='window'&&Number.isFinite(Number(it.headHeight))?Number(it.headHeight)-(Number(it.sillHeight)||90):(it.type==='door'?205:100)))});
 }

 for(let i=0;i<room.length;i++){
  const a=room[i],b=room[(i+1)%room.length];
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  if(len<1)continue;
  // Rotation maps local +X to the wall direction (dx, 0, +dy).
  const angle=-Math.atan2(dy,dx);
  const outward=(winding>0)?{x:dy/len,z:-dx/len}:{x:-dy/len,z:dx/len};
  const makeWall=(from,to,bottom,top,tag='wall')=>{
   if(to-from<1||top-bottom<1)return;
   const wallMaterial=solidWallMat.clone();wallMaterial.color.set(paletteColor(state.wallColors[i],WALL_DEFAULT_COLOR));
   const mesh=new THREE.Mesh(new THREE.BoxGeometry(to-from,top-bottom,wallThickness),wallMaterial);
   const mid=(from+to)/2;
   mesh.position.set(a.x+dx/len*mid,(bottom+top)/2,a.y+dy/len*mid);
   mesh.rotation.y=angle;
   mesh.castShadow=true;mesh.receiveShadow=true;
   mesh.userData={wall:true,tag,outwardX:outward.x,outwardZ:outward.z};
   const line=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:0x46534a,transparent:false,depthTest:false}));
   line.position.copy(mesh.position);line.rotation.copy(mesh.rotation);line.visible=false;line.renderOrder=10;
   threeScene.add(mesh,line);wallMeshes.push({mesh,line});
  };
  const openings=openingByWall[i].sort((u,v)=>u.start-v.start);
  const normalised=[];
  for(const op of openings){
   const last=normalised[normalised.length-1];
   if(last&&op.start<last.end){
    // Keep openings non-overlapping rather than accidentally restoring a wall inside one.
    if(last.type===op.type){last.end=Math.max(last.end,op.end);continue}
    op.start=last.end;
   }
   if(op.end-op.start>=2)normalised.push({...op});
  }
  let cursor=0;
  for(const op of normalised){
   makeWall(cursor,op.start,0,wallHeight,'wall');
   if(op.type==='window'){
    const sill=Math.max(0,Math.min(wallHeight-1,op.bottom));
    const head=Math.max(sill+1,Math.min(wallHeight,sill+op.height));
    // The window opening is a real gap through the wall. Only sill and header remain.
    makeWall(op.start,op.end,0,sill,'window-sill');
    makeWall(op.start,op.end,head,wallHeight,'window-header');
    const glassW=Math.max(1,op.end-op.start-3),glassH=Math.max(1,head-sill-3),mid=(op.start+op.end)/2;
    const glassMaterial=windowMat.clone();glassMaterial.color.set(paletteColor(op.item.color,colors.window));
    const glass=new THREE.Mesh(new THREE.BoxGeometry(glassW,glassH,2),glassMaterial);
    glass.position.set(a.x+dx/len*mid,(sill+head)/2,a.y+dy/len*mid);
    glass.rotation.y=angle;glass.renderOrder=2;
    glass.userData={wall:true,tag:'window-glass',outwardX:outward.x,outwardZ:outward.z};
    const glassLine=new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry),new THREE.LineBasicMaterial({color:0x46534a,transparent:false,depthTest:false}));
    glassLine.position.copy(glass.position);glassLine.rotation.copy(glass.rotation);glassLine.visible=false;glassLine.renderOrder=11;
    threeScene.add(glass,glassLine);wallMeshes.push({mesh:glass,line:glassLine});
   } else if(op.type==='door'){
    // The door opening removes the whole vertical interval occupied by the door.
    const doorBottom=Math.max(0,Math.min(wallHeight-1,op.bottom));
    const doorHeight=Math.max(1,Math.min(wallHeight-doorBottom,op.height));
    const doorTop=doorBottom+doorHeight;
    makeWall(op.start,op.end,0,doorBottom,'door-lower-wall');
    makeWall(op.start,op.end,doorTop,wallHeight,'door-upper-wall');
    const doorWidth=Math.max(1,op.end-op.start-3),mid=(op.start+op.end)/2;
    const doorMat=new THREE.MeshStandardMaterial({color:paletteColor(op.item.color,colors.door),roughness:.82,side:THREE.DoubleSide});
    const openPercent=Math.max(0,Math.min(100,Number(op.item.openPercent)||0));
    const hingeAtEnd=op.item.hingeSide==='end';
    const swingSign=hingeAtEnd?-1:1;
    const swingAngle=(openPercent/100)*(Math.PI/2)*swingSign;
    const yaw=angle+swingAngle;
    const axisSign=hingeAtEnd?-1:1;
    const along=(hingeAtEnd?op.end:op.start);
    const hx=a.x+dx/len*along,hz=a.y+dy/len*along;
    const axisX=Math.cos(yaw),axisZ=-Math.sin(yaw);
    const leaf=new THREE.Mesh(new THREE.BoxGeometry(doorWidth,doorHeight,2.5),doorMat);
    leaf.position.set(hx+axisSign*axisX*doorWidth/2,doorBottom+doorHeight/2,hz+axisSign*axisZ*doorWidth/2);
    leaf.rotation.y=yaw;leaf.castShadow=true;leaf.receiveShadow=true;
    leaf.userData={wall:true,tag:'door-leaf',outwardX:outward.x,outwardZ:outward.z};
    const leafLine=new THREE.LineSegments(new THREE.EdgesGeometry(leaf.geometry),new THREE.LineBasicMaterial({color:0x46534a,transparent:false,depthTest:false}));
    leafLine.position.copy(leaf.position);leafLine.rotation.copy(leaf.rotation);leafLine.visible=false;leafLine.renderOrder=11;
    threeScene.add(leaf,leafLine);wallMeshes.push({mesh:leaf,line:leafLine});
   }
   // Wall meshes are omitted throughout the opening interval itself.
   cursor=Math.max(cursor,op.end);
  }
  makeWall(cursor,len,0,wallHeight,'wall');
 }

 // Place furniture using the same plan -> world transformation. SVG-positive rotation is
 // clockwise in Y-down coordinates, so its corresponding world Y rotation is negative.
 for(const it of (state.items||[])){
  if(it.type==='door'||it.type==='window')continue;
  const h=it.type==='note'?Math.max(1,Number(it.height)||2):Math.max(1,Number(it.height)||Math.max(35,Math.min(100,it.d)));
  const baseY=Math.max(0,Number(it.elevation)||0);
  const group=new THREE.Group();
  group.position.set(it.x+it.w/2,baseY,it.y+it.d/2);
  group.rotation.y=-(Number(it.rot)||0)*Math.PI/180;
  const itemColor=paletteColor(it.color,colors[it.type]||colors.furniture);
  const material=(color=itemColor)=>new THREE.MeshStandardMaterial({color,roughness:.8});
  const addBox=(w,hh,d,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(Math.max(1,w),Math.max(1,hh),Math.max(1,d)),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m};
  if(it.type==='table'){
   const top=material(itemColor),legs=material(itemColor),leg=Math.max(4,Math.min(8,Math.min(it.w,it.d)*.075)),topT=Math.min(5,Math.max(3,h*.06)),inX=Math.max(0,it.w/2-leg/2-Math.max(4,it.w*.10)),inZ=Math.max(0,it.d/2-leg/2-Math.max(4,it.d*.10));
   addBox(it.w,topT,it.d,0,h-topT/2,0,top);
   [[-inX,-inZ],[inX,-inZ],[-inX,inZ],[inX,inZ]].forEach(([x,z])=>addBox(leg,Math.max(1,h-topT),leg,x,(h-topT)/2,z,legs));
  }else if(it.type==='chair'){
   const seatTop=Math.min(h-8,Math.max(40,Math.min(46,h*.54))),leg=Math.max(3,Math.min(6,Math.min(it.w,it.d)*.12)),seatT=4,inX=Math.max(0,it.w/2-leg/2-Math.max(3,it.w*.12)),inZ=Math.max(0,it.d/2-leg/2-Math.max(3,it.d*.12));
   const wood=material(itemColor),dark=material(itemColor);
   addBox(Math.max(1,it.w-5),seatT,Math.max(1,it.d-5),0,seatTop,0,wood);
   [[-inX,-inZ],[inX,-inZ],[-inX,inZ],[inX,inZ]].forEach(([x,z])=>addBox(leg,Math.max(1,seatTop-seatT),leg,x,(seatTop-seatT)/2,z,dark));
   const backH=Math.max(4,h-seatTop-2);
   addBox(Math.max(1,it.w-7),backH,4,0,seatTop+backH/2,-Math.max(0,it.d/2-2),wood);
  }else if(it.type==='shelf'){
   const wood=material(itemColor),sideT=Math.max(2,Math.min(4,it.w*.04)),boardT=Math.max(2,Math.min(3.5,h*.018)),backT=Math.max(1.5,Math.min(3,it.d*.06));
   // Two full-height sides and a thin back make the shelving read as a real cabinet.
   addBox(sideT,h,it.d,-it.w/2+sideT/2,h/2,0,wood);
   addBox(sideT,h,it.d,it.w/2-sideT/2,h/2,0,wood);
   addBox(Math.max(1,it.w-sideT*2),h,backT,0,h/2,-it.d/2+backT/2,wood);
   const shelfCount=Math.max(2,Math.min(12,Math.floor(h/35)));
   for(let level=0;level<=shelfCount;level++){
    const y=boardT/2+(Math.max(0,h-boardT)*(level/shelfCount));
    addBox(Math.max(1,it.w-sideT*2),boardT,Math.max(1,it.d-backT),0,Math.min(h-boardT/2,y),backT/2,wood);
   }
  }else{
   const mat=material(itemColor);
   let geom;
   if(it.type==='column'&&(it.shape||'round')==='round')geom=new THREE.CylinderGeometry(Math.min(it.w,it.d)*.48,Math.min(it.w,it.d)*.48,h,24);
   else geom=new THREE.BoxGeometry(Math.max(1,it.w),h,Math.max(1,it.d));
   const mesh=new THREE.Mesh(geom,mat);mesh.position.y=h/2;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  threeScene.add(group);
 }

 // Frame the actual architectural bounds, so the floor cannot sit outside the camera frustum.
 const bounds=new THREE.Box3();
 for(const p of room){bounds.expandByPoint(new THREE.Vector3(p.x,0,p.y));bounds.expandByPoint(new THREE.Vector3(p.x,wallHeight,p.y));}
 for(const col of (state.columns||[]))for(const p of (col.points||[])){const base=Math.max(0,Number(col.elevation)||0);bounds.expandByPoint(new THREE.Vector3(p.x,base,p.y));bounds.expandByPoint(new THREE.Vector3(p.x,base+(Number(col.height)||wallHeight),p.y));}
 for(const it of (state.items||[])){
  const h=Math.max(1,Number(it.height)||({door:205,window:100,furniture:75,table:75,chair:85,appliance:85,column:250,note:2,shelf:180}[it.type]||75));
  const elevation=Math.max(0,Number(it.elevation)||0),r=Math.hypot(Number(it.w)||0,Number(it.d)||0)/2;
  bounds.expandByPoint(new THREE.Vector3(it.x+it.w/2-r,elevation,it.y+it.d/2-r));
  bounds.expandByPoint(new THREE.Vector3(it.x+it.w/2+r,elevation+h,it.y+it.d/2+r));
 }
 if(bounds.isEmpty())bounds.set(new THREE.Vector3(0,0,0),new THREE.Vector3(500,wallHeight,400));
 const bsize=bounds.getSize(new THREE.Vector3());
 const cx=(bounds.min.x+bounds.max.x)/2,cz=(bounds.min.z+bounds.max.z)/2;
 const targetY=Math.max(0,Math.min(wallHeight,(bounds.min.y+bounds.max.y)*.42));
 const target=new THREE.Vector3(cx,targetY,cz);
 const sphere=bounds.getBoundingSphere(new THREE.Sphere());
 const fovV=THREE.MathUtils.degToRad(threeCamera.fov);
 const fovH=2*Math.atan(Math.tan(fovV/2)*threeCamera.aspect);
 const limitingFov=Math.max(.05,Math.min(fovV,fovH));
 const fitDistance=Math.max(100,sphere.radius/Math.sin(limitingFov/2)*1.02);
 threeCamera.far=Math.max(10000,fitDistance*10);threeCamera.updateProjectionMatrix();
 threeYaw=preserveCamera?savedYaw:.72;threePitch=preserveCamera?savedPitch:.62;threeZoom=preserveCamera?Math.max(fitDistance*.25,Math.min(fitDistance*4,savedZoom)):fitDistance;
 function cameraUpdate(){
  const radius=threeZoom,cp=Math.cos(threePitch);
  threeCamera.position.set(target.x+Math.cos(threeYaw)*radius*cp,target.y+Math.sin(threePitch)*radius,target.z+Math.sin(threeYaw)*radius*cp);
  threeCamera.lookAt(target);
  // A front wall is defined by the side of the wall that faces away from the room.
  // Its faces are removed entirely; only its edge lines remain, without alpha sorting.
  for(const entry of wallMeshes){
   const m=entry.mesh,u=m.userData||{};
   const vx=threeCamera.position.x-m.position.x,vz=threeCamera.position.z-m.position.z;
   const nx=Number.isFinite(u.outwardX)?u.outwardX:(entry.outwardX||0);
   const nz=Number.isFinite(u.outwardZ)?u.outwardZ:(entry.outwardZ||0);
   const facingOutside=vx*nx+vz*nz>0;
   // Foreground surfaces are not alpha-transparent: they are removed from the draw pass
   // entirely and represented only by their outline. Applies equally to walls, glass and doors.
   m.visible=!facingOutside;
   entry.line.visible=facingOutside;
  }
 }
 cameraUpdate();
 let down=null;
 threeRenderer.domElement.onpointerdown=e=>{down={x:e.clientX,y:e.clientY,yaw:threeYaw,pitch:threePitch};threeRenderer.domElement.setPointerCapture(e.pointerId)};
 threeRenderer.domElement.onpointermove=e=>{if(!down)return;threeYaw=down.yaw-(e.clientX-down.x)*.008;threePitch=Math.max(.12,Math.min(1.35,down.pitch+(e.clientY-down.y)*.006));cameraUpdate()};
 threeRenderer.domElement.onpointerup=()=>down=null;
 threeRenderer.domElement.onpointercancel=()=>down=null;
 threeRenderer.domElement.onwheel=e=>{e.preventDefault();threeZoom=Math.max(fitDistance*.25,Math.min(fitDistance*4,threeZoom*Math.exp(e.deltaY*.001)));cameraUpdate()};
 const animate=()=>{threeFrame=requestAnimationFrame(animate);threeRenderer.render(threeScene,threeCamera)};
 animate();
}
function close3D(){if(threeFrame)cancelAnimationFrame(threeFrame);$('view3d').classList.remove('active');svg.style.visibility='visible'}
$('view3dBtn').onclick=build3D;$('exit3d').onclick=close3D;window.addEventListener('resize',()=>{if(threeRenderer&&$('view3d').classList.contains('active')){threeCamera.aspect=Math.max(1,$('view3d').clientWidth)/Math.max(1,$('view3d').clientHeight);threeCamera.updateProjectionMatrix();threeRenderer.setSize($('view3d').clientWidth,$('view3d').clientHeight)}});
render();showProps();
