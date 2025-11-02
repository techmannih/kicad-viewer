import type { ReactNode } from "react"

interface Props {
  children: ReactNode
}

const ContextProviders = ({ children }: Props) => {
  return <>{children}</>
}

export default ContextProviders
