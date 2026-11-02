import {createContext} from 'react'
import type {FridgeReader} from './model'
/** Offline evidence seam. Production has no provider and uses the caller's Apollo client. */
export const FridgeReadContext=createContext<FridgeReader|null>(null)
