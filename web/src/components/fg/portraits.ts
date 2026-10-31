/**
 * Portrait manifest — the one place persona identity maps to artwork.
 * Picker, Today and the signature Village/Orbit components all import from here;
 * nobody copies the files again.
 *
 * Provenance: 16 AI-generated FICTIONAL portraits supplied and approved by Bryan
 * (~/Desktop/fridgegraph-refs, also in the source zip), downscaled to 384². They
 * were produced with ChatGPT image generation — NOT Muse Image; never label them
 * as Muse. "Bryan" is a fictional village character, not the project owner. The
 * artwork implies no IDs or permissions (docs/contracts/design.md).
 *
 * Note (safety): these are photorealistic headshots, including of the fictional
 * children. They are used on Bryan's explicit, repeated approval of this fictional
 * set; see system.md. Flip any mapping to a monogram by removing its line.
 */
import Andre from '@/assets/portraits/Andre.png'
import Angela from '@/assets/portraits/Angela.png'
import Bryan from '@/assets/portraits/Bryan.png'
import Chris from '@/assets/portraits/Chris.png'
import Dana from '@/assets/portraits/Dana.png'
import Evelyn from '@/assets/portraits/Evelyn.png'
import Jax from '@/assets/portraits/Jax.png'
import Kendra from '@/assets/portraits/Kendra.png'
import Leo from '@/assets/portraits/Leo.png'
import Loretta from '@/assets/portraits/Loretta.png'
import Malik from '@/assets/portraits/Malik.png'
import Nora from '@/assets/portraits/Nora.png'
import Priya from '@/assets/portraits/Priya.png'
import Ray from '@/assets/portraits/Ray.png'
import Tasha from '@/assets/portraits/Tasha.png'
import Walter from '@/assets/portraits/Walter.png'

/** Canonical person-ID → portrait, verified against src/fixtures.ts display names. */
export const PORTRAIT_BY_PERSON: Record<string, string> = {
  p_nora: Nora, p_malik: Malik, p_mom: Kendra, p_dad: Andre, p_gma: Loretta,
  p_priya: Priya, p_tasha: Tasha, p_bryan: Bryan, p_dana: Dana, p_ray: Ray,
  p_evelyn: Evelyn, p_walter: Walter, p_price: Angela, p_chris: Chris,
  p_jax: Jax, p_leo: Leo,
}

/** EXACT full-name → portrait. Only a verified safety net for the rare surface
 * with no person ID; never a first-name match (a created child named "Nora" must
 * NOT inherit Nora Ellison's art). Identity comes from the person ID. */
export const PORTRAIT_BY_FULLNAME: Record<string, string> = {
  'Nora Ellison': Nora, 'Malik Ferris': Malik, 'Kendra Ellison': Kendra, 'Andre Ellison': Andre,
  'Loretta Brooks': Loretta, 'Priya Nair': Priya, 'Tasha Ellison': Tasha, 'Bryan Brooks': Bryan,
  'Dana Coleman': Dana, 'Ray Coleman': Ray, 'Evelyn Carter': Evelyn, 'Walter Ellison': Walter,
  'Angela Price': Angela, 'Chris Harlan': Chris, 'Jax Coleman': Jax, 'Leo Ellison': Leo,
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
