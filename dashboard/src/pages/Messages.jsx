import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, MapPin, Globe, Gauge, Copy, CheckCircle, Send, Mail, MessageSquareText, Search, ChevronDown, ChevronUp } from 'lucide-react'

export default function Messages() {
    const [leads, setLeads] = useState([])
    const [loading, setLoading] = useState(true)
    const [copiedId, setCopiedId] = useState(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedCards, setExpandedCards] = useState({})

    useEffect(() => {
        fetchMessaggedLeads()

        // Realtime: listen for updates to leads (new emails generated)
        const subscription = supabase
            .channel('public:leads:messages')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
                if (payload.new.generated_email) {
                    setLeads(prev => {
                        const exists = prev.find(l => l.id === payload.new.id)
                        if (exists) {
                            return prev.map(l => l.id === payload.new.id ? { ...l, ...payload.new } : l)
                        } else {
                            return [payload.new, ...prev]
                        }
                    })
                }
            })
            .subscribe()

        return () => subscription.unsubscribe()
    }, [])

    const fetchMessaggedLeads = async () => {
        setLoading(true)
        const { data } = await supabase
            .from('leads')
            .select('*, products(name)')
            .not('generated_email', 'is', null)
            .order('created_at', { ascending: false })

        if (data) setLeads(data)
        setLoading(false)
    }

    const parseEmail = (raw) => {
        if (!raw) return null
        try {
            return JSON.parse(raw)
        } catch {
            return { subject: '', body: raw, hook: '' }
        }
    }

    const copyEmail = (lead) => {
        const email = parseEmail(lead.generated_email)
        if (!email) return
        const text = `Oggetto: ${email.subject}\n\n${email.body}`
        navigator.clipboard.writeText(text)
        setCopiedId(lead.id)
        setTimeout(() => setCopiedId(null), 2500)
    }

    const toggleExpand = (id) => {
        setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }))
    }

    const getScoreColor = (score) => {
        if (!score) return "bg-gray-100 text-gray-500 border-gray-200"
        if (score >= 80) return "bg-green-100 text-green-700 border-green-200"
        if (score >= 50) return "bg-yellow-100 text-yellow-700 border-yellow-200"
        return "bg-red-50 text-red-600 border-red-100"
    }

    const getScoreEmoji = (score) => {
        if (!score) return "—"
        if (score >= 80) return "🔥"
        if (score >= 50) return "⚡"
        return "❄️"
    }

    const formatDate = (dateString) => {
        if (!dateString) return ""
        const date = new Date(dateString)
        return new Intl.DateTimeFormat('it-IT', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }).format(date)
    }

    const filteredLeads = leads.filter(lead => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        const email = parseEmail(lead.generated_email)
        return (
            lead.company_name?.toLowerCase().includes(q) ||
            lead.location?.toLowerCase().includes(q) ||
            email?.subject?.toLowerCase().includes(q) ||
            email?.body?.toLowerCase().includes(q) ||
            lead.products?.name?.toLowerCase().includes(q)
        )
    })

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <header className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl text-white shadow-lg shadow-teal-200/50">
                        <MessageSquareText className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Messaggi</h1>
                        <p className="text-sm text-gray-500">Email generate pronte per l'invio</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="Cerca messaggi..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent w-64 bg-white"
                        />
                    </div>
                    <div className="text-sm text-gray-500">
                        Totale: <span className="font-bold text-teal-600">{filteredLeads.length}</span>
                    </div>
                </div>
            </header>

            {/* Loading */}
            {loading && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 space-y-4 animate-pulse">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gray-200 rounded-lg" />
                                <div className="space-y-2 flex-1">
                                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                                </div>
                            </div>
                            <div className="h-3 bg-gray-100 rounded w-full" />
                            <div className="h-20 bg-gray-50 rounded-lg" />
                            <div className="h-8 bg-gray-100 rounded-lg w-1/3" />
                        </div>
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!loading && filteredLeads.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <MessageSquareText className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-700 mb-1">Nessun messaggio</h3>
                    <p className="text-sm text-gray-500">
                        {searchQuery
                            ? "Nessun messaggio corrisponde alla ricerca."
                            : "Genera la tua prima email dalla sezione Contatti!"}
                    </p>
                </div>
            )}

            {/* Card Grid */}
            {!loading && filteredLeads.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filteredLeads.map((lead) => {
                        const email = parseEmail(lead.generated_email)
                        const isExpanded = expandedCards[lead.id]

                        return (
                            <div
                                key={lead.id}
                                className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden group"
                            >
                                {/* Card Header */}
                                <div className="p-5 pb-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600">
                                                <Building2 className="h-5 w-5" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-gray-900 truncate">{lead.company_name}</div>
                                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                                    <MapPin className="w-3 h-3 flex-shrink-0" />
                                                    <span className="truncate">{lead.location || "N/A"}</span>
                                                </div>
                                                <div className="text-gray-400 mt-0.5" style={{ fontSize: '10px' }}>{formatDate(lead.created_at)}</div>
                                            </div>
                                        </div>
                                        {/* Score Badge */}
                                        {lead.match_score !== null && lead.match_score !== undefined && (
                                            <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold border ${getScoreColor(lead.match_score)}`}>
                                                {getScoreEmoji(lead.match_score)} {lead.match_score}%
                                            </span>
                                        )}
                                    </div>

                                    {/* Meta row: product + website */}
                                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                            {lead.products?.name || "Generico"}
                                        </span>
                                        {lead.website && (
                                            <a
                                                href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate"
                                            >
                                                <Globe className="w-3 h-3 flex-shrink-0" />
                                                <span className="truncate" style={{ maxWidth: '120px' }}>
                                                    {lead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                                                </span>
                                            </a>
                                        )}
                                    </div>

                                    {/* Match reason */}
                                    {lead.match_reason && (
                                        <p className="text-xs text-gray-500 leading-snug mt-2 line-clamp-2">{lead.match_reason}</p>
                                    )}
                                </div>

                                {/* Divider */}
                                <div className="border-t border-gray-100 mx-5" />

                                {/* Email Content */}
                                {email && (
                                    <div className="p-5 pt-3 flex-1 flex flex-col">
                                        {/* Subject */}
                                        <div className="mb-2">
                                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Oggetto</div>
                                            <p className="text-sm font-medium text-gray-900">{email.subject}</p>
                                        </div>

                                        {/* Hook */}
                                        {email.hook && (
                                            <div className="mb-2 px-3 py-2 bg-teal-50 rounded-lg border border-teal-100">
                                                <p className="text-xs text-teal-700 italic leading-snug">{email.hook}</p>
                                            </div>
                                        )}

                                        {/* Body - collapsible */}
                                        <div className="mb-3 flex-1">
                                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Testo</div>
                                            <div
                                                className={`text-xs text-gray-700 leading-relaxed whitespace-pre-line ${isExpanded ? '' : 'line-clamp-4'} cursor-pointer`}
                                                onClick={() => toggleExpand(lead.id)}
                                            >
                                                {email.body}
                                            </div>
                                            {email.body && email.body.length > 150 && (
                                                <button
                                                    onClick={() => toggleExpand(lead.id)}
                                                    className="text-[10px] text-teal-600 mt-1 flex items-center gap-0.5 hover:text-teal-700 transition-colors"
                                                >
                                                    {isExpanded
                                                        ? <><ChevronUp className="w-3 h-3" /> Riduci</>
                                                        : <><ChevronDown className="w-3 h-3" /> Espandi testo</>
                                                    }
                                                </button>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex gap-2 mt-auto pt-2">
                                            <button
                                                onClick={() => copyEmail(lead)}
                                                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${copiedId === lead.id
                                                        ? 'bg-green-50 text-green-700 border border-green-200'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {copiedId === lead.id
                                                    ? <><CheckCircle className="w-3.5 h-3.5" /> Copiato!</>
                                                    : <><Copy className="w-3.5 h-3.5" /> Copia</>
                                                }
                                            </button>
                                            {lead.email && (
                                                <a
                                                    href={`mailto:${lead.email}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
                                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors"
                                                >
                                                    <Send className="w-3.5 h-3.5" /> Invia
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
