import { useEffect, useRef } from 'react'

export type UseMapKeyboardResult = {
  spaceHeldRef: React.MutableRefObject<boolean>
}

/**
 * Manages keyboard state for the map: space key for panning.
 */
export function useMapKeyboard(viewMode: string): UseMapKeyboardResult {
  const spaceHeldRef = useRef(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (viewMode === 'map') e.preventDefault()
      spaceHeldRef.current = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeldRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [viewMode])

  return { spaceHeldRef }
}
