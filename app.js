const $=id=>document.getElementById(id), svg=$('canvas'), wallLayer=$('walls'), objLayer=$('objects'), draftLayer=$('draft');
const NS='http://www.w3.org/2000/svg';
const APP_VERSION='1.2.0';
let state={room:[],columns:[],items:[],lights:[],wallHeight:250,wallColor:'#d5ddd5'};
let doorRangeCheckpointed=false;
let selected=null,selectedVertex=null,selectedWallIndex=0,selectedLightId=null,tool='select',drawing=[],history=[],future=[],drag=null,nextId=1,lastWallClick=null;
const SNAP=12; let threeScene=null,threeCamera=null,threeRenderer=null,threeFrame=null,threeYaw=.75,threePitch=.65,threeZoom=1,threeDrag=null;
let threeTarget=null,threeFitDistance=1,threeUpdateCamera=null,threeListenersAttached=false,threeInteraction=null,threeItemGroups=new Map(),threeColumnGroups=new Map(),threeWallMeshes=[],threeSelectionHelper=null,suppress3DAutoRefresh=false;
let activeRaycaster=null,threeMouse=null;
const colors={furniture:'#d7e1d8',table:'#c9a77b',chair:'#bda78d',shelf:'#bba68b',door:'#dce8f5',window:'#b7d8e9',appliance:'#d9d9d9',column:'#b9b0a0',note:'#f4d9a5'};
const WALL_DEFAULT='#d5ddd5';
const PALETTE=[
 {name:'Gris brume',hex:'#d5ddd5'}, {name:'Vert sauge',hex:'#d7e1d8'},
 {name:'Bois miel',hex:'#c9a77b'}, {name:'Sable',hex:'#bda78d'},
 {name:'Chêne',hex:'#bba68b'}, {name:'Bleu pâle',hex:'#dce8f5'},
 {name:'Bleu vitrage',hex:'#b7d8e9'}, {name:'Gris clair',hex:'#d9d9d9'},
 {name:'Pierre',hex:'#b9b0a0'}, {name:'Jaune doux',hex:'#f4d9a5'},
 {name:'Graphite',hex:'#45484b'}, {name:'Anthracite',hex:'#30343b'},
 {name:'Noir mat',hex:'#252629'}, {name:'Blanc ivoire',hex:'#f2eee5'},
 {name:'Vert forêt',hex:'#3f5f50'}, {name:'Bleu marine',hex:'#30465c'},
 {name:'Terracotta',hex:'#bd705b'}, {name:'Rouge brique',hex:'#984f43'},
 {name:'Rose poudré',hex:'#d4b7b2'}, {name:'Kaki',hex:'#858868'}
];
function paletteColor(value,fallback){const v=String(value||'').toLowerCase();return PALETTE.some(p=>p.hex===v)?v:fallback;}
function ensureState(){
 if(!Array.isArray(state.columns))state.columns=[];if(!Array.isArray(state.items))state.items=[];if(!Array.isArray(state.room))state.room=[];if(!Array.isArray(state.lights))state.lights=[];
 if(!Number.isFinite(Number(state.wallHeight))||Number(state.wallHeight)<=0)state.wallHeight=250;
 state.wallColor=paletteColor(state.wallColor,WALL_DEFAULT);
 state.columns.forEach(c=>{if(c.colorLinked===true)c.color=state.wallColor;else if(!c.color){c.color=state.wallColor||WALL_DEFAULT;c.colorLinked=true}else c.color=paletteColor(c.color,state.wallColor||WALL_DEFAULT)});
 state.items.forEach(it=>{it.color=paletteColor(it.color,colors[it.type]||colors.furniture)});
 state.lights.forEach(l=>{l.color=paletteColor(l.color,'#dce8f5');if(l.enabled===undefined)l.enabled=true});
}
function fillPaletteSelect(id){const sel=$(id);if(!sel)return;const old=sel.value;sel.innerHTML='';PALETTE.forEach(p=>{const o=document.createElement('option');o.value=p.hex;o.textContent=p.name;sel.appendChild(o)});if(PALETTE.some(p=>p.hex===old))sel.value=old;}
function syncPalette(selectId,paletteId){const sel=$(selectId),holder=$(paletteId);if(!sel||!holder)return;holder.querySelectorAll('.color-swatch').forEach(btn=>btn.classList.toggle('active',btn.dataset.color===sel.value));}
function buildPalette(selectId,paletteId){const holder=$(paletteId),sel=$(selectId);if(!holder||!sel)return;holder.innerHTML='';PALETTE.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='color-swatch';b.style.backgroundColor=p.hex;b.title=p.name;b.setAttribute('aria-label',p.name);b.dataset.color=p.hex;b.onclick=()=>{sel.value=p.hex;sel.dispatchEvent(new Event('change',{bubbles:true}));syncPalette(selectId,paletteId)};holder.appendChild(b)});syncPalette(selectId,paletteId);}
function initPalette(){['pColor','wallColor','pLightColor'].forEach(fillPaletteSelect);buildPalette('pColor','pColorPalette');buildPalette('wallColor','wallColorPalette');buildPalette('pLightColor','pLightColorPalette');if($('appVersion'))$('appVersion').textContent='v'+APP_VERSION;} function snapshot(){ensureState();return JSON.stringify(state)} function checkpoint(){history.push(snapshot());if(history.length>80)history.shift();future=[]}
function el(tag,attrs={},parent){const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));if(parent)parent.appendChild(n);return n}
function setTool(t){tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));$('status').textContent=t==='wall'?'Clique les angles du contour. Clique près du premier point pour fermer.':t==='object'?'Clique dans le plan pour placer un objet.':'Sélectionne et déplace les objets ou les sommets du contour.';drawing=[];renderDraft()}
function render(){ensureState();wallLayer.innerHTML='';objLayer.innerHTML='';if(state.room.length){const p=el('polygon',{points:state.room.map(p=>`${p.x},${p.y}`).join(' '),class:'wall'+(selected==='room'?' selected':''),'data-room':'1'},wallLayer);p.style.stroke=selected==='room'?'#2d7450':(state.wallColor||WALL_DEFAULT);p.style.fill='#ffffff';p.style.fillOpacity='.45';p.addEventListener('pointerdown',e=>{
 if(tool!=='select'||e.target!==p)return;
 const q=point(e),now=Date.now();
 if(lastWallClick&&now-lastWallClick.time<500&&Math.hypot(q.x-lastWallClick.point.x,q.y-lastWallClick.point.y)<22){
  lastWallClick=null;e.preventDefault();e.stopPropagation();if(editWallLengthAt(q))return;
 }else lastWallClick={time:now,point:q};
 e.stopPropagation();selectedLightId=null;showLightProps();selected='room';selectedVertex=null;let best=Infinity;
 state.room.forEach((a,i)=>{const b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/l2)):0,d=Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy);if(d<best){best=d;selectedWallIndex=i}});
 showProps();render()
 });state.room.forEach((pt,i)=>{const c=el('circle',{cx:pt.x,cy:pt.y,r:selected==='room'?6:3.5,class:'vertex',opacity:selected==='room'?1:.65},wallLayer);c.addEventListener('pointerdown',e=>{if(tool!=='select')return;e.stopPropagation();selected='room';selectedVertex=i;drag={kind:'vertex',index:i};checkpoint();showProps();render()})})}
