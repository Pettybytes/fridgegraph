import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMuseVisionPinExtractor} from './pinVision';
import {createSamSegmenter} from './pinSegment';

const provider = {id:'meta',baseUrl:'https://provider.invalid',apiKey:'fixture',model:'fixture'} as Parameters<typeof createMuseVisionPinExtractor>[0]['provider'];
const image = {bytes:new Uint8Array([1]),mimeType:'image/png'};
let deadlineSeen=false;
let abortSeen=false;
const stalledFetch: typeof fetch = async (_url,init) => new Promise((_resolve,reject) => {
  const signal = init?.signal;
  if(!signal){reject(Error('MISSING_DEADLINE'));return}
  deadlineSeen=true;
  const keepAlive=setTimeout(()=>reject(Error('DEADLINE_NOT_ENFORCED')),100);
  signal.addEventListener('abort', () => {abortSeen=true;clearTimeout(keepAlive);reject(signal.reason)}, {once:true});
});
test('document extraction aborts a stalled provider request', async () => {
 deadlineSeen=false;abortSeen=false;
 const extract=createMuseVisionPinExtractor({provider,fetchFn:stalledFetch,timeoutMs:10});
 await assert.rejects(extract({image,assetId:'asset',childId:'child',caption:null,today:'2026-11-03'}),{name:'TimeoutError'});
 assert.equal(deadlineSeen,true);
 assert.equal(abortSeen,true);
});
test('segmentation aborts a stalled provider and keeps the uncropped image', async () => {
 deadlineSeen=false;abortSeen=false;
 const segment=createSamSegmenter({provider,fetchFn:stalledFetch,timeoutMs:10});
 assert.deepEqual(await segment({image,concept:'paper',isDocument:true}),{applied:false,source:'SAM_3_1',reason:'sam unavailable'});
 assert.equal(deadlineSeen,true);
 assert.equal(abortSeen,true);
});
