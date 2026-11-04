import {useId} from 'react'
export type MagnetKind='apple'|'bus'|'grade'|'star'|'heart'|'flower'
/** Original shapes drawn for this feature. Pure decoration; never focusable. */
export function Magnet({kind}:{kind:MagnetKind}){
 const id=useId().replace(/:/g,'')
 const colors={apple:['#ed7970','#ac3938'],bus:['#f8d375','#bf8b37'],grade:['#82b4c4','#386677'],star:['#f9df83','#c89b40'],heart:['#e69499','#ab535e'],flower:['#9bd8ea','#4389a4']}[kind]
 return <svg className={`fridge-magnet magnet-${kind}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false"><defs><linearGradient id={id} x2=".35" y2="1"><stop stopColor={colors[0]}/><stop offset="1" stopColor={colors[1]}/></linearGradient></defs><g fill={`url(#${id})`} stroke={colors[1]} strokeWidth="2" strokeLinejoin="round">
 {kind==='apple'&&<><path d="M32 19C12 9 5 27 13 45Q20 61 32 53Q46 62 53 43C60 24 47 10 32 19Z"/><path d="M32 20Q30 12 35 7" fill="none" stroke="#67503c" strokeWidth="5"/><path d="M34 13Q43 3 52 10Q47 20 34 13" fill="#668962" stroke="#55794f"/><path d="M18 27Q15 32 18 38" stroke="#fff7" strokeWidth="4" fill="none"/></>}
 {kind==='bus'&&<><path d="M8 16H45L55 29V47H7Z"/><path d="M13 22H22V32H13ZM27 22H36V32H27ZM41 22H44L51 32H41Z" fill="#dce5dc"/><path d="M8 38H54" stroke="#876a3b"/><circle cx="18" cy="48" r="7" fill="#4c5050" stroke="#343939"/><circle cx="45" cy="48" r="7" fill="#4c5050" stroke="#343939"/><path d="M12 18H40" stroke="#fff8" strokeWidth="3"/></>}
 {kind==='grade'&&<><path d="M11 8H53V56H11Z"/><path d="M19 43L27 20L35 43M23 34H31M40 22V35M34 28H46" stroke="#fff9e9" strokeWidth="4" fill="none"/><path d="M14 12H49" stroke="#fff7" strokeWidth="3"/></>}
 {kind==='star'&&<><path d="M32 5L40 23L60 25L45 39L49 59L32 49L14 59L18 39L3 25L24 22Z"/><path d="M11 27L27 26L32 14" stroke="#fff9" strokeWidth="3" fill="none"/></>}
 {kind==='heart'&&<><path d="M32 55C-6 31 7 3 25 13L32 21C53-7 81 26 32 55Z"/><path d="M16 19Q11 22 14 29" stroke="#fff9" strokeWidth="4" fill="none"/></>}
 {kind==='flower'&&<><path d="M32 23C11-8 5 21 23 30C-8 30 14 60 29 40C29 70 55 51 40 36C70 38 55 8 38 24C49-5 20-4 32 23Z"/><circle cx="32" cy="32" r="8" fill="#efcd77" stroke="#c49f4d"/><path d="M19 17L23 22" stroke="#fff8" strokeWidth="3"/></>}
 </g></svg>
}
