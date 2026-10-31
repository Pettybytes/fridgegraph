// Bounded wording checks for the local acceptance harness, not an inference engine.
// Source records stay authoritative; UNKNOWN is absent evidence, FREE is not consent.
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
function asserted(pattern,text){
 for(const match of text.matchAll(pattern)){
  const before=text.slice(0,match.index),prefix=before.slice(Math.max(...['.','!','?',';','\n'].map(mark=>before.lastIndexOf(mark)))+1)
  if(/\b(?:does not mean|doesn't mean|does not imply|doesn't imply|cannot conclude|can't conclude|cannot say|can't say|cannot confirm|can't confirm|not a promise|no promise|not proof|not confirmation)\b[^.!?;]*$/.test(prefix))continue
  if(/\b(?:not|no)\s*$/.test(prefix))continue
  if(/\b(?:does not|doesn't|never) (?:mean|confirm|imply|prove|guarantee)\b|\bnot (?:confirmed )?willing/.test(match[0]))continue
  return true
 }
 return false
}
export function availabilityConsistent(reply,candidates=[]){
 const text=reply.toLowerCase().replace(/[’‘]/g,"'").replace(/[ \t]+/g,' ')
 // Reject explicit FREE -> willingness conclusions, even if another sentence admits uncertainty.
 if(asserted(/\bfree\b[^.!?\n]{0,60}\b(?:means|confirms|proves|implies|guarantees|so|therefore|thus)\b[^.!?\n]{0,60}\b(?:willingness|willing|will help|can help|available to help|agreed to help)\b/g,text))return false
 if(asserted(/\b(?:willing to help|has agreed to help|will help)\b[^.!?\n]{0,60}\b(?:because|since|based on)\b[^.!?\n]{0,60}\bfree\b/g,text))return false
 const unknown=candidates.filter(c=>c.availability==='UNKNOWN')
 const absent=/\bno availability recorded\b|\bavailability (?:is )?(?:unknown|not recorded)\b/.test(text)
 if((unknown.length||absent||!candidates.length)&&asserted(/\b(?:nobody|no one|none of (?:them|the caregivers|the candidates)) (?:is |are |was |were )?(?:available|free|able to help)\b/g,text))return false
 if(!unknown.length)return true
 const names=unknown.flatMap(c=>{const name=c.person?.displayName?.toLowerCase();return name?[name,name.split(' ')[0]]:[]})
 if(unknown.length===candidates.length)names.push('she','he','they')
 if(names.length&&asserted(new RegExp('\\b(?:'+[...new Set(names)].map(escape).join('|')+') (?:is|are|was|were|has been) (?:confirmed |actually )?(?:available|free to help|willing to help)\\b','g'),text))return false
 return /\bunknown\b|\bnot recorded\b|\bnot confirmed\b|\b(?:can't|cannot) confirm\b|\bno availability recorded\b/.test(text)
}
