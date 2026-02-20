import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { LogIn } from 'lucide-react'

export default function Login() {
    const { user, signIn } = useAuth()
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    if (user) return <Navigate to="/" replace />

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const { error: authError } = await signIn(email, password)
            if (authError) {
                if (authError.message === 'Invalid login credentials') {
                    setError('Email o password non validi')
                } else {
                    setError(authError.message)
                }
            } else {
                navigate('/', { replace: true })
            }
        } catch (err) {
            setError('Errore di connessione. Riprova.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="w-full max-w-sm">
                <div className="flex flex-col items-center mb-8">
                    <img src="/New Logo LS.png" alt="Laser Services" className="h-14 object-contain mb-3" />
                    <p className="text-sm text-gray-500">Accedi al sistema B.L.A.S.T.</p>
                </div>

                <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="email"
                            required
                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-teal-500 focus:ring-teal-500 bg-gray-50 p-2.5 border"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="nome@azienda.com"
                            autoComplete="email"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            required
                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-teal-500 focus:ring-teal-500 bg-gray-50 p-2.5 border"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="La tua password"
                            autoComplete="current-password"
                        />
                    </div>

                    {error && (
                        <p className="text-red-600 text-sm bg-red-50 p-2.5 rounded-lg">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white rounded-lg py-2.5 font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <>
                                <LogIn className="w-4 h-4" />
                                Accedi
                            </>
                        )}
                    </button>
                </form>

                <p className="text-center text-xs text-gray-400 mt-6">Laser Services &copy; {new Date().getFullYear()}</p>
            </div>
        </div>
    )
}
