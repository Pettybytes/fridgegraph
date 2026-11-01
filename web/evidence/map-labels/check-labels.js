async page => {
 const result=await page.evaluate(()=>{
  const labels=[...document.querySelectorAll('.vm-map-label')].map(e=>({text:e.textContent,box:e.getBoundingClientRect().toJSON()}));
  const markers=[...document.querySelectorAll('.vm-cluster,.vm-person-marker,.vm-place-marker')].map(e=>e.getBoundingClientRect().toJSON());
  const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  return {labels:labels.length,collisions:labels.flatMap((a,i)=>[...markers,...labels.slice(i+1).map(b=>b.box)].filter(b=>overlaps(a.box,b))).length,portraits:document.querySelectorAll('.vm-cluster img,.vm-person-marker img').length};
 });
 if(!result.labels||!result.portraits||result.collisions)throw Error(JSON.stringify(result));
 return result;
}
