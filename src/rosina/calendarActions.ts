/** A narrow, read-only calendar proposal path. No mutation is available here.
 * Structured requests avoid a model round trip; ambiguity is a question, never a guessed write.
 */
import {catalog, type CalendarChangeArgs} from './catalog';
import type {ChildAccess} from './childAccess';
import {detroitToday} from './localTime';
type Event = {id:string;title:string;start:string;end:string;location:string|null;notes:string|null;color:string|null;status:string};
type Proposal = {reply:string;actions:{id:'calendar-change';args:CalendarChangeArgs}[]};
type Options={message:string;history:{role:string;content:string}[];children:ChildAccess[];bearer:string;graphqlUrl:string;today?:string;request?:typeof fetch};
const reply=(text:string):Proposal=>({reply:text,actions:[]});
const plus=(day:string,n:number)=>new Date(Date.parse(`${day}T12:00:00Z`)+n*86400000).toISOString().slice(0,10);
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const named=(text:string,name:string)=>new RegExp(`\\b${escape(name)}\\b`,'i').test(text);
// A wall time must exist exactly once in Detroit. DST gaps/overlaps require clarification.
export function unambiguousDetroit(wall:string):boolean {
 const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const naive=Date.parse(`${wall}Z`);if(!Number.isFinite(naive))return false;
 return [4,5].filter(offset=>fmt.format(new Date(naive+offset*3600000)).replace(' ','T')===wall).length===1;
}
export async function calendarProposal(o:Options):Promise<Proposal|null>{
 const text=o.message.trim().replace(/^(?:can|could|would) you\s+(?:please\s+)?|^I(?:’d| would) like (?:you )?to\s+/i,'');
 const verb=text.match(/^(?:please\s+)?(book|add|schedule|create|move|reschedule|cancel|delete)\b/i)?.[1]?.toLowerCase();
 if(!verb)return null;
 // Leave unrelated add-villager, pickup and Orbit requests on their existing paths.
 if(/\b(villager|pickup|orbit|alert|caregiver|permission|grant)\b/i.test(text))return null;
 const operation:CalendarChangeArgs['operation']=['move','reschedule'].includes(verb)?'update':['cancel','delete'].includes(verb)?'delete':'create';
 if(operation==='create'&&!/\b(at|tomorrow|today|calendar|party|appointment|event)\b/i.test(text))return null;
 if(/\b(Pacific|Central|Mountain|UTC|GMT|London|PST|PDT|CST|CDT)\b/i.test(text))return reply('Please give the event time in America/Detroit so I can propose the exact change.');
 const today=o.today??detroitToday();
 const prior=[...o.history].reverse().find(h=>h.role==='assistant'&&/^Done: (added|moved) /.test(h.content))?.content??'';
 const reference=/\b(it|that|this event)\b/i.test(text)?prior:'';
 let matches=o.children.filter(c=>c.displayName&&(named(text,c.displayName)||named(text,c.displayName.split(' ')[0])));
 if(!matches.length&&reference)matches=o.children.filter(c=>c.displayName&&reference.includes(` for ${c.displayName}. `));
 // Never silently redirect a named, inaccessible child to the caller's only child.
 if(!matches.length&&!/\bfor\s+\w+/i.test(text)&&o.children.length===1)matches=o.children;
 if(matches.length!==1)return reply('Which child is this for? Please use the name shown in your family calendar.');
 const child=matches[0];if(!child.displayName)return reply('I could not resolve the child’s name. Please try from their family calendar.');
 if(!o.graphqlUrl)return reply('Calendar changes are not connected right now. Nothing has been changed.');
 let events:Event[];
 try{
  const response=await(o.request??fetch)(o.graphqlUrl,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${o.bearer}`},signal:AbortSignal.timeout(2500),body:JSON.stringify({query:'query RosinaCalendarProposal($childId:ID!,$from:String!,$to:String!){calendarWriteAccess(childId:$childId) childEvents(childId:$childId,from:$from,to:$to){id title start end location notes color status}}',variables:{childId:child.id,from:plus(today,-30),to:plus(today,366)}})});
  const body=await response.json() as {data?:{calendarWriteAccess?:boolean;childEvents?:Event[]}};
  if(!response.ok||body.data?.calendarWriteAccess!==true)return reply('Your perspective cannot change this child’s calendar. A parent can make this change.');
  if(!Array.isArray(body.data.childEvents))return reply('I could not check the calendar. Nothing has been changed.');
  events=body.data.childEvents;
 }catch{return reply('I could not check the calendar. Nothing has been changed.');}
 let event:Event|undefined;
 if(operation!=='create'){
  const previousTitle=reference.match(/^Done: (?:added|moved) (.+) for /)?.[1];
  // Resolve the existing event from the words the caller actually used: a quoted title, or
  // every significant title word appearing in the request, plus the day when they gave one
  // (ISO, today/tomorrow, or a written-out date like "Thursday, November 5, 2026"). Extra
  // request words (instructions, times, the child's name) must not veto a title match.
  const MONTHS:Record<string,string>={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',sep:'09',sept:'09',oct:'10',nov:'11',dec:'12'};
  const written=text.match(new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,'i'));
  const requestedDay=text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]??(/\btomorrow\b/i.test(text)?plus(today,1):/\btoday\b/i.test(text)?today:undefined);
  const requestedMonthDay=!requestedDay&&written?`${MONTHS[written[1].toLowerCase()]}-${written[2].padStart(2,'0')}`:undefined;
  const onRequestedDay=(e:Event)=>requestedDay?e.start.startsWith(requestedDay):requestedMonthDay?e.start.slice(5,10)===requestedMonthDay:true;
  const norm=(v:string)=>v.toLowerCase().replace(/[’]/g,"'").replace(/[^a-z0-9' ]/g,' ').replace(/\s+/g,' ').trim();
  const quoted=text.match(/["“]([^"”]+)["”]/)?.[1];
  const requestWords=new Set(norm(text).split(' '));
  const childWords=new Set(norm(child.displayName).split(' ').map(w=>w.replace(/'s$/,'')));
  const titleMatches=(e:Event)=>{
   if(previousTitle)return e.title===previousTitle;
   if(quoted)return norm(e.title)===norm(quoted);
   const titleWords=norm(e.title).split(' ').filter(w=>w.length>1&&!childWords.has(w.replace(/'s$/,'')));
   return titleWords.length>0&&titleWords.every(w=>requestWords.has(w)||requestWords.has(w.replace(/'s$/,'')));
  };
  const found=events.filter(e=>onRequestedDay(e)&&titleMatches(e));
  if(found.length!==1)return reply(found.length?'There is more than one matching event. Which title and date should I change?':'Which existing event should I change? Please give its title and date.');
  event=found[0];
 }
 let start=event?.start.slice(0,19)??'',end=event?.end.slice(0,19)??'';
 if(operation!=='delete'){
  const time=text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if(!time)return reply('What start time should I use? Please include AM or PM. Times are in America/Detroit.');
  let day=text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]??(/\btomorrow\b/i.test(text)?plus(today,1):/\btoday\b/i.test(text)?today:event?.start.slice(0,10));
  if(!day)return reply('What date should I use? You can say today, tomorrow, or a date like 2026-11-05.');
  const hour=Number(time[1])%12+(time[3].toLowerCase().startsWith('p')?12:0);
  start=`${day}T${String(hour).padStart(2,'0')}:${time[2]??'00'}:00`;
  const duration=event?Date.parse(`${event.end.slice(0,19)}Z`)-Date.parse(`${event.start.slice(0,19)}Z`):3600000;
  if(!Number.isFinite(Date.parse(`${start}Z`)))return reply('That date is not valid. Which date should I use?');
  end=new Date(Date.parse(`${start}Z`)+duration).toISOString().slice(0,19);
  const endTime=[...text.matchAll(/\b(?:until|to|through)\s+(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/ig)].find(match=>(match.index??0)>(time.index??0));
  // In a move request 'to 7pm' is the new start, not an end.
  if(endTime&&(endTime.index??0)>(time.index??0)){
    const endHour=Number(endTime[1])%12+(endTime[3].toLowerCase()==='pm'?12:0);
    end=`${day}T${String(endHour).padStart(2,'0')}:${endTime[2]??'00'}:00`;
  }
  if(!unambiguousDetroit(start)||!unambiguousDetroit(end))return reply('That time falls in a Detroit clock change or is not a valid date. Please choose another start time.');
 }
 const title=event?.title??text.replace(/^(?:please\s+)?(?:book|add|schedule|create)\s+(?:an?\s+)?/i,'').split(/\s+for\s+|\s+at\s+|\s+tomorrow\b|\s+today\b/i)[0].trim();
 const placeText=text.replace(/\b(?:at|from|until|to)\s+\d+(?::\d+)?\s*(am|pm)\b/ig,'').replace(/\b(tomorrow|today)\b|\b\d{4}-\d{2}-\d{2}\b/ig,'');
 const place=event?.location??placeText.match(/\b(?:at|in)\s+(.+)$/i)?.[1]?.trim()??'';
 const args:CalendarChangeArgs={operation,childId:child.id,childName:child.displayName,eventId:event?.id??'',title,start,end,location:place,notes:event?.notes??'',color:event?.color??'',status:event?.status??'confirmed'};
 if(!catalog['calendar-change'].argsSchema.parse(args))return reply('I could not resolve an exact calendar change. Please give the title, date and time.');
 return {reply:operation==='create'?'Review this event (one hour unless you supplied an end time), then confirm to add it. Nothing has been saved.':'Review the exact change below, then confirm. Nothing has been changed.',actions:[{id:'calendar-change',args}]};
}