state.columns.forEach((col,ci)=>{const poly=el('polygon',{points:col.points.map(p=>`${p.x},${p.y}`).join(' '),class:'wall column-contour'+(selected===col.id?' selected':''),fill:(col.color||state.wallColor||WALL_DEFAULT),'fill-opacity':'.55','data-column':col.id},wallLayer);poly.style.fill=col.color||state.wallColor||WALL_DEFAULT;poly.style.fillOpacity='.55';poly.style.stroke=selected===col.id?'#2d7450':(col.color||state.wallColor||WALL_DEFAULT);poly.addEventListener('pointerdown',e=>{if(tool==='select'){e.stopPropagation();selectedLightId=null;showLightProps();selected=col.id;selectedVertex=null;showProps();render()}});col.points.forEach((pt,i)=>{const c=el('circle',{cx:pt.x,cy:pt.y,r:selected===col.id?6:3.5,class:'vertex',opacity:selected===col.id?1:.65},wallLayer);c.addEventListener('pointerdown',e=>{if(tool!=='select')return;e.stopPropagation();selectedLightId=null;showLightProps();selected=col.id;selectedVertex=i;drag={kind:'columnVertex',id:col.id,index:i};checkpoint();showProps();render()})})});
state.items.forEach(it=>{
 const g=el('g',{class:'object'+(selected===it.id?' selected':''),transform:`translate(${it.x} ${it.y}) rotate(${it.rot||0} ${it.w/2} ${it.d/2})`,'data-id':it.id},objLayer);
 const stroke=selected===it.id?'#2d7450':'#58655a',sw=selected===it.id?3:1.5,objectColor=it.color||colors[it.type]||colors.furniture;
 const drawRect=(x,y,w,h,fill,cls='detail',rx=0)=>el('rect',{x,y,width:w,height:h,rx,fill,stroke:cls==='shape'?stroke:'#655e52','stroke-width':cls==='shape'?sw:1,class:cls},g);
 if(it.type==='shelf'){
  drawRect(0,0,it.w,it.d,objectColor,'shape',1);
  drawRect(2,2,Math.max(1,it.w-4),Math.max(1,it.d-4),'none','detail',0);
 }else if(it.type==='table'){
  const leg=Math.max(4,Math.min(8,Math.min(it.w,it.d)*.09)),ix=Math.max(leg+2,it.w*.10),iy=Math.max(leg+2,it.d*.10),legFill='#806343';
  [[ix-leg/2,iy-leg/2],[it.w-ix-leg/2,iy-leg/2],[ix-leg/2,it.d-iy-leg/2],[it.w-ix-leg/2,it.d-iy-leg/2]].forEach(([x,y])=>drawRect(x,y,leg,leg,legFill));
  drawRect(3,3,Math.max(1,it.w-6),Math.max(1,it.d-6),objectColor,'shape',2);
 }else if(it.type==='chair'){
  const leg=Math.max(3,Math.min(6,Math.min(it.w,it.d)*.12)),ix=Math.max(leg+2,it.w*.18),iy=Math.max(leg+2,it.d*.18),legFill='#79624e';
  [[ix-leg/2,iy-leg/2],[it.w-ix-leg/2,iy-leg/2],[ix-leg/2,it.d-iy-leg/2],[it.w-ix-leg/2,it.d-iy-leg/2]].forEach(([x,y])=>drawRect(x,y,leg,leg,legFill));
  drawRect(5,5,Math.max(1,it.w-10),Math.max(1,it.d-10),objectColor,'shape',2);
  drawRect(5,2,Math.max(1,it.w-10),Math.max(3,leg), '#947c63','detail',1);
 }else if(it.type==='column'&&(it.shape||'round')==='round'){
  el('ellipse',{cx:it.w/2,cy:it.d/2,rx:it.w/2,ry:it.d/2,fill:objectColor,stroke, 'stroke-width':sw,class:'shape'},g);
 }else{
  drawRect(0,0,it.w,it.d,objectColor,'shape',it.type==='note'?5:1);
 }
 if(it.type==='door')el('path',{d:`M 0 0 A ${it.w} ${it.w} 0 0 1 ${it.w} ${it.d}`,fill:'none',stroke:'#657a89','stroke-width':1.5},g);
 const tx=el('text',{x:it.w/2,y:it.d/2+4,'text-anchor':'middle','font-size':Math.max(8,Math.min(13,it.d/4)),fill:'#344239','pointer-events':'none'},g);tx.textContent=it.name;
 g.addEventListener('pointerdown',e=>{if(tool==='wall')return;e.stopPropagation();if(tool==='object'){placeObject(e);return}selected=it.id;drag={kind:'item',id:it.id,dx:0,dy:0};checkpoint();showProps();render();const pt=point(e);drag.dx=pt.x-it.x;drag.dy=pt.y-it.y});
 });;renderList();renderLightList();if(selected!=='room'&&!state.items.some(i=>i.id===selected)&&!state.columns.some(c=>c.id===selected))selected=null;if(!suppress3DAutoRefresh&&threeRenderer&&$('view3d').classList.contains('active'))build3D({reuse:true,preserveView:true});}
