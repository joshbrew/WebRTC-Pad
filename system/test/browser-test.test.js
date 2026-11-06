import test from 'node:test';
import assert from 'node:assert/strict';
import {launchTestBrowser,testBrowserOptions} from '../scripts/browser-fixture.mjs';

test('test browser opts out of Windows tab registration and preserves existing flags',()=>{
  const options={channel:'msedge',headless:true,args:['--disable-features=CalculateNativeWinOcclusion','--autoplay-policy=no-user-gesture-required']};
  const result=testBrowserOptions(options);
  assert.deepEqual(result.args,['--autoplay-policy=no-user-gesture-required','--disable-features=msWindowTabManagerPublic,CalculateNativeWinOcclusion']);
  assert.equal(result.channel,'msedge');assert.equal(result.headless,true);
  assert.deepEqual(options.args,['--disable-features=CalculateNativeWinOcclusion','--autoplay-policy=no-user-gesture-required']);
});

test('test browser closes contexts before its process, even if a context fails, once',async()=>{
  const events=[];let launchOptions;
  const browser={contexts:()=>[{async close(){events.push('context');}},{async close(){events.push('failing context');throw Error('already closed');}}],async close(){events.push('browser');}};
  const wrapped=await launchTestBrowser({async launch(options){launchOptions=options;return browser;}},{headless:true});
  assert.match(launchOptions.args[0],/msWindowTabManagerPublic/);
  await Promise.all([wrapped.close(),wrapped.close()]);await wrapped.close();
  assert.deepEqual(events,['context','failing context','browser']);
});
test('Firefox automation keeps its own options without Chromium feature flags',async()=>{
  let actual;const options={headless:true},browser={contexts:()=>[],async close(){}};
  const wrapped=await launchTestBrowser({name:()=>'firefox',async launch(value){actual=value;return browser;}},options);assert.equal(actual,options);await wrapped.close();
});
