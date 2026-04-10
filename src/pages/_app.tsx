import { Analytics } from "@vercel/analytics/next"
import type { AppProps } from "next/app"

import "~styles/tailwind.css"

function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Analytics />
    </>
  )
}

export default App
