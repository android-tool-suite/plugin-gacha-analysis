import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

test('direct tab jumps mount only endpoints and preserve animation, state and adjacent navigation',async()=>{
  const frames=new Map(),rendered=[],selected=[];let sequence=0,now=0;
  const raf=fn=>{frames.set(++sequence,fn);return sequence;};
  function frame(time){now=time;const batch=[...frames];frames.clear();for(const[,fn]of batch)fn(now);}
  class Element{
    constructor(){this.children=[];this.dataset={};this.style={};this.attrs={};this.scrollLeft=0;this.scrollTop=0;this.offsetWidth=100;this.offsetLeft=0;this.listeners={};this.classList={add(){},remove(){},toggle(){}};}
    appendChild(child){child.parent=this;this.children.push(child);return child;}
    replaceChildren(...children){this.children=[];children.forEach(c=>this.appendChild(c));}
    setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){this.listeners[name]=fn;}
    closest(){return main;}
    getBoundingClientRect(){return{width:400};}
    querySelectorAll(selector){return selector==='button'?this.children.filter(c=>c.button):[];}
    querySelector(selector){return selector==='.tab-pager-indicator'?this.children.find(c=>c.className==='tab-pager-indicator'):null;}
    scrollIntoView(){}focus(){}
  }
  const main=new Element(),host=new Element(),tabs=new Element();
  for(let i=0;i<4;i++){const b=new Element();b.button=true;b.offsetLeft=i*100;tabs.appendChild(b);}
  const storageCalls=[];
  const win={addEventListener(){},ats:{call:async(method)=>{storageCalls.push(method);return {found:true,value:{version:1,page:'D',positions:[100,200,300,400]}};}}};
  const context=vm.createContext({window:win,document:{documentElement:new Element(),body:new Element(),createElement:()=>new Element(),querySelector:()=>null},requestAnimationFrame:raf,cancelAnimationFrame:id=>frames.delete(id),performance:{now:()=>now},matchMedia:()=>({matches:false}),innerHeight:800,setTimeout:()=>1,clearTimeout(){},getComputedStyle:()=>({overflowX:'hidden'}),console});
  vm.runInContext(readFileSync(new URL('../web/tab-pager.js',import.meta.url),'utf8'),context);
  const pager=win.createTabPager({host,tabs,pages:['A','B','C','D'],initialPage:'A',preloadNeighbors:false,isBusy:()=>false,renderPage:page=>rendered.push(page),onSelect:page=>selected.push(page)});
  frame(0);await pager.initialize();pager.refresh();frame(1);rendered.length=0;
  assert.equal(host.dataset.activePage,'A','legacy saved navigation must not override the default page');
  pager.goTo('D');assert.deepEqual(rendered,['D']);assert.equal(host.dataset.moving,'true');
  const track=host.children[0];assert.equal(track.children[3].style.transform,'translateX(-800px)');
  frame(401);assert.equal(host.dataset.activePage,'D');assert.equal(track.scrollLeft,1200);assert.equal(track.children[3].style.transform,'');
  rendered.length=0;pager.goTo('A');assert.deepEqual(rendered,['A']);frame(801);assert.equal(host.dataset.activePage,'A');
  rendered.length=0;pager.goTo('B');assert.deepEqual(rendered,['B']);frame(1201);assert.equal(host.dataset.activePage,'B');
  assert.deepEqual(selected,['D','A','B']);
  // A second click mid-jump must remove endpoint transforms and settle at the last selection.
  pager.goTo('D');frame(1240);pager.goTo('C');frame(1700);
  assert.equal(host.dataset.activePage,'C');assert.ok(track.children.every(p=>!p.style.transform&&!p.style.visibility));
  track.children[2].scrollTop=180;track.children[2].listeners.scroll();
  pager.initialize();pager.refresh();
  assert.equal(host.dataset.activePage,'C','refresh of a live page must retain its tab');
  assert.equal(track.children[2].scrollTop,180,'live page retains scroll position');
  const freshHost=new Element();
  const fresh=win.createTabPager({host:freshHost,tabs,pages:['A','B','C','D'],initialPage:'A',preloadNeighbors:false,isBusy:()=>false,renderPage(){},onSelect(){}});
  fresh.initialize();fresh.refresh();
  assert.equal(freshHost.dataset.activePage,'A','new page starts at its default tab');
  assert.ok(freshHost.children[0].children.every(p=>p.scrollTop===0),'new page starts at the top');
  assert.deepEqual(storageCalls,[],'navigation must neither read nor write persistent storage');
});
