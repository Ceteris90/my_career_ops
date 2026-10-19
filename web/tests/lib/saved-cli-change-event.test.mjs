import {test} from 'node:test';
import assert from 'node:assert/strict';
import {persistCliId,readSavedCliId,CLI_CONFIG_CHANGED} from '../../src/lib/saved-cli.ts';

test('selecting a CLI notifies the same tab and keeps unrelated settings', () => {
  const originalWindow=globalThis.window;
  const originalStorage=globalThis.localStorage;
  const store=new Map([['career-ops:config',JSON.stringify({cliId:'codex',logos:false})]]);
  const notified=[];
  globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
  globalThis.window={dispatchEvent:event=>notified.push({type:event.type,selected:readSavedCliId()})};
  try {
    persistCliId('antigravity');
    assert.deepEqual(notified,[{type:CLI_CONFIG_CHANGED,selected:'antigravity'}]);
    assert.equal(JSON.parse(store.get('career-ops:config')).logos,false);
  } finally {
    if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;
    if(originalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalStorage;
  }
});
