import { useEffect, useRef, useState } from 'react'
import { userError } from './errors'
export function useOperation<T>() {
  const sequence = useRef(0)
  const [state, setState] = useState<{ result: T | null; error: string; busy: boolean }>({ result: null, error: '', busy: false })
  useEffect(() => () => { sequence.current++ }, [])
  function clear() { sequence.current++; setState({ result: null, error: '', busy: false }) }
  async function run(task: () => Promise<T>) {
    const id = ++sequence.current
    setState({ result: null, error: '', busy: true })
    try {
      const result = await task()
      if (id === sequence.current) setState({ result, error: '', busy: false })
    } catch (error) {
      if (id === sequence.current) setState({ result: null, error: userError(error), busy: false })
    } finally { window.dispatchEvent(new Event('devtools-operation')) }
  }
  return { ...state, clear, run }
}
