import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console});context.window=context;
vm.runInContext(readFileSync(new URL('../web/views.js',import.meta.url),'utf8'),context);
test('UIGF name identifies content and local export time without software version or account data',()=>{
  const date=new Date(2026,9,7,9,5,30);
  assert.equal(context.gachaViews.exportFileName(date),'UIGF-20261007-090530.json');
  assert.doesNotMatch(context.gachaViews.exportFileName(date),/[\\/:*?"<>|]/);
});
