import {createContext} from 'react'
import type {LiveCalendarAdapter} from './liveAdapter'
export const LiveCalendarContext=createContext<LiveCalendarAdapter|null>(null)
