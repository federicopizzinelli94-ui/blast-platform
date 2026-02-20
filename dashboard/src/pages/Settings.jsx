import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Settings as SettingsIcon, UserPlus, Users, Trash2, Shield } from 'lucide-react'
import { API_URL } from '../lib/api'

export default function Settings() {
    const { user } = useAuth()
    const [users, setUsers] = useState([])
    const [loadingUsers, setLoadingUsers] = useState(true)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null) // { type: 'success'|'error', text }
    const [deletingId, setDeletingId] = useState(null)

    useEffect(() => {
        fetchUsers()
    }, [])

    const fetchUsers = async () => {
        try {
            const res = await fetch(`${API_URL}/list-users`)
            if (!res.ok) throw new Error('Errore nel caricamento utenti')
            const data = await res.json()
            setUsers(data.users || [])
        } catch (err) {
            console.error('Error fetching users:', err)
        } finally {
            setLoadingUsers(false)
        }
    }

    const handleCreateUser = async (e) => {
        e.preventDefault()
        setCreating(true)
        setMessage(null)

        try {
            const res = await fetch(`${API_URL}/create-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            })
            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.detail || 'Errore nella creazione')
            }

            setMessage({ type: 'success', text: `Utente ${email} creato con successo` })
            setEmail('')
            setPassword('')
            fetchUsers()
        } catch (err) {
            setMessage({ type: 'error', text: err.message })
        } finally {
            setCreating(false)
        }
    }

    const handleDeleteUser = async (userId, userEmail) => {
        if (userId === user?.id) {
            setMessage({ type: 'error', text: 'Non puoi eliminare il tuo stesso account' })
            return
        }

        if (!window.confirm(`Sei sicuro di voler eliminare l'utente ${userEmail}?`)) return

        setDeletingId(userId)
        setMessage(null)

        try {
            const res = await fetch(`${API_URL}/delete-user`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId })
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.detail || 'Errore nella rimozione')
            }

            setMessage({ type: 'success', text: `Utente ${userEmail} eliminato` })
            fetchUsers()
        } catch (err) {
            setMessage({ type: 'error', text: err.message })
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <div className="p-8 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-start gap-4 mb-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white shadow-lg">
                    <SettingsIcon className="w-6 h-6" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Impostazioni</h1>
                    <p className="text-gray-500 text-sm">Gestisci gli utenti e le impostazioni del sistema</p>
                </div>
            </div>

            {/* Message */}
            {message && (
                <div className={`mb-6 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {message.text}
                </div>
            )}

            {/* Create User */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
                <div className="flex items-center gap-2 mb-4">
                    <UserPlus className="w-5 h-5 text-teal-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Aggiungi Utente</h2>
                </div>

                <form onSubmit={handleCreateUser} className="flex items-end gap-3">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="email"
                            required
                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-teal-500 focus:ring-teal-500 bg-gray-50 p-2.5 border"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="nome@azienda.com"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            required
                            minLength={6}
                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-teal-500 focus:ring-teal-500 bg-gray-50 p-2.5 border"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Minimo 6 caratteri"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={creating}
                        className="flex items-center gap-2 bg-teal-600 text-white rounded-lg px-5 py-2.5 font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                        {creating ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <UserPlus className="w-4 h-4" />
                        )}
                        Crea Utente
                    </button>
                </form>
            </div>

            {/* Users List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-teal-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Utenti Registrati</h2>
                    <span className="text-sm text-gray-400 ml-auto">{users.length} utenti</span>
                </div>

                {loadingUsers ? (
                    <div className="text-center py-8 text-gray-400">
                        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        Caricamento utenti...
                    </div>
                ) : users.length === 0 ? (
                    <p className="text-center py-8 text-gray-400">Nessun utente trovato</p>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {users.map((u) => (
                            <div key={u.id} className="flex items-center py-3 gap-3">
                                <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold uppercase">
                                    {u.email?.[0] || '?'}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate flex items-center gap-2">
                                        {u.email}
                                        {u.id === user?.id && (
                                            <span className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-600 px-2 py-0.5 rounded-full">
                                                <Shield className="w-3 h-3" /> Tu
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-400">
                                        Creato il {new Date(u.created_at).toLocaleDateString('it-IT')}
                                    </div>
                                </div>
                                {u.id !== user?.id && (
                                    <button
                                        onClick={() => handleDeleteUser(u.id, u.email)}
                                        disabled={deletingId === u.id}
                                        className="text-gray-400 hover:text-red-600 transition-colors p-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50"
                                        title="Elimina utente"
                                    >
                                        {deletingId === u.id ? (
                                            <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <Trash2 className="w-4 h-4" />
                                        )}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
