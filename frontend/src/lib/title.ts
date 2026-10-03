import { useEffect } from 'react'

// Each page gets its own browser-tab title ("Review queue | ShredSafe"), so tabs and history are readable (F.23).
export function usePageTitle(title: string) {
  useEffect(() => {
    const before = document.title
    document.title = `${title} | ShredSafe`
    return () => {
      document.title = before
    }
  }, [title])
}
