import {SHOWCASE_PROFILES} from './profiles'
/** Fictional showcase facts for an already-authorized person. The caller's read decides
 * who is visible to this perspective; an unknown ID renders nothing, honestly. */
export default function ProfileFacts({personId,childId,childName}:{personId:string;childId:string;childName:string}){
 const profile=SHOWCASE_PROFILES[personId]
 if(!profile)return null
 const message=profile.messages[childId]
 const first=childName.trim().split(/\s+/)[0]||childName
 return <div className="sg-profile" data-testid="profile-facts">
  <p className="sg-profile-line">{profile.age} · {profile.job}</p>
  <dl>
   <div><dt>Enjoys</dt><dd>{profile.hobbies.join(', ')}</dd></div>
   <div><dt>Hoping for</dt><dd>{profile.goals.join(' · ')}</dd></div>
  </dl>
  {message&&<blockquote className="sg-profile-message"><p>“{message}”</p><cite>To {first}</cite></blockquote>}
  <p className="sg-profile-tag">Showcase profile</p>
 </div>
}
