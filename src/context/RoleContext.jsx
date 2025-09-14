import React, { createContext, useContext, useState } from 'react'

const RoleContext = createContext(null)

export function RoleProvider({ children }) {
  const [role, setRoleState] = useState(() => localStorage.getItem('lms_role') || '')

  const setRole = (value) => {
    setRoleState(value)
    if (value) localStorage.setItem('lms_role', value)
    else localStorage.removeItem('lms_role')
  }

  return (
    <RoleContext.Provider value={{ role, setRole }}>
      {children}
    </RoleContext.Provider>
  )
}

export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used within RoleProvider')
  return ctx
}
