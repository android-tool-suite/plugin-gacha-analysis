import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

test('quick reads never paint progress, slow reads do, and repeated renders do not postpone it',()=>{
  let now=0,id=0;const timers=new Map(),paints=[];
  const context=vm.createContext({
    setTimeout(fn,delay){timers.set(++id,{fn,time:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},
  });context.window=context;
  vm.runInContext(readFileSync(new URL('../web/loading-feedback.js',import.meta.url),'utf8'),context);
  const element={hidden:true,style:{set visibility(value){paints.push(value);}}};
  const show=context.createLoadingFeedback(element);
  const advance=ms=>{now+=ms;for(const[id,t]of timers)if(t.time<=now){timers.delete(id);t.fn();}};
  show(true);advance(100);show(false);advance(200);
  assert.equal(paints.includes('visible'),false);
  assert.equal(element.hidden,false,'the progress slot must not move the content');
  show(true);advance(150);show(true);advance(50);
  assert.equal(paints.at(-1),'visible');
  show(false);assert.equal(paints.at(-1),'hidden');
  show(true);advance(50);show(false);show(true);advance(150);
  assert.equal(paints.at(-1),'hidden','a cancelled read cannot expose the next read early');
  advance(50);assert.equal(paints.at(-1),'visible');
  show(false);assert.equal(timers.size,0);
});