function renderList(){$('itemList').innerHTML='';$('emptyList').classList.toggle('hidden',state.items.length>0);state.items.forEach(it=>{const li=document.createElement('li');li.className=selected===it.id?'selected':'';li.innerHTML=`<span class="dot" style="background:${it.color||colors[it.type]||colors.furniture}"></span><span class="name"></span><small>${Math.round(it.w)}×${Math.round(it.d)}</small>`;li.querySelector('.name').textContent=it.name;li.onclick=()=>{selectedLightId=null;showLightProps();selected=it.id;setTool('select');showProps();render()};$('itemList').appendChild(li)})}
function showProps(){
 ensureState();
 if($('wallColor'))$('wallColor').value=state.wallColor||WALL_DEFAULT;syncPalette('wallColor','wallColorPalette');
 const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected),hasProps=!!it||!!col;
 $('props').classList.toggle('hidden',!hasProps);
 $('roomPanel').classList.toggle('hidden',hasProps);
 $('propColorField').classList.toggle('hidden',!hasProps);
 $('propDimensions').classList.toggle('hidden',!!col&&!it);
 $('propPosition').classList.toggle('hidden',!!col&&!it);
 $('propRotation').classList.toggle('hidden',!!col&&!it);
 $('columnShapeField').classList.toggle('hidden',!it||it.type!=='column');
 $('doorOptions').classList.toggle('hidden',!it||it.type!=='door');
 $('propTypeField').classList.toggle('hidden',!it);
 $('duplicateBtn').classList.toggle('hidden',!!col&&!it);
 $('propCommentField')?.classList.toggle('hidden',!!col&&!it);
 if(col&&!it){
  $('status').textContent='Colonne/pilier sélectionné : déplace ses sommets ou modifie sa hauteur et son élévation.';
  $('pName').value=col.name||'Colonne';
  $('pColor').value=col.color||state.wallColor||WALL_DEFAULT;syncPalette('pColor','pColorPalette');
  $('pH').value=Math.max(1,Number(col.height)||Number(state.wallHeight)||250);
  $('pElev').value=Math.max(0,Number(col.elevation)||0);
  $('pComment').value=col.comment||'';
  return;
 }
 if(it){
  $('pType').value=it.type;
  $('pColor').value=it.color||colors[it.type]||colors.furniture;syncPalette('pColor','pColorPalette');
  $('pName').value=it.name;
  $('pDoorOpen').value=Math.max(0,Math.min(100,Number(it.openPercent)||0));$('pDoorOpenValue').textContent=Math.round(Number(it.openPercent)||0)+' % · '+Math.round((Number(it.openPercent)||0)*1.2)+'°';$('pDoorSwing').value=it.swingDirection==='out'?'out':'in';$('pDoorHinge').value=it.hingeSide==='B'?'B':'A';
  $('pW').value=it.w;$('pD').value=it.d;
  $('pX').value=Math.round(it.x);$('pY').value=Math.round(it.y);
  $('pRot').value=it.rot||0;$('pComment').value=it.comment||'';
  const defaults={furniture:75,table:75,chair:85,shelf:180,door:205,window:100,appliance:85,column:250,note:2};
  const legacyWindowElevation=Number.isFinite(Number(it.sillHeight))?Number(it.sillHeight):90;
  $('pH').value=Math.max(1,Number.isFinite(Number(it.height))?Number(it.height):(it.type==='window'&&Number.isFinite(Number(it.headHeight))?Number(it.headHeight)-legacyWindowElevation:defaults[it.type]||75));
  $('pElev').value=Math.max(0,Number.isFinite(Number(it.elevation))?Number(it.elevation):(it.type==='window'?legacyWindowElevation:0));
  $('pColumnShape').value=it.shape||'round';
 }
}
function point(e){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());return{x:q.x,y:q.y}}
function snapPoint(p,excludeId=null){let q={x:Math.round(p.x/5)*5,y:Math.round(p.y/5)*5};const candidates=[];state.room.forEach(v=>candidates.push(v));state.items.filter(it=>it.id!==excludeId).forEach(it=>{candidates.push({x:it.x,y:it.y},{x:it.x+it.w,y:it.y},{x:it.x,y:it.y+it.d},{x:it.x+it.w,y:it.y+it.d},{x:it.x+it.w/2,y:it.y+it.d/2})});let best=SNAP;for(const c of candidates){const d=Math.hypot(c.x-p.x,c.y-p.y);if(d<best){best=d;q={x:c.x,y:c.y}}}return q}
function snapToWall(it){if(!['door','window'].includes(it.type)||state.room.length<2)return;const cx=it.x+it.w/2,cy=it.y+it.d/2;let best=null;for(let i=0;i<state.room.length;i++){const a=state.room[i],b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;if(!len2)continue;const t=Math.max(0,Math.min(1,((cx-a.x)*dx+(cy-a.y)*dy)/len2));const px=a.x+t*dx,py=a.y+t*dy,dist=Math.hypot(cx-px,cy-py);if(!best||dist<best.dist)best={a,b,t,px,py,dist,angle:Math.atan2(dy,dx)*180/Math.PI,len:Math.sqrt(len2)}}if(best&&best.dist<90){const along=Math.max(it.w,it.d),across=Math.min(it.w,it.d);it.rot=best.angle;it.x=best.px-it.w/2;it.y=best.py-it.d/2;it.wallIndex=state.room.indexOf(best.a)}}
function editWallLengthAt(q){
 if(state.room.length<2)return false;
 let best=Infinity,bestIndex=0;
 state.room.forEach((a,i)=>{const b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/l2)):0,d=Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy);if(d<best){best=d;bestIndex=i}});
 if(best>24)return false;
 const a=state.room[bestIndex],b=state.room[(bestIndex+1)%state.room.length],old=Math.hypot(b.x-a.x,b.y-a.y);
 const raw=prompt('Nouvelle longueur du mur (cm) :',String(Math.round(old)));
 if(raw===null)return true;
 const desired=Number(raw);
 if(!Number.isFinite(desired)||desired<=0){alert('Saisis une longueur positive en centimètres.');return true;}
 checkpoint();const k=desired/(old||1);state.room[(bestIndex+1)%state.room.length]={x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k};
 selected='room';selectedVertex=(bestIndex+1)%state.room.length;selectedWallIndex=bestIndex;showProps();render();$('status').textContent='Longueur du mur mise à jour : '+desired+' cm.';return true;
}
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
 const it={id:'o'+nextId++,type,name,w,d,x:cx-w/2,y:cy-d/2,rot:0,height:vertical.height,elevation:vertical.elevation,color:colors[type]||colors.furniture,comment:'',shape:type==='column'?'rect':undefined,openPercent:0,swingDirection:'in',hingeSide:'A'};
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
svg.addEventListener('pointerdown',e=>{if(e.target.closest('.object')||e.target.classList.contains('vertex'))return;let p=point(e);if(tool==='wall'){p=snapPoint(p);p=constrainWall(p,drawing[drawing.length-1],e.shiftKey);if(drawing.length>2&&Math.hypot(p.x-drawing[0].x,p.y-drawing[0].y)<18){const contour=drawing.slice();checkpoint();if(state.room.length>=3&&contour.every(pt=>pointInPolygon(pt,state.room))&&contour.some(pt=>!samePoint(pt,state.room[0]))){const id='col'+nextId++;state.columns.push({id,name:'Colonne '+nextId,points:contour,height:250,elevation:0,color:state.wallColor||WALL_DEFAULT,colorLinked:true});selected=id;$('status').textContent='Contour intérieur reconnu comme colonne/pilier.'}else{state.room=contour;selected='room';$('status').textContent='Contour de la pièce fermé.'}drawing=[];setTool('select');showProps();render();return}drawing.push(p);renderDraft();return}if(tool==='object'){placeObject(e);return}selected=null;selectedLightId=null;showProps();showLightProps();render()});
svg.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);if(drag.kind==='item'){const it=state.items.find(x=>x.id===drag.id);if(it){const q=snapPoint({x:p.x-drag.dx,y:p.y-drag.dy},it.id);it.x=q.x;it.y=q.y;snapToWall(it);render()}}else if(drag.kind==='vertex'){const q=snapPoint(p);state.room[drag.index]=q;selectedVertex=drag.index;render()}else if(drag.kind==='columnVertex'){const q=snapPoint(p);const col=state.columns.find(c=>c.id===drag.id);if(col){col.points[drag.index]=q;selectedVertex=drag.index;render()}}});window.addEventListener('pointerup',()=>{drag=null});
$('addVertexBtn').onclick=()=>{if(state.room.length<3){alert('Crée d’abord le contour de la pièce.');return}checkpoint();const i=selectedWallIndex%state.room.length,a=state.room[i],b=state.room[(i+1)%state.room.length];const pt={x:(a.x+b.x)/2,y:(a.y+b.y)/2};state.room.splice(i+1,0,pt);selected='room';selectedVertex=i+1;selectedWallIndex=i;showProps();render();$('status').textContent='Point ajouté au milieu du mur le plus long. Glisse-le pour le positionner.'};$('removeVertexBtn').onclick=()=>{if(selected!=='room'||selectedVertex===null||state.room.length<=3){alert('Sélectionne un sommet (et conserve au moins 3 points).');return}checkpoint();state.room.splice(selectedVertex,1);selectedVertex=null;render();showProps()};
$('addObject').onclick=()=>{
 const center=roomInteriorCenter();
 // The explicit sidebar action creates the chosen object immediately at the room centre.
 // The separate toolbar tool still permits click-to-place; doors/windows snap when placed that way.
 createObjectAt(center,$('objectType').value,{snapOpeningToWall:false});
};document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$('pType').addEventListener('change',()=>{
 const it=state.items.find(x=>x.id===selected),nextType=$('pType').value;
 if(!it||it.type===nextType)return;
 const defs=objectDefaults[nextType]||objectDefaults.furniture;
 checkpoint();
 // Changing the semantic type never overwrites geometry or placement; only the type/name/model change.
 it.type=nextType;it.name=defs[2];
 if(nextType==='column'){if(!it.shape)it.shape='rect'}else delete it.shape;
 if(nextType==='door') {if(!Number.isFinite(Number(it.openPercent)))it.openPercent=0;if(!it.swingDirection)it.swingDirection='in';if(!it.hingeSide)it.hingeSide='A';snapToWall(it)}
 else if(nextType==='window')snapToWall(it);else delete it.wallIndex;
 showProps();render();$('status').textContent='Type de l’objet modifié ; dimensions conservées : '+it.name+'.';
});
function bindProp(id,key,cast=v=>v){$(id).addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();if(it)it[key]=cast($(id).value);else if(key==='name'||key==='comment')col[key]=cast($(id).value);render()})}

