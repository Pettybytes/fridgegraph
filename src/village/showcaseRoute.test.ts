import test from 'node:test';
import assert from 'node:assert/strict';
import {showcaseRoute} from './showcaseRoute';
test('fictional route distance follows its displayed grid and mode changes time only',()=>{
 const from={lng:-83.1,lat:42.33},to={lng:-83.05,lat:42.36};
 const drive=showcaseRoute('driving-car',from,to),walk=showcaseRoute('foot-walking',from,to),bike=showcaseRoute('cycling-regular',from,to);
 assert.equal(drive.source,'fictional-showcase');assert.match(drive.disclaimer,/Fictional/);
 assert.equal(drive.geometry.coordinates.length,3);assert.ok(drive.distanceMeters>6000);
 assert.equal(walk.distanceMeters,drive.distanceMeters);assert.ok(walk.durationSeconds>bike.durationSeconds&&bike.durationSeconds>drive.durationSeconds);
 assert.equal(showcaseRoute('driving-car',from,from).distanceMeters,0);
 assert.ok(!('amountUsd' in drive));
});
