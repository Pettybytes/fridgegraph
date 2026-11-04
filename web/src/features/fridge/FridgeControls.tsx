import type {ComponentProps} from 'react'
import {cn} from 'cn'
import {FgButton} from '@/components/fg/primitives'
import './controls.css'

/** React Bits SpecularButton and GlassSurface, adapted to FridgeGraph primitives.
 * Upstream: DavidHDev/react-bits. License: react-bits.LICENSE.txt.
 * Uses their native button/label and frosted fallback surface; static rim replaces
 * per-button WebGL. Existing handlers, refs, disabled states and Radix slots pass through.
 */
export function FridgeButton({className,children,variant='primary',...props}:ComponentProps<typeof FgButton>){
 return <FgButton {...props} variant={variant} className={cn('fridge-control',className)}><span className="fridge-control-label">{children}</span></FgButton>
}
export function FridgeControlSurface({className,children,...props}:ComponentProps<'div'>){
 return <div {...props} className={cn('fridge-control-surface',className)}><div className="fridge-control-content">{children}</div></div>
}
