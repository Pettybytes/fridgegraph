import {NoticeFailure,type NoticeInput} from './types'
export const fileTypes='image/png,image/jpeg,image/webp,application/pdf'
export async function noticeInput(text:string,files:File[],signal:AbortSignal):Promise<NoticeInput>{
 if(signal.aborted)throw new DOMException('Aborted','AbortError')
 if(text&&files.length||files.length>1)throw Error('Choose pasted text or one file for this review.')
 if(text){if(text.length>20000)throw new NoticeFailure('PAYLOAD_TOO_LARGE');return {kind:'text',text}}
 const file=files[0]
 if(!file)throw Error('Add notice text or a file first.')
 if(!fileTypes.split(',').includes(file.type))throw new NoticeFailure('UNSUPPORTED_MEDIA_TYPE')
 // Conservative decimal MB bound; never sends more than the contract's 8 MB.
 if(file.size>8_000_000)throw new NoticeFailure('PAYLOAD_TOO_LARGE')
 const dataBase64=await new Promise<string>((resolve,reject)=>{
  const reader=new FileReader(),abort=()=>{reader.abort();reject(new DOMException('Aborted','AbortError'))}
  signal.addEventListener('abort',abort,{once:true})
  const finish=()=>signal.removeEventListener('abort',abort)
  reader.onload=()=>{finish();if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return}const result=reader.result;typeof result==='string'?resolve(result.slice(result.indexOf(',')+1)):reject(new NoticeFailure('UNAVAILABLE'))}
  reader.onerror=()=>{finish();reject(new NoticeFailure('UNAVAILABLE'))}
  reader.onabort=finish;reader.readAsDataURL(file)
 })
 return file.type==='application/pdf'?{kind:'pdf',mimeType:'application/pdf',dataBase64}:{kind:'image',mimeType:file.type as 'image/png'|'image/jpeg'|'image/webp',dataBase64}
}
