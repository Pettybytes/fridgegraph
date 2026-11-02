/**
 * Portrait manifest — the one place persona identity maps to artwork.
 * Picker, Today and the signature Village/Orbit components all import from here;
 * nobody copies the files again.
 *
 * Provenance: 37 AI-generated FICTIONAL portraits produced with **muse-image-1.0**
 * on 2026-11-02, approved by Bryan, and stored at 384². "Bryan" is a fictional
 * village character, not the project owner. The artwork implies no IDs or
 * permissions (docs/contracts/design.md). Per-file model, date, full prompt and
 * hashes are in ./PROVENANCE.md and ./provenance.json.
 *
 * Note (safety): these are photorealistic headshots, including of the fictional
 * children. They are used on Bryan's explicit approval of this fictional set.
 * Flip any mapping to a monogram by removing its line.
 */
import Andre from '@/assets/portraits/Andre.png'
import Angela from '@/assets/portraits/Angela.png'
import Avery from '@/assets/portraits/Avery.png'
import Bryan from '@/assets/portraits/Bryan.png'
import Carol from '@/assets/portraits/Carol.png'
import Cassandra from '@/assets/portraits/Cassandra.png'
import Chris from '@/assets/portraits/Chris.png'
import Dana from '@/assets/portraits/Dana.png'
import Daniel from '@/assets/portraits/Daniel.png'
import Denise from '@/assets/portraits/Denise.png'
import Dwayne from '@/assets/portraits/Dwayne.png'
import Emma from '@/assets/portraits/Emma.png'
import Evelyn from '@/assets/portraits/Evelyn.png'
import Felicia from '@/assets/portraits/Felicia.png'
import Gary from '@/assets/portraits/Gary.png'
import Gloria from '@/assets/portraits/Gloria.png'
import Jax from '@/assets/portraits/Jax.png'
import Kendra from '@/assets/portraits/Kendra.png'
import Leo from '@/assets/portraits/Leo.png'
import Loretta from '@/assets/portraits/Loretta.png'
import Malik from '@/assets/portraits/Malik.png'
import Marcus from '@/assets/portraits/Marcus.png'
import Max from '@/assets/portraits/Max.png'
import Micah from '@/assets/portraits/Micah.png'
import Monique from '@/assets/portraits/Monique.png'
import Nora from '@/assets/portraits/Nora.png'
import Oscar from '@/assets/portraits/Oscar.png'
import Priya from '@/assets/portraits/Priya.png'
import Ray from '@/assets/portraits/Ray.png'
import Rosa from '@/assets/portraits/Rosa.png'
import Simone from '@/assets/portraits/Simone.png'
import Skye from '@/assets/portraits/Skye.png'
import Tasha from '@/assets/portraits/Tasha.png'
import Taylor from '@/assets/portraits/Taylor.png'
import Tomas from '@/assets/portraits/Tomas.png'
import Walter from '@/assets/portraits/Walter.png'
import Whitfield from '@/assets/portraits/Whitfield.png'

/** Canonical person-ID → portrait. The ID decides; never a first-name match. */
export const PORTRAIT_BY_PERSON: Record<string, string> = {
  p_nora: Nora, p_malik: Malik, p_mom: Kendra, p_dad: Andre, p_gma: Loretta,
  p_priya: Priya, p_tasha: Tasha, p_bryan: Bryan, p_dana: Dana, p_ray: Ray,
  p_evelyn: Evelyn, p_walter: Walter, p_price: Angela, p_chris: Chris,
  p_jax: Jax, p_leo: Leo, p_max: Max, p_gloria: Gloria, p_monique: Monique,
  p_okafor: Daniel, p_jennings: Carol, p_holt: Gary, p_marcus: Marcus,
  p_rosa: Rosa, p_tomas: Tomas, p_emma: Emma, p_felicia: Felicia,
  p_taylor: Taylor, p_skye: Skye, p_simone: Simone, p_denise: Denise,
  p_micah: Micah, p_avery: Avery, p_dwayne: Dwayne, p_cassandra: Cassandra,
  p_oscar: Oscar, p_whitfield: Whitfield,
}

/** EXACT full-name → portrait. Only a verified safety net for the rare surface
 * with no person ID; never a first-name match (a created child named "Nora" must
 * NOT inherit Nora Ellison's art). Identity comes from the person ID. */
export const PORTRAIT_BY_FULLNAME: Record<string, string> = {
  'Nora Ellison': Nora, 'Malik Ferris': Malik, 'Kendra Ellison': Kendra, 'Andre Ellison': Andre,
  'Loretta Brooks': Loretta, 'Priya Nair': Priya, 'Tasha Ellison': Tasha, 'Bryan Brooks': Bryan,
  'Dana Coleman': Dana, 'Ray Coleman': Ray, 'Evelyn Carter': Evelyn, 'Walter Ellison': Walter,
  'Angela Price': Angela, 'Chris Harlan': Chris, 'Jax Coleman': Jax, 'Leo Ellison': Leo,
  'Max Ellison': Max, 'Gloria Ellison': Gloria, 'Monique Davis': Monique, 'Daniel Okafor': Daniel,
  'Carol Jennings': Carol, 'Gary Holt': Gary, 'Marcus Reyes': Marcus, 'Rosa Castellano': Rosa,
  'Tomás Castellano': Tomas, 'Emma Castellano': Emma, 'Felicia Reyes': Felicia,
  'Taylor Reyes': Taylor, 'Skye Reyes': Skye, 'Simone Lee': Simone, 'Denise Lee': Denise,
  'Micah Lee': Micah, 'Avery Lee': Avery, 'Dwayne Ferris': Dwayne, 'Cassandra Ferris': Cassandra,
  'Oscar Alvarez': Oscar, 'Ms. Whitfield': Whitfield,
}

/** Resolve by person ID when one is given; the id DECIDES — an unknown id returns
 * undefined (monogram) and never falls through to the name, so a new child whose id
 * isn't mapped can't borrow another person's art by sharing a full name. The exact
 * full-name net is only consulted when there is NO id. Never a first-name match. */
export function portraitFor(input: { personId?: string | null; name?: string | null }): string | undefined {
  if (input.personId) return PORTRAIT_BY_PERSON[input.personId]
  const full = input.name?.trim()
  return full ? PORTRAIT_BY_FULLNAME[full] : undefined
}
