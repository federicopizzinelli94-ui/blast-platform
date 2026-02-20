import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null)
            setLoading(false)
        })

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setUser(session?.user ?? null)
            }
        )

        return () => subscription.unsubscribe()
    }, [])

    const signIn = (email, password) =>
        supabase.auth.signInWithPassword({ email, password })

    const signOut = () => supabase.auth.signOut()

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
                <img src="/New Logo LS.png" alt="Laser Services" className="h-16 object-contain mb-6" />
                <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <AuthContext.Provider value={{ user, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => useContext(AuthContext)
