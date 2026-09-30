import * as React from 'react'
import { createContext, useContext } from 'react'
import type { TraceTarget } from '@/lib/trace/api'

export const TraceTargetContext = createContext<TraceTarget>('local')
export function useTraceTarget() { return useContext(TraceTargetContext) }
