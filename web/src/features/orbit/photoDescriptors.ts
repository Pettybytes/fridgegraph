import {descriptorKeys,vocabularyKinds,type Descriptors,type Vocabulary} from './adapter'
/** PR #69 result contract. VisionClient/bearer injection belongs on the server, never in this adapter's UI args. */
export type PhotoDescriptorResult={modelId:string;source:'live'|'cached';descriptors:Descriptors;dropped:{key:string;value:unknown;reason:'UNKNOWN_KEY'|'NOT_IN_VOCABULARY'}[];textInImage:string[]}
export interface PhotoDescriptorAdapter{propose(input:{photoId:string;childId:string;vocabularyByKind:Record<string,string[]>;signal:AbortSignal}):Promise<PhotoDescriptorResult>}
// No browser endpoint was delivered in #69. Never replace a live failure with mock analysis.
export const unavailablePhotoDescriptors:PhotoDescriptorAdapter={propose:async()=>{throw Error('PHOTO_DESCRIPTORS_UNAVAILABLE')}}
export function vocabularyByKind(rows:Vocabulary[]){const result:Record<string,string[]>={};for(const row of rows)(result[row.kind]??=[]).push(row.value);return result}
export function confirmedVocabularySuggestions(result:PhotoDescriptorResult,rows:Vocabulary[]):Descriptors{
 const values:Descriptors={};for(const key of descriptorKeys){const value=result.descriptors[key];if(typeof value==='string'&&rows.some(row=>row.kind===vocabularyKinds[key]&&row.value===value))values[key]=value}return values
}