$('pColor').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();if(it)it.color=$('pColor').value;else{col.color=$('pColor').value;col.colorLinked=false}render();showProps();syncPalette('pColor','pColorPalette')});
$('wallColor').addEventListener('change',()=>{checkpoint();state.wallColor=$('wallColor').value;state.columns.forEach(c=>{if(c.colorLinked===true)c.color=state.wallColor});render();showProps();syncPalette('wallColor','wallColorPalette')});
bindProp('pName','name',v=>v);bindProp('pW','w',v=>Math.max(1,Number(v)||1));bindProp('pD','d',v=>Math.max(1,Number(v)||1));bindProp('pX','x',Number);bindProp('pY','y',Number);bindProp('pRot','rot',Number);bindProp('pComment','comment',v=>v);
$('pH').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();const h=Math.max(1,Number($('pH').value)||1);if(it)it.height=h;else col.height=h;showProps();render()});
$('pElev').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);if(!it&&!col)return;checkpoint();const elevation=Math.max(0,Number($('pElev').value)||0);if(it)it.elevation=elevation;else col.elevation=elevation;showProps();render()});
$('pColumnShape').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected);if(!it||it.type!=='column')return;checkpoint();it.shape=$('pColumnShape').value;render()});
function updateDoorProp(key,value){const it=state.items.find(x=>x.id===selected);if(!it||it.type!=='door')return;checkpoint();it[key]=value;showProps();render()}
$('pDoorOpen').addEventListener('input',()=>{const it=state.items.find(x=>x.id===selected);if(!it||it.type!=='door')return;if(!doorRangeCheckpointed){checkpoint();doorRangeCheckpointed=true}it.openPercent=Math.max(0,Math.min(100,Number($('pDoorOpen').value)||0));$('pDoorOpenValue').textContent=Math.round(it.openPercent)+' % · '+Math.round(it.openPercent*1.2)+'°';render()});
$('pDoorOpen').addEventListener('change',()=>{const it=state.items.find(x=>x.id===selected);if(!it||it.type!=='door')return;it.openPercent=Math.max(0,Math.min(100,Number($('pDoorOpen').value)||0));doorRangeCheckpointed=false;render()});
$('pDoorOpen').addEventListener('pointerdown',()=>{doorRangeCheckpointed=false});
$('pDoorSwing').addEventListener('change',()=>updateDoorProp('swingDirection',$('pDoorSwing').value));
$('pDoorHinge').addEventListener('change',()=>updateDoorProp('hingeSide',$('pDoorHinge').value));
function deleteSelected(){
 if(!selected)return;
 if(selected==='room'){
  if(selectedVertex!==null&&state.room.length>3){checkpoint();state.room.splice(selectedVertex,1);selectedVertex=null;showProps();render();$('status').textContent='Sommet du mur supprimé.'}
  return;
 }
 const isItem=state.items.some(i=>i.id===selected),isColumn=state.columns.some(c=>c.id===selected);
 if(!isItem&&!isColumn)return;
 const deletedId=selected;checkpoint();state.items=state.items.filter(i=>i.id!==deletedId);state.columns=state.columns.filter(c=>c.id!==deletedId);selected=null;selectedVertex=null;showProps();render();$('status').textContent='Élément supprimé.';
}
$('deleteBtn').onclick=deleteSelected;
$('duplicateBtn').onclick=()=>{const it=state.items.find(i=>i.id===selected);if(!it)return;checkpoint();const copy={...it,id:'o'+nextId++,name:it.name+' (copie)',x:it.x+20,y:it.y+20};state.items.push(copy);selected=copy.id;showProps();render()};
$('makeRect').onclick=()=>{const w=Math.max(50,Number($('roomWidth').value)||500),h=Math.max(50,Number($('roomLength').value)||400);checkpoint();state.room=[{x:300,y:250},{x:300+w,y:250},{x:300+w,y:250+h},{x:300,y:250+h}];selected='room';setTool('select');showProps();render();fit()};
$('gridToggle').onchange=()=> $('gridBg').setAttribute('opacity',$('gridToggle').checked?'1':'0');
$('undoBtn').onclick=undo;$('redoBtn').onclick=redo;function undo(){if(!history.length)return;future.push(snapshot());state=JSON.parse(history.pop());selected=null;selectedLightId=null;showProps();showLightProps();render()}function redo(){if(!future.length)return;history.push(snapshot());state=JSON.parse(future.pop());selected=null;selectedLightId=null;showProps();showLightProps();render()}
window.addEventListener('keydown',e=>{
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
 if(e.key==='Escape'){setTool('select');return}
 if(e.key==='Delete'||e.key==='Backspace'){
  const target=e.target;
  const editing=target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if(editing||!selected)return;
  e.preventDefault();deleteSelected();
 }
});
$('newBtn').onclick=()=>{if(!confirm('Créer un nouveau plan ? Le plan actuel sera remplacé dans cette session.'))return;checkpoint();state={room:[],columns:[],items:[],lights:[],wallHeight:250,wallColor:WALL_DEFAULT};nextId=1;selected=null;selectedLightId=null;showLightProps();setTool('wall');showProps();render();$('status').textContent='Nouvelle pièce : clique les angles de son contour.'};

function renderLightList(){
 const list=$('lightList');if(!list)return;list.innerHTML='';
 const listLights=state.lights||[];
 $('emptyLightList').classList.toggle('hidden',listLights.length>0);
 listLights.forEach(l=>{
  const li=document.createElement('li');li.className=selectedLightId===l.id?'selected':'';
  const labels={spot:'Spot',ambient:'Ambiante',lamp:'Lampe'};
  li.innerHTML=`<span class="dot" style="background:${l.color||'#dce8f5'}"></span><span class="name"></span><small>${labels[l.type]||l.type}</small>`;
  li.querySelector('.name').textContent=l.name||labels[l.type]||'Lumière';
  li.onclick=()=>{selected=null;selectedVertex=null;selectedLightId=l.id;showProps();showLightProps();renderLightList()};list.appendChild(li);
 });
}
function showLightProps(){
 const l=(state.lights||[]).find(x=>x.id===selectedLightId);$('lightProps').classList.toggle('hidden',!l);if(!l)return;
 $('pLightName').value=l.name||'';$('pLightColor').value=l.color||'#dce8f5';syncPalette('pLightColor','pLightColorPalette');$('pLightIntensity').value=Number(l.intensity)||0;$('pLightEnabled').checked=l.enabled!==false;
 $('pLightX').value=Math.round(Number(l.x)||0);$('pLightPlanY').value=Math.round(Number(l.planY)||0);$('pLightHeight').value=Math.round(Number(l.height)||0);$('pLightDistance').value=Math.round(Number(l.distance)||700);$('pLightAngle').value=Math.round(Number(l.angle)||50);
 $('lightPositionFields').classList.toggle('hidden',l.type==='ambient');$('lightDistanceField').classList.toggle('hidden',l.type==='ambient');$('lightAngleField').classList.toggle('hidden',l.type!=='spot');
}
function refresh3DForLight(){if(threeRenderer&&$('view3d').classList.contains('active'))build3D({reuse:true,preserveView:true});}
function updateSelectedLight(key,value,{checkpointState=true,rerenderList=false}={}){
 const l=(state.lights||[]).find(x=>x.id===selectedLightId);if(!l)return;if(checkpointState)checkpoint();l[key]=value;
 if(key==='color'){const li=[...$('lightList').children].find(n=>n.querySelector('.name')?.textContent===(l.name||''));if(li)li.querySelector('.dot').style.background=value;}
 if(rerenderList)renderLightList();showLightProps();refresh3DForLight();
}
$('addLight').onclick=()=>{
 ensureState();const type=$('lightTypeCreate').value,room=state.room;
 const x=room.length?room.reduce((s,p)=>s+p.x,0)/room.length:250,planY=room.length?room.reduce((s,p)=>s+p.y,0)/room.length:200;
 const names={spot:'Spot',ambient:'Lumière ambiante',lamp:'Lampe'};
 const defaults={spot:{intensity:3,distance:Math.max(300,Math.max(Number(state.wallHeight)||250,500)*2.4),angle:50,height:Math.max(220,(Number(state.wallHeight)||250)+60)},ambient:{intensity:.5,distance:1000,angle:50,height:Math.max(220,(Number(state.wallHeight)||250)+60)},lamp:{intensity:3.5,distance:700,angle:50,height:Math.max(220,(Number(state.wallHeight)||250)+40)}}[type];
 checkpoint();selected=null;selectedVertex=null;const l={id:'l'+nextId++,type,name:names[type],color:'#dce8f5',enabled:true,x:Math.round(x/5)*5,planY:Math.round(planY/5)*5,...defaults};state.lights.push(l);selectedLightId=l.id;showProps();showLightProps();renderLightList();refresh3DForLight();$('status').textContent=names[type]+' ajoutée.';
};
$('deleteLightBtn').onclick=()=>{if(!selectedLightId)return;checkpoint();state.lights=state.lights.filter(l=>l.id!==selectedLightId);selectedLightId=null;showLightProps();renderLightList();refresh3DForLight()};
[['pLightName','name',v=>v],['pLightColor','color',v=>v],['pLightIntensity','intensity',v=>Math.max(0,Math.min(10,Number(v)||0))],['pLightX','x',v=>Number(v)||0],['pLightPlanY','planY',v=>Number(v)||0],['pLightHeight','height',v=>Math.max(0,Number(v)||0)],['pLightDistance','distance',v=>Math.max(1,Number(v)||1)],['pLightAngle','angle',v=>Math.max(10,Math.min(120,Number(v)||50))]].forEach(([id,key,cast])=>$(id).addEventListener('change',()=>updateSelectedLight(key,cast($(id).value),{rerenderList:key==='name'||key==='color'})));
$('pLightEnabled').addEventListener('change',()=>updateSelectedLight('enabled',$('pLightEnabled').checked,{rerenderList:true}));

