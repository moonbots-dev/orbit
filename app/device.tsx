'use client';
import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
export type Mode='ready'|'listening'|'working'|'done'|'muted';
export default function Device({accent,shell,mode,onTalk,onMute,view='angle',memory=false,displayCanvas,diameterMm=48,depthMm=12,onScreenDoubleTap,onScreenSwipe}:{accent:string;shell:string;mode:Mode;onTalk:()=>void;onMute:()=>void;view?:string;memory?:boolean;displayCanvas?:HTMLCanvasElement|null;diameterMm?:number;depthMm?:number;onScreenDoubleTap?:()=>void;onScreenSwipe?:()=>void}){
 const host=useRef<HTMLDivElement>(null);const current=useRef({mode,onTalk,onMute,view,memory,onScreenDoubleTap,onScreenSwipe});current.current={mode,onTalk,onMute,view,memory,onScreenDoubleTap,onScreenSwipe};const [failed,setFailed]=useState(false);
 useEffect(()=>{if(!host.current)return;const el=host.current;let renderer:T.WebGLRenderer;try{renderer=new T.WebGLRenderer({antialias:true,alpha:true});}catch{setFailed(true);return;}
 renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));el.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(33,1,.1,100);camera.position.set(0,0,8.5);
 const group=new T.Group();scene.add(group);const geometries:T.BufferGeometry[]=[],materials:T.Material[]=[];
 function toon(hex:string){const m=new T.ShaderMaterial({uniforms:{color:{value:new T.Color(hex).convertLinearToSRGB()}},vertexShader:'varying vec3 n; void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 color; varying vec3 n; void main(){float l=dot(normalize(n),normalize(vec3(-0.5,0.8,1.0)));float s=l>0.65?1.0:l>0.05?0.78:0.49;gl_FragColor=vec4(color*s,1.0);}',toneMapped:false});materials.push(m);return m;}
 const ink=new T.MeshBasicMaterial({color:'#252733'});materials.push(ink);const shellmat=toon(shell),accentmat=toon(accent),orange=toon('#f28a48');
 function add(g:T.BufferGeometry,m:T.Material,x=0,y=0,z=0,outline=true){geometries.push(g);const a=new T.Mesh(g,m);a.position.set(x,y,z);group.add(a);if(outline){const eg=new T.EdgesGeometry(g,28);geometries.push(eg);const lm=new T.LineBasicMaterial({color:'#252733'});materials.push(lm);a.add(new T.LineSegments(eg,lm));}return a;}
 // Constant-radius cylinder with a 0.7 mm edge break. 48 mm diameter x 12 mm depth study.
 const r=diameterMm/48*1.7,d=depthMm/48*3.4,b=.05;
 const sr=displayCanvas?32.4/48*1.7:1.445;
 const profile=[new T.Vector2(0,-d/2),new T.Vector2(r-b,-d/2),new T.Vector2(r,-d/2+b),new T.Vector2(r,d/2-b),new T.Vector2(r-b,d/2),new T.Vector2(0,d/2)];
 const body=add(new T.LatheGeometry(profile,96),shellmat);body.rotation.x=Math.PI/2;
 function ring(rad:number,z:number,tube=.018){return add(new T.TorusGeometry(rad,tube,6,100),ink,0,0,z,false);}
 ring(r-b,d/2);ring(r,-d/2+b);ring(r,0,.012);ring(sr+.015,d/2+.012,.025);
 const screen=add(new T.CircleGeometry(sr,96),ink,0,0,d/2+.02,false);
 const cv=displayCanvas||document.createElement('canvas');if(!displayCanvas)cv.width=cv.height=512;const ctx=cv.getContext('2d')!;const texture=new T.CanvasTexture(cv);texture.colorSpace=T.SRGBColorSpace;const sm=new T.MeshBasicMaterial({map:texture});materials.push(sm);add(new T.CircleGeometry(sr-.02,96),sm,0,0,d/2+.025,false);
 const button=add(new T.CylinderGeometry(.15,.15,.12,32),accentmat,r-.05,.32,0);button.rotation.z=-Math.PI/2;
 const slot=add(new T.BoxGeometry(.035,.46,.16),ink,r-.01,-.34,0);const toggle=add(new T.BoxGeometry(.1,.19,.14),orange,r+.035,-.23,0);
 const port=add(new T.BoxGeometry(.38,.04,.135),ink,0,-r+.005,0);add(new T.BoxGeometry(.24,.043,.033),shellmat,0,-r-.016,0,false);
 for(let i=0;i<3;i++)add(new T.SphereGeometry(.023,8,6),ink,-.35+i*.07,-r+.03,.09,false);
 const ray=new T.Raycaster(),pointer=new T.Vector2();let drag=false,moved=false,startX=0,startY=0,originX=0,originY=0,screenDrag=false,rx=0,ry=0,last=0,frame=0;let tapTimer:ReturnType<typeof setTimeout>|null=null;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 function down(e:PointerEvent){drag=true;moved=false;startX=originX=e.clientX;startY=originY=e.clientY;const rect=el.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);screenDrag=!!displayCanvas&&!!ray.intersectObject(screen)[0];el.setPointerCapture(e.pointerId);}
 function move(e:PointerEvent){if(!drag)return;const dx=e.clientX-startX,dy=e.clientY-startY;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;if(!screenDrag){ry+=dx*.006;rx+=dy*.006;}startX=e.clientX;startY=e.clientY;}
 function up(e:PointerEvent){if(!drag)return;drag=false;if(moved){if(screenDrag&&Math.hypot(e.clientX-originX,e.clientY-originY)>30)current.current.onScreenSwipe?.();return;}const rect=el.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects([button,toggle,slot,screen],false)[0];if(hit){if(hit.object===toggle||hit.object===slot)current.current.onMute();else if(hit.object===screen&&current.current.onScreenDoubleTap){if(tapTimer){clearTimeout(tapTimer);tapTimer=null;current.current.onScreenDoubleTap();}else tapTimer=setTimeout(()=>{tapTimer=null;current.current.onTalk();},250);}else current.current.onTalk();}}
 el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);const cancel=()=>{drag=false};el.addEventListener('pointercancel',cancel);
 let needsResize=true,lastWidth=0,lastHeight=0;
 // ResizeObserver only invalidates. Buffer writes happen on the render frame,
 // without changing CSS dimensions or feeding back into the observed layout.
 const resize=new ResizeObserver(()=>{needsResize=true;});resize.observe(el);
 function draw(t:number){frame=requestAnimationFrame(draw);
 if(needsResize){needsResize=false;const w=el.clientWidth,h=el.clientHeight;if(w>0&&h>0&&(w!==lastWidth||h!==lastHeight)){lastWidth=w;lastHeight=h;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}}
 const state=current.current.mode;const front=current.current.view==='front',side=current.current.view==='side';const targetY=(front?0:side?Math.PI/2:-.46)+ry;group.rotation.y+=(targetY-group.rotation.y)*.12;group.rotation.x+=((front?0:-.15)+rx-group.rotation.x)*.12;group.rotation.z=front||side?0:-.13;group.position.y=reduced?0:Math.sin(t*.0008)*.035;toggle.position.y=state==='muted'?-.45:-.23;
 if(displayCanvas){texture.needsUpdate=true;}else if(t-last>65){last=t;ctx.fillStyle='#252733';ctx.fillRect(0,0,512,512);ctx.fillStyle=state==='muted'?'#f28a48':accent;const blink=!reduced&&t%5300>5130;const eyeH=blink?5:state==='listening'?62:44;const offset=state==='working'?Math.sin(t*.003)*12:0;for(const x of [210,302]){ctx.beginPath();ctx.roundRect(x-14+offset,200-eyeH/2,28,eyeH,14);ctx.fill();}ctx.textAlign='center';ctx.font='500 24px sans-serif';ctx.fillText({ready:'Here when you need me.',listening:'Listening…',working:'On it.',done:current.current.memory?'Saved.':'Your brief is ready.',muted:current.current.memory?'Paused.':'Mic is off.'}[state],256,302);ctx.font='16px monospace';ctx.globalAlpha=.65;ctx.fillText(state==='muted'?(current.current.memory?'CAPTURE PAUSED':'PRIVATE BY TOUCH'):'O R B I T',256,349);ctx.globalAlpha=1;if(state==='listening'){for(let i=0;i<15;i++){const h=12+(Math.sin(t*.008+i)*.5+.5)*30;ctx.fillRect(180+i*10,380-h/2,4,h)}}texture.needsUpdate=true;}renderer.render(scene,camera);}
 frame=requestAnimationFrame(draw);return()=>{cancelAnimationFrame(frame);if(tapTimer)clearTimeout(tapTimer);resize.disconnect();el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',cancel);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());texture.dispose();renderer.dispose();renderer.domElement.remove();};
 },[accent,shell,displayCanvas,diameterMm,depthMm]);
 return <div ref={host} className="device-canvas" role="img" aria-label={`Interactive circular device, ${mode}. Drag to rotate. Use controls below to try its behavior.`}>{failed&&<p className="webgl-error">The 3D view needs WebGL. You can still try the demo controls below.</p>}</div>
}