function projectForExport(){
 ensureState();
 return {
  format:'planificateur-piece',
  version:5,
  appVersion:APP_VERSION,
  units:'cm',
  exportedAt:new Date().toISOString(),
  wallHeight:Number(state.wallHeight)||250,
  wallColor:state.wallColor||WALL_DEFAULT,
  lights:(state.lights||[]).map(l=>({...l,intensity:Math.max(0,Number(l.intensity)||0),x:Number(l.x)||0,planY:Number(l.planY)||0,height:Math.max(0,Number(l.height)||0)})),
  room:state.room.map(p=>({x:Number(p.x),y:Number(p.y)})),
  columns:state.columns.map(c=>({id:String(c.id),name:String(c.name||'Colonne'),points:(c.points||[]).map(p=>({x:Number(p.x),y:Number(p.y)})),height:Math.max(1,Number(c.height)||Number(state.wallHeight)||250),elevation:Math.max(0,Number(c.elevation)||0),color:c.color||state.wallColor||WALL_DEFAULT,colorLinked:c.colorLinked===true||!c.color,comment:String(c.comment||'')})),
  items:state.items.map(it=>({...it,color:it.color||colors[it.type]||colors.furniture,x:Number(it.x),y:Number(it.y),w:Number(it.w),d:Number(it.d),rot:Number(it.rot)||0,height:Math.max(1,Number(it.height)||({door:205,window:100,furniture:75,table:75,chair:85,appliance:85,column:250,note:2,shelf:180}[it.type]||75)),elevation:Math.max(0,Number.isFinite(Number(it.elevation)) ? Number(it.elevation) : (it.type==='window' && Number.isFinite(Number(it.sillHeight)) ? Number(it.sillHeight) : 0))}))
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
  return {...c,id,name:String(c.name||('Colonne '+(i+1))),points,height:Math.max(1,Number(c.height)||Number(data.wallHeight)||250),elevation:Math.max(0,Number.isFinite(Number(c.elevation))?Number(c.elevation):0),color:String(c.color||data.wallColor||WALL_DEFAULT),comment:String(c.comment||'')};
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
  return {...raw,id,type,name:String(raw.name||({door:'Porte',window:'Fenêtre',column:'Colonne',note:'Repère',appliance:'Électroménager',furniture:'Meuble',table:'Table',chair:'Chaise',shelf:'Étagère'}[type])),x:number('x',0),y:number('y',0),w:Math.max(1,number('w',80)),d:Math.max(1,number('d',8)),rot:number('rot',0),height,elevation,openPercent:Math.max(0,Math.min(100,number('openPercent',0))),swingDirection:raw.swingDirection==='out'?'out':'in',hingeSide:raw.hingeSide==='B'?'B':'A',color:String(raw.color||colors[type]||colors.furniture),comment:String(raw.comment||'')};
 });
 const allowedLightTypes=new Set(['spot','ambient','lamp']);
 const lights=(Array.isArray(data.lights)?data.lights:[]).map((l,i)=>{
  if(!l||typeof l!=='object')throw new Error('Source lumineuse '+(i+1)+' invalide.');
  const type=String(l.type||'lamp');if(!allowedLightTypes.has(type))throw new Error('Type de lumière inconnu : '+type);
  const number=(k,d)=>Number.isFinite(Number(l[k]))?Number(l[k]):d;
  let id=String(l.id||'l'+(i+1));while(usedIds.has(id))id+='-';usedIds.add(id);
  return {...l,id,type,name:String(l.name||({spot:'Spot',ambient:'Lumière ambiante',lamp:'Lampe'}[type])),color:String(l.color||'#dce8f5'),intensity:Math.max(0,Math.min(10,number('intensity',type==='ambient'?.5:3))),x:number('x',0),planY:number('planY',0),height:Math.max(0,number('height',200)),distance:Math.max(1,number('distance',700)),angle:Math.max(10,Math.min(120,number('angle',50))),enabled:l.enabled!==false};
 });
 const wallColor=String(data.wallColor||WALL_DEFAULT);
 return {room,columns,items,lights,wallHeight:Math.max(1,Number(data.wallHeight)||Number(data.settings?.wallHeight)||250),wallColor};
}
$('exportJsonBtn').onclick=()=>{
 const blob=new Blob([JSON.stringify(projectForExport(),null,2)+'\n'],{type:'application/json;charset=utf-8'});
 download(blob,'planificateur-plan.json');
 $('status').textContent='Plan exporté en JSON (géométrie, colonnes, objets et hauteur des murs).';
};
$('importJsonBtn').onclick=()=>{$('fileInput').click()};
$('fileInput').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;
 try{
  const data=JSON.parse(await f.text());
  const imported=validateProject(data);
  checkpoint();state=imported;
  const allIds=[...state.items,...state.columns,...(state.lights||[])].map(x=>Number((String(x.id||'').match(/\d+/g)||[]).join('')||0));
  nextId=Math.max(1,...allIds)+1;
  selected=null;selectedLightId=null;selectedVertex=null;drawing=[];setTool('select');showProps();showLightProps();render();fit();
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

function build3D({reuse=true,preserveView=false}={}){
 if(!window.THREE){$('status').textContent='Three.js n’a pas pu être chargé. Vérifie la connexion internet.';return}
 if(!Array.isArray(state.room)||state.room.length<3){$('status').textContent='Dessine une pièce fermée en 2D avant d’ouvrir la vue 3D.';return}
 const host=$('view3d');
 const wasActive=host.classList.contains('active');
 const hadScene=!!threeScene;
 const oldZoom=threeZoom;
 const oldYaw=threeYaw,oldPitch=threePitch,oldTarget=threeTarget?threeTarget.clone():null;
 host.classList.add('active');
 svg.style.visibility='hidden';
 if(threeFrame)cancelAnimationFrame(threeFrame);
 if(threeScene){
  threeScene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material]))m.dispose()}});
  threeScene.clear();
 }
 threeScene=new THREE.Scene();
 threeScene.background=new THREE.Color(0xeef1ee);
 const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
 if(!threeRenderer){
  threeCamera=new THREE.PerspectiveCamera(42,width/height,0.1,100000);
  threeRenderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  threeRenderer.setSize(width,height);
  threeRenderer.outputColorSpace=THREE.SRGBColorSpace;
  threeRenderer.toneMapping=THREE.ACESFilmicToneMapping;
  threeRenderer.toneMappingExposure=1.08;
  threeRenderer.shadowMap.enabled=true;
  threeRenderer.shadowMap.type=THREE.PCFSoftShadowMap;
  host.appendChild(threeRenderer.domElement);
  threeRenderer.domElement.addEventListener('pointerdown',handle3DPointerDown);
  threeRenderer.domElement.addEventListener('pointermove',handle3DPointerMove);
  threeRenderer.domElement.addEventListener('pointerup',handle3DPointerUp);
  threeRenderer.domElement.addEventListener('pointercancel',handle3DPointerUp);
  threeRenderer.domElement.addEventListener('wheel',handle3DWheel,{passive:false});
  threeRenderer.domElement.style.cursor='grab';
 }else{
  threeCamera.aspect=width/height;threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(width,height);
 }
 threeCamera.aspect=width/height;threeCamera.updateProjectionMatrix();
 threeTarget=new THREE.Vector3();
 threeItemGroups=new Map();threeColumnGroups=new Map();threeWallMeshes=[];threeSelectionHelper=null;
 const wallHeight=Number(state.wallHeight)||250;
 const roomXs=state.room.map(p=>p.x),roomYs=state.room.map(p=>p.y);
 const minX=Math.min(...roomXs),maxX=Math.max(...roomXs),minY=Math.min(...roomYs),maxY=Math.max(...roomYs);
 const span=Math.max(maxX-minX,maxY-minY,300);
 // Soft ambient fill, directional daylight and warm interior point lights.
 threeScene.add(new THREE.AmbientLight(0xffffff,.38));
 threeScene.add(new THREE.HemisphereLight(0xeaf3ff,0x8c806e,1.15));
 const daylight=new THREE.DirectionalLight(0xfff3df,2.2);
 daylight.position.set((minX+maxX)/2+span*.65,wallHeight+span*.9,(minY+maxY)/2+span*.55);daylight.target.position.set((minX+maxX)/2,0,(minY+maxY)/2);daylight.castShadow=true;
 daylight.shadow.mapSize.set(2048,2048);
 daylight.shadow.camera.left=-900;daylight.shadow.camera.right=900;daylight.shadow.camera.top=900;daylight.shadow.camera.bottom=-900;
 daylight.shadow.bias=-0.0003;daylight.shadow.radius=5;
 threeScene.add(daylight);threeScene.add(daylight.target);
 const lightPositions=[
  {x:(minX+maxX)/2,z:(minY+maxY)/2},
  {x:minX+(maxX-minX)*.28,z:minY+(maxY-minY)*.28},
  {x:minX+(maxX-minX)*.72,z:minY+(maxY-minY)*.72}
 ];

 lightPositions.forEach((pt,i)=>{const l=new THREE.PointLight(i===0?0xffe8c7:0xfff7e8,i===0?1.65:.8,span*2.8,2);l.position.set(pt.x,Math.max(60,wallHeight*.86),pt.z);l.castShadow=false;threeScene.add(l)});
 // User-defined lights are persisted in the plan and rebuilt with the scene.
 for(const src of (state.lights||[])){
  if(src.enabled===false)continue;
  const color=src.color||'#dce8f5',intensity=Math.max(0,Number(src.intensity)||0);
  if(src.type==='ambient'){
   threeScene.add(new THREE.AmbientLight(new THREE.Color(color),intensity));
   continue;
  }
  const lx=Number.isFinite(Number(src.x))?Number(src.x):((minX+maxX)/2),lz=Number.isFinite(Number(src.planY))?Number(src.planY):((minY+maxY)/2),ly=Math.max(0,Number.isFinite(Number(src.height))?Number(src.height):wallHeight*.8);
  let light;
  if(src.type==='spot'){
   light=new THREE.SpotLight(new THREE.Color(color),intensity,Math.max(1,Number(src.distance)||span*2.4),THREE.MathUtils.degToRad(Math.max(10,Math.min(120,Number(src.angle)||50))),.45,2);
   light.position.set(lx,ly,lz);light.target.position.set((minX+maxX)/2,0,(minY+maxY)/2);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0003;threeScene.add(light,light.target);
  }else{
   light=new THREE.PointLight(new THREE.Color(color),intensity,Math.max(1,Number(src.distance)||span*2.4),2);light.position.set(lx,ly,lz);light.castShadow=true;light.shadow.mapSize.set(512,512);threeScene.add(light);
  }
  const marker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(3,span*.008),12,8),new THREE.MeshBasicMaterial({color:new THREE.Color(color)}));marker.position.set(lx,ly,lz);marker.userData.lightId=src.id;marker.renderOrder=15;threeScene.add(marker);
 }

 const wallThickness=12;
 const makeShape=points=>{const sh=new THREE.Shape();sh.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)sh.lineTo(points[i].x,points[i].y);sh.closePath();return sh};
 const floorMat=new THREE.MeshStandardMaterial({color:0xf6f5f1,roughness:.93,metalness:0,side:THREE.DoubleSide});
 const floor=new THREE.Mesh(new THREE.ShapeGeometry(makeShape(state.room)),floorMat);
 floor.rotation.x=Math.PI/2;floor.position.y=.01;floor.receiveShadow=true;floor.userData.isFloor=true;threeScene.add(floor);
 // Interior columns are complete extruded solids. Keep an object ID for 3D selection/dragging.
 for(const col of (state.columns||[])){
  if(!Array.isArray(col.points)||col.points.length<3)continue;
  const h=Math.max(1,Number(col.height)||wallHeight),group=new THREE.Group();
  group.position.y=Math.max(0,Number(col.elevation)||0);group.userData.columnId=col.id;
  const geom=new THREE.ExtrudeGeometry(makeShape(col.points.map(p=>({x:p.x,y:-p.y}))),{depth:h,bevelEnabled:false,curveSegments:16});
  const mat=new THREE.MeshStandardMaterial({color:col.color||state.wallColor||WALL_DEFAULT,roughness:.86,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geom,mat);mesh.rotation.x=-Math.PI/2;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.columnId=col.id;group.add(mesh);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geom),new THREE.LineBasicMaterial({color:0x59645b}));edges.rotation.x=-Math.PI/2;edges.position.y=.01;edges.userData.columnId=col.id;group.add(edges);
  threeScene.add(group);threeColumnGroups.set(col.id,group);
 }
 const solidWallMat=new THREE.MeshStandardMaterial({color:state.wallColor||WALL_DEFAULT,roughness:.88,metalness:0,side:THREE.DoubleSide});
 const windowMatFor=(color)=>new THREE.MeshPhysicalMaterial({color:color||colors.window,roughness:.12,metalness:0,transmission:.45,transparent:true,opacity:.55,thickness:1.5,ior:1.45,side:THREE.DoubleSide,depthWrite:false});
 const wallMeshes=threeWallMeshes;
 let signedArea=0;for(let i=0;i<state.room.length;i++){const a=state.room[i],b=state.room[(i+1)%state.room.length];signedArea+=a.x*b.y-b.x*a.y}
 const winding=Math.sign(signedArea)||1;
 const openingByWall=state.room.map(()=>[]);
 for(const it of (state.items||[]).filter(x=>x.type==='door'||x.type==='window')){
  const cx=it.x+it.w/2,cy=it.y+it.d/2;let best=null;
  for(let i=0;i<state.room.length;i++){
   const a=state.room[i],b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;if(len2<1)continue;
   const tRaw=((cx-a.x)*dx+(cy-a.y)*dy)/len2,t=Math.max(0,Math.min(1,tRaw)),px=a.x+t*dx,py=a.y+t*dy,dist=Math.hypot(cx-px,cy-py),len=Math.sqrt(len2),preferred=Number.isInteger(it.wallIndex)&&it.wallIndex===i;
   const candidate={i,a,b,dx,dy,len,t,dist,s:t*len,preferred};if(!best||(preferred&&!best.preferred)||(preferred===best.preferred&&dist<best.dist))best=candidate;
  }
  if(!best||best.dist>Math.max(30,Math.min(it.w,it.d)/2+22))continue;
  const half=Math.max(1,Number(it.w)||80)/2,start=Math.max(0,best.s-half),end=Math.min(best.len,best.s+half);
  if(end-start<2)continue;
  openingByWall[best.i].push({start,end,type:it.type,item:it,center:best.s,bottom:Math.max(0,Number.isFinite(Number(it.elevation))?Number(it.elevation):(it.type==='window'&&Number.isFinite(Number(it.sillHeight))?Number(it.sillHeight):0)),height:Math.max(1,Number.isFinite(Number(it.height))?Number(it.height):(it.type==='window'&&Number.isFinite(Number(it.headHeight))?Number(it.headHeight)-(Number(it.sillHeight)||90):(it.type==='door'?205:100)))});
 }
 for(let i=0;i<state.room.length;i++){
  const a=state.room[i],b=state.room[(i+1)%state.room.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<1)continue;
  const angle=-Math.atan2(dy,dx),tx=dx/len,tz=dy/len;
  const outward=(winding>0)?{x:dy/len,z:-dx/len}:{x:-dy/len,z:dx/len};
  const makeWall=(from,to,bottom,top,tag='wall')=>{
   if(to-from<1||top-bottom<1)return;
   const mesh=new THREE.Mesh(new THREE.BoxGeometry(to-from,top-bottom,wallThickness),solidWallMat.clone()),mid=(from+to)/2;
   mesh.position.set(a.x+tx*mid,(bottom+top)/2,a.y+tz*mid);mesh.rotation.y=angle;mesh.castShadow=true;mesh.receiveShadow=true;
   mesh.userData={wall:true,tag,outwardX:outward.x,outwardZ:outward.z};
   const line=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:0x46534a,transparent:false,depthTest:false}));
   line.position.copy(mesh.position);line.rotation.copy(mesh.rotation);line.visible=false;line.renderOrder=10;
   threeScene.add(mesh,line);wallMeshes.push({mesh,line,outwardX:outward.x,outwardZ:outward.z});
  };
  const openings=openingByWall[i].sort((u,v)=>u.start-v.start),normalised=[];
  for(const op of openings){const last=normalised[normalised.length-1];if(last&&op.start<last.end){if(last.type===op.type){last.end=Math.max(last.end,op.end);continue}op.start=last.end}if(op.end-op.start>=2)normalised.push({...op})}
  let cursor=0;
  for(const op of normalised){
   makeWall(cursor,op.start,0,wallHeight,'wall');
   if(op.type==='window'){
    const sill=Math.max(0,Math.min(wallHeight-1,op.bottom)),head=Math.max(sill+1,Math.min(wallHeight,sill+op.height));
    makeWall(op.start,op.end,0,sill,'window-sill');makeWall(op.start,op.end,head,wallHeight,'window-header');
    const glassW=Math.max(1,op.end-op.start-3),glassH=Math.max(1,head-sill-3),mid=(op.start+op.end)/2;
    const glass=new THREE.Mesh(new THREE.BoxGeometry(glassW,glassH,2),windowMatFor(op.item.color||colors.window));glass.position.set(a.x+tx*mid,(sill+head)/2,a.y+tz*mid);glass.rotation.y=angle;glass.renderOrder=2;glass.userData={wall:true,tag:'window-glass',outwardX:outward.x,outwardZ:outward.z,itemId:op.item.id};
    const glassLine=new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry),new THREE.LineBasicMaterial({color:0x46534a,transparent:false,depthTest:false}));glassLine.position.copy(glass.position);glassLine.rotation.copy(glass.rotation);glassLine.visible=false;glassLine.renderOrder=11;glassLine.userData={itemId:op.item.id};
    threeScene.add(glass,glassLine);wallMeshes.push({mesh:glass,line:glassLine,outwardX:outward.x,outwardZ:outward.z});
   }else if(op.type==='door'){
    const bottom=Math.max(0,Math.min(wallHeight-1,op.bottom)),doorHeight=Math.max(1,Math.min(wallHeight-bottom,op.height)),top=bottom+doorHeight;
    makeWall(op.start,op.end,0,bottom,'door-lower-wall');makeWall(op.start,op.end,top,wallHeight,'door-upper-wall');
    const width=Math.max(1,op.end-op.start-3),hingeB=(op.item.hingeSide||'A')==='B',hingeAlong=hingeB?op.end:op.start;
    const pivot=new THREE.Group();pivot.position.set(a.x+tx*hingeAlong,bottom,a.y+tz*hingeAlong);pivot.rotation.y=angle;pivot.userData.itemId=op.item.id;pivot.userData.doorPivot=true;
    const doorMat=new THREE.MeshStandardMaterial({color:op.item.color||colors.door,roughness:.78,metalness:0,side:THREE.DoubleSide});
    const leaf=new THREE.Mesh(new THREE.BoxGeometry(width,doorHeight,2.5),doorMat);leaf.position.set(hingeB?-width/2:width/2,doorHeight/2,0);leaf.castShadow=true;leaf.receiveShadow=true;leaf.userData={itemId:op.item.id,tag:'door-leaf'};pivot.add(leaf);
    const leafLine=new THREE.LineSegments(new THREE.EdgesGeometry(leaf.geometry),new THREE.LineBasicMaterial({color:0x46534a,transparent:false,depthTest:false}));leafLine.position.copy(leaf.position);leafLine.visible=false;leafLine.renderOrder=11;leafLine.userData={itemId:op.item.id};pivot.add(leafLine);
    const percent=Math.max(0,Math.min(100,Number(op.item.openPercent)||0)),openAngle=percent*1.2*Math.PI/180;
    const sideCross=tx*outward.z-tz*outward.x;let sign=sideCross<0?-1:1;
    if((op.item.swingDirection||'in')==='out')sign*=-1;if(hingeB)sign*=-1;
    pivot.rotation.y=angle+sign*openAngle;
    threeScene.add(pivot);wallMeshes.push({mesh:leaf,line:leafLine,outwardX:outward.x,outwardZ:outward.z});
   }
   cursor=Math.max(cursor,op.end);
  }
  makeWall(cursor,len,0,wallHeight,'wall');
 }
 // Furniture meshes are grouped by element ID for selection and real-time 3D manipulation.
 for(const it of (state.items||[])){
  if(it.type==='door'||it.type==='window')continue;
  const h=it.type==='note'?Math.max(1,Number(it.height)||2):Math.max(1,Number(it.height)||Math.max(35,Math.min(100,it.d)));
  const baseY=Math.max(0,Number(it.elevation)||0),group=new THREE.Group();
  group.position.set(it.x+it.w/2,baseY,it.y+it.d/2);group.rotation.y=-(Number(it.rot)||0)*Math.PI/180;group.userData.itemId=it.id;
  const material=(color)=>new THREE.MeshStandardMaterial({color,roughness:.78,metalness:0});
  const addBox=(w,hh,d,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(Math.max(1,w),Math.max(1,hh),Math.max(1,d)),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;m.userData.itemId=it.id;group.add(m);return m};
  if(it.type==='table'){
   const top=material(it.color||colors.table),legs=material(0x806343),leg=Math.max(4,Math.min(8,Math.min(it.w,it.d)*.075)),topT=Math.min(5,Math.max(3,h*.06)),inX=Math.max(0,it.w/2-leg/2-Math.max(4,it.w*.10)),inZ=Math.max(0,it.d/2-leg/2-Math.max(4,it.d*.10));
   addBox(it.w,topT,it.d,0,h-topT/2,0,top);[[-inX,-inZ],[inX,-inZ],[-inX,inZ],[inX,inZ]].forEach(([x,z])=>addBox(leg,Math.max(1,h-topT),leg,x,(h-topT)/2,z,legs));
  }else if(it.type==='chair'){
   const seatTop=Math.min(h-8,Math.max(40,Math.min(46,h*.54))),leg=Math.max(3,Math.min(6,Math.min(it.w,it.d)*.12)),seatT=4,inX=Math.max(0,it.w/2-leg/2-Math.max(3,it.w*.12)),inZ=Math.max(0,it.d/2-leg/2-Math.max(3,it.d*.12));
   const wood=material(it.color||colors.chair),dark=material(0x806b54);addBox(Math.max(1,it.w-5),seatT,Math.max(1,it.d-5),0,seatTop,0,wood);
   [[-inX,-inZ],[inX,-inZ],[-inX,inZ],[inX,inZ]].forEach(([x,z])=>addBox(leg,Math.max(1,seatTop-seatT),leg,x,(seatTop-seatT)/2,z,dark));
   const backH=Math.max(4,h-seatTop-2);addBox(Math.max(1,it.w-7),backH,4,0,seatTop+backH/2,-Math.max(0,it.d/2-2),wood);
  }else if(it.type==='shelf'){
   const wood=material(it.color||colors.shelf),sideT=Math.max(2,Math.min(4,it.w*.04)),boardT=Math.max(2,Math.min(4,h*.018)),backT=Math.max(1.5,Math.min(3,it.d*.08));
   addBox(sideT,h,it.d,-it.w/2+sideT/2,h/2,0,wood);addBox(sideT,h,it.d,it.w/2-sideT/2,h/2,0,wood);addBox(it.w-2*sideT,h,it.d*.08,0,h/2,-it.d/2+it.d*.04,material(it.color||colors.shelf));
   const levels=Math.max(2,Math.min(12,Math.floor(h/32)+1));for(let i=0;i<levels;i++){const y=boardT/2+(Math.max(0,h-boardT)*(i/(levels-1)));addBox(Math.max(1,it.w-2*sideT),boardT,Math.max(1,it.d-backT),0,Math.min(h-boardT/2,y),backT/2,wood)}
  }else{
   const mat=material(parseInt((it.color||colors[it.type]||colors.furniture).replace('#',''),16));let geom;
   if(it.type==='column'&&(it.shape||'round')==='round')geom=new THREE.CylinderGeometry(Math.min(it.w,it.d)*.48,Math.min(it.w,it.d)*.48,h,24);else geom=new THREE.BoxGeometry(Math.max(1,it.w),h,Math.max(1,it.d));
   const mesh=new THREE.Mesh(geom,mat);mesh.position.y=h/2;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.itemId=it.id;group.add(mesh);
  }
  threeScene.add(group);threeItemGroups.set(it.id,group);
 }
 // Compute bounds from the actual plan and all vertical geometry, then frame the whole room.
 const bounds=new THREE.Box3();
 for(const p of state.room){bounds.expandByPoint(new THREE.Vector3(p.x,0,p.y));bounds.expandByPoint(new THREE.Vector3(p.x,wallHeight,p.y))}
 for(const col of (state.columns||[]))for(const p of (col.points||[])){const base=Math.max(0,Number(col.elevation)||0);bounds.expandByPoint(new THREE.Vector3(p.x,base,p.y));bounds.expandByPoint(new THREE.Vector3(p.x,base+(Number(col.height)||wallHeight),p.y))}
 for(const it of (state.items||[])){const h=Math.max(1,Number(it.height)||({door:205,window:100,furniture:75,table:75,chair:85,shelf:180,appliance:85,column:250,note:2}[it.type]||75)),e=Math.max(0,Number(it.elevation)||0),r=Math.hypot(Number(it.w)||0,Number(it.d)||0)/2;bounds.expandByPoint(new THREE.Vector3(it.x+it.w/2-r,e,it.y+it.d/2-r));bounds.expandByPoint(new THREE.Vector3(it.x+it.w/2+r,e+h,it.y+it.d/2+r))}
 if(bounds.isEmpty())bounds.set(new THREE.Vector3(0,0,0),new THREE.Vector3(500,wallHeight,400));
 const sphere=bounds.getBoundingSphere(new THREE.Sphere()),fovV=THREE.MathUtils.degToRad(threeCamera.fov),fovH=2*Math.atan(Math.tan(fovV/2)*threeCamera.aspect),limitingFov=Math.max(.05,Math.min(fovV,fovH));
 const fitDistance=Math.max(85,sphere.radius/Math.sin(limitingFov/2)*0.86);threeFitDistance=fitDistance;
 threeCamera.far=Math.max(10000,fitDistance*10);threeCamera.updateProjectionMatrix();
 threeTarget.set((bounds.min.x+bounds.max.x)/2,Math.max(0,Math.min(wallHeight,(bounds.min.y+bounds.max.y)*.42)),(bounds.min.z+bounds.max.z)/2);
 if(preserveView&&hadScene){if(oldTarget)threeTarget.copy(oldTarget);threeYaw=oldYaw;threePitch=oldPitch;threeZoom=Math.max(fitDistance*.2,Math.min(fitDistance*4,oldZoom))}
 else{threeYaw=.72;threePitch=.62;threeZoom=fitDistance}
 function cameraUpdate(){
  const radius=threeZoom,cp=Math.cos(threePitch);threeCamera.position.set(threeTarget.x+Math.cos(threeYaw)*radius*cp,threeTarget.y+Math.sin(threePitch)*radius,threeTarget.z+Math.sin(threeYaw)*radius*cp);threeCamera.lookAt(threeTarget);threeCamera.updateMatrixWorld();
  for(const entry of wallMeshes){const m=entry.mesh,u=m.userData||{};const wp=new THREE.Vector3();m.getWorldPosition(wp);const vx=threeCamera.position.x-wp.x,vz=threeCamera.position.z-wp.z,nx=Number.isFinite(u.outwardX)?u.outwardX:(entry.outwardX||0),nz=Number.isFinite(u.outwardZ)?u.outwardZ:(entry.outwardZ||0),facingOutside=vx*nx+vz*nz>0;m.visible=!facingOutside;entry.line.visible=facingOutside}
 }
 threeUpdateCamera=cameraUpdate;cameraUpdate();
 if(selected){const root=threeItemGroups.get(selected)||threeColumnGroups.get(selected);if(root){threeSelectionHelper=new THREE.BoxHelper(root,0x2d7450);threeSelectionHelper.material.depthTest=false;threeSelectionHelper.renderOrder=30;threeScene.add(threeSelectionHelper)}}
 const animate=()=>{threeFrame=requestAnimationFrame(animate);if(threeSelectionHelper)threeSelectionHelper.update();threeRenderer.render(threeScene,threeCamera)};animate();
 if(!wasActive)$('status').textContent='Vue 3D : clique-glisse un objet pour le déplacer, fais glisser le fond pour tourner la caméra.';
}
function rayFor3DPointer(e){
 if(!threeRenderer||!threeCamera||!threeScene)return null;
 const rect=threeRenderer.domElement.getBoundingClientRect();if(!activeRaycaster)activeRaycaster=new THREE.Raycaster();if(!threeMouse)threeMouse=new THREE.Vector2();
 threeMouse.x=((e.clientX-rect.left)/Math.max(1,rect.width))*2-1;threeMouse.y=-((e.clientY-rect.top)/Math.max(1,rect.height))*2+1;activeRaycaster.setFromCamera(threeMouse,threeCamera);return activeRaycaster;
}
function find3DEditableHit(e){
 const ray=rayFor3DPointer(e);if(!ray)return null;
 const hits=ray.intersectObjects(threeScene.children,true);
 for(const hit of hits){let node=hit.object;while(node&&node!==threeScene){if(node.userData?.itemId)return {id:String(node.userData.itemId),kind:'item',point:hit.point.clone()};if(node.userData?.columnId)return {id:String(node.userData.columnId),kind:'column',point:hit.point.clone()};node=node.parent}}
 return null;
}
function getPlanePoint(e,interaction){
 const ray=rayFor3DPointer(e);if(!ray)return null;
 const point=new THREE.Vector3();return ray.ray.intersectPlane(interaction.plane,point)?point:null;
}
function handle3DPointerDown(e){
 if(e.button!==0||!threeRenderer||!threeScene)return;
 const hit=find3DEditableHit(e);
 if(hit){
  selected=hit.id;selectedVertex=null;setTool('select');showProps();
  const item=state.items.find(x=>x.id===selected),col=state.columns.find(x=>x.id===selected);
  const planeY=hit.point.y,plane=new THREE.Plane(new THREE.Vector3(0,1,0),-planeY);
  const ray=rayFor3DPointer(e),start=new THREE.Vector3();if(ray)ray.ray.intersectPlane(plane,start);else start.copy(hit.point);
  threeInteraction={mode:'move',id:selected,kind:item?'item':'column',startClientX:e.clientX,startClientY:e.clientY,startWorld:{x:start.x,z:start.z},plane,initialX:item?.x,initialY:item?.y,initialPoints:col?col.points.map(p=>({...p})):null,moved:false,pointerId:e.pointerId,startYaw:threeYaw,startPitch:threePitch};
  try{threeRenderer.domElement.setPointerCapture(e.pointerId)}catch{}
  threeRenderer.domElement.style.cursor='grabbing';build3D({reuse:true,preserveView:true});return;
 }
 threeInteraction={mode:'orbit',startClientX:e.clientX,startClientY:e.clientY,startYaw:threeYaw,startPitch:threePitch,pointerId:e.pointerId,moved:false};
 try{threeRenderer.domElement.setPointerCapture(e.pointerId)}catch{}
 threeRenderer.domElement.style.cursor='grabbing';
}
function handle3DPointerMove(e){
 if(!threeInteraction)return;
 const itx=threeInteraction;
 if(itx.mode==='orbit'){
  if(Math.hypot(e.clientX-itx.startClientX,e.clientY-itx.startClientY)>2)itx.moved=true;
  threeYaw=itx.startYaw-(e.clientX-itx.startClientX)*.008;threePitch=Math.max(.12,Math.min(1.35,itx.startPitch+(e.clientY-itx.startClientY)*.006));
  threeUpdateCamera?.();return;
 }
 if(itx.mode!=='move')return;
 const planePoint=getPlanePoint(e,itx);if(!planePoint)return;
 const dx=planePoint.x-itx.startWorld.x,dy=planePoint.z-itx.startWorld.z;
 if(Math.hypot(e.clientX-itx.startClientX,e.clientY-itx.startClientY)<3)return;
 if(!itx.moved){checkpoint();itx.moved=true}
 if(itx.kind==='item'){
  const it=state.items.find(x=>x.id===itx.id);if(!it)return;
  const q=snapPoint({x:itx.initialX+dx,y:itx.initialY+dy},it.id);it.x=q.x;it.y=q.y;
  if(it.type==='door'||it.type==='window')snapToWall(it);
  $('pX').value=Math.round(it.x);$('pY').value=Math.round(it.y);$('pRot').value=Math.round(it.rot||0);
 }else{
  const col=state.columns.find(c=>c.id===itx.id);if(!col)return;
  const sx=Math.round(dx/5)*5,sy=Math.round(dy/5)*5;col.points=itx.initialPoints.map(p=>({x:p.x+sx,y:p.y+sy}));
 }
 suppress3DAutoRefresh=true;render();suppress3DAutoRefresh=false;
 showProps();
 build3D({reuse:true,preserveView:true});
}
function handle3DPointerUp(e){
 if(!threeInteraction)return;
 const didMove=threeInteraction.moved;threeInteraction=null;if(threeRenderer)threeRenderer.domElement.style.cursor='grab';
 if(didMove){showProps();render()}
 try{if(threeRenderer?.domElement.hasPointerCapture(e.pointerId))threeRenderer.domElement.releasePointerCapture(e.pointerId)}catch{}
}
function handle3DWheel(e){
 if(!threeRenderer||!threeScene)return;e.preventDefault();threeZoom=Math.max(threeFitDistance*.25,Math.min(threeFitDistance*4,threeZoom*Math.exp(e.deltaY*.001)));threeUpdateCamera?.();
}
function close3D(){if(threeFrame)cancelAnimationFrame(threeFrame);$('view3d').classList.remove('active');svg.style.visibility='visible'}
$('view3dBtn').onclick=build3D;$('exit3d').onclick=close3D;window.addEventListener('resize',()=>{if(threeRenderer&&$('view3d').classList.contains('active')){threeCamera.aspect=Math.max(1,$('view3d').clientWidth)/Math.max(1,$('view3d').clientHeight);threeCamera.updateProjectionMatrix();threeRenderer.setSize($('view3d').clientWidth,$('view3d').clientHeight)}});
initPalette();$('appVersion').textContent='v'+APP_VERSION;render();showProps();showLightProps();
