import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import {
    Users, Mail, TrendingUp, Package, Search, ArrowUpRight, ArrowDownRight,
    Gauge, Zap, ChevronRight, Building2, Send, Plus, Activity
} from 'lucide-react'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

// ── Utility: format date for chart grouping ──
const formatChartDate = (dateStr) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

// ── Custom Tooltip ──
const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
        <div className="bg-white px-4 py-3 rounded-xl shadow-lg border border-gray-100 text-xs">
            <p className="font-semibold text-gray-700 mb-1.5">{label}</p>
            {payload.map((p, i) => (
                <div key={i} className="flex items-center gap-2 mb-0.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.fill }} />
                    <span className="text-gray-600">{p.name}:</span>
                    <span className="font-bold text-gray-900">{p.value}</span>
                </div>
            ))}
        </div>
    )
}

export default function Dashboard() {
    const navigate = useNavigate()
    const [leads, setLeads] = useState([])
    const [products, setProducts] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        setLoading(true)
        const [leadsRes, productsRes] = await Promise.all([
            supabase.from('leads').select('id, company_name, match_score, generated_email, created_at, interested_product_id, location').order('created_at', { ascending: false }),
            supabase.from('products').select('id, name, target_keywords, created_at').order('created_at', { ascending: false })
        ])
        if (leadsRes.data) setLeads(leadsRes.data)
        if (productsRes.data) setProducts(productsRes.data)
        setLoading(false)
    }

    // ── Computed Stats ──
    const stats = useMemo(() => {
        const totalLeads = leads.length
        const emailsGenerated = leads.filter(l => l.generated_email).length
        const withScore = leads.filter(l => l.match_score != null)
        const avgScore = withScore.length > 0
            ? Math.round(withScore.reduce((sum, l) => sum + l.match_score, 0) / withScore.length)
            : 0
        const conversionRate = totalLeads > 0
            ? Math.round((emailsGenerated / totalLeads) * 100)
            : 0

        // Weekly comparison
        const now = new Date()
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

        const thisWeekLeads = leads.filter(l => new Date(l.created_at) >= oneWeekAgo).length
        const lastWeekLeads = leads.filter(l => {
            const d = new Date(l.created_at)
            return d >= twoWeeksAgo && d < oneWeekAgo
        }).length
        const leadGrowth = lastWeekLeads > 0
            ? Math.round(((thisWeekLeads - lastWeekLeads) / lastWeekLeads) * 100)
            : thisWeekLeads > 0 ? 100 : 0

        return { totalLeads, emailsGenerated, avgScore, conversionRate, leadGrowth, thisWeekLeads }
    }, [leads])

    // ── Chart Data: group by day (last 14 days) ──
    const chartData = useMemo(() => {
        const days = []
        const now = new Date()
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            d.setHours(0, 0, 0, 0)
            days.push(d)
        }

        return days.map(day => {
            const dayEnd = new Date(day)
            dayEnd.setHours(23, 59, 59, 999)
            const dayLabel = formatChartDate(day)

            const dayLeads = leads.filter(l => {
                const d = new Date(l.created_at)
                return d >= day && d <= dayEnd
            })

            return {
                name: dayLabel,
                Lead: dayLeads.length,
                Email: dayLeads.filter(l => l.generated_email).length
            }
        })
    }, [leads])

    // ── Products with lead count ──
    const productsWithStats = useMemo(() => {
        return products.map(p => ({
            ...p,
            leadCount: leads.filter(l => l.interested_product_id === p.id).length,
            emailCount: leads.filter(l => l.interested_product_id === p.id && l.generated_email).length
        }))
    }, [products, leads])

    // ── Recent activity ──
    const recentActivity = useMemo(() => {
        const activities = []

        // Lead activities
        leads.slice(0, 20).forEach(l => {
            activities.push({
                type: 'lead',
                icon: Building2,
                label: `Nuovo lead trovato`,
                detail: l.company_name,
                date: l.created_at,
                color: 'text-teal-600 bg-teal-50'
            })
            if (l.generated_email) {
                activities.push({
                    type: 'email',
                    icon: Send,
                    label: `Email generata`,
                    detail: l.company_name,
                    date: l.created_at, // approximate
                    color: 'text-emerald-600 bg-emerald-50'
                })
            }
        })

        // Product activities
        products.forEach(p => {
            activities.push({
                type: 'product',
                icon: Package,
                label: `Prodotto creato`,
                detail: p.name,
                date: p.created_at,
                color: 'text-blue-600 bg-blue-50'
            })
        })

        return activities
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 10)
    }, [leads, products])

    const formatActivityDate = (dateStr) => {
        const d = new Date(dateStr)
        const now = new Date()
        const diffMs = now - d
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)

        if (diffMins < 1) return 'Ora'
        if (diffMins < 60) return `${diffMins}m fa`
        if (diffHours < 24) return `${diffHours}h fa`
        if (diffDays < 7) return `${diffDays}g fa`
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
    }

    if (loading) {
        return (
            <div className="p-8 max-w-7xl mx-auto space-y-8">
                <div className="h-36 bg-gray-200 rounded-2xl animate-pulse" />
                <div className="h-80 bg-gray-100 rounded-xl animate-pulse" />
                <div className="grid grid-cols-3 gap-5">
                    {[1, 2, 3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}
                </div>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">

            {/* ═══════════════════════════════════════════════
                1. HERO BANNER
            ═══════════════════════════════════════════════ */}
            <div className="bg-gradient-to-r from-teal-600 via-teal-500 to-emerald-500 rounded-2xl p-6 text-white shadow-xl shadow-teal-200/40 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute -right-12 -top-12 w-56 h-56 bg-white/5 rounded-full" />
                <div className="absolute -right-4 -bottom-8 w-32 h-32 bg-white/5 rounded-full" />

                <div className="relative flex items-center justify-between">
                    <div>
                        <p className="text-teal-100 text-sm font-medium mb-1">Lead Totali Trovati</p>
                        <div className="flex items-baseline gap-3">
                            <span className="text-5xl font-bold tracking-tight">{stats.totalLeads}</span>
                            {stats.leadGrowth !== 0 && (
                                <span className={`flex items-center gap-0.5 text-sm font-semibold px-2 py-0.5 rounded-full ${stats.leadGrowth > 0 ? 'bg-white/20 text-green-100' : 'bg-white/20 text-red-200'}`}>
                                    {stats.leadGrowth > 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                                    {Math.abs(stats.leadGrowth)}%
                                </span>
                            )}
                        </div>
                        <p className="text-teal-200 text-xs mt-1">+{stats.thisWeekLeads} questa settimana</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => navigate('/search')}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white/20 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/30 transition-colors"
                        >
                            <Search className="w-4 h-4" /> Nuova Ricerca
                        </button>
                        <button
                            onClick={() => navigate('/leads')}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white text-teal-700 rounded-xl text-sm font-semibold hover:bg-teal-50 transition-colors shadow-lg"
                        >
                            <Users className="w-4 h-4" /> Vedi Contatti
                        </button>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════
                2. CHART + SIDE KPIs
            ═══════════════════════════════════════════════ */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="flex">
                    {/* Chart */}
                    <div className="flex-1 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                <Activity className="w-5 h-5 text-teal-600" />
                                Andamento Ultimi 14 Giorni
                            </h2>
                        </div>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} barGap={2} barSize={18}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                                        allowDecimals={false}
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                                    <Legend
                                        wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                                        iconType="circle"
                                        iconSize={8}
                                    />
                                    <Bar dataKey="Lead" name="Lead Trovati" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="Email" name="Email Generate" fill="#059669" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Side KPIs */}
                    <div className="w-56 border-l border-gray-100 flex flex-col justify-center gap-6 p-6">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                                    <Users className="w-4 h-4 text-teal-600" />
                                </div>
                                <span className="text-xs text-gray-500 font-medium">Lead Trovati</span>
                            </div>
                            <p className="text-2xl font-bold text-gray-900">{stats.totalLeads}</p>
                        </div>
                        <div className="h-px bg-gray-100" />
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <Mail className="w-4 h-4 text-emerald-600" />
                                </div>
                                <span className="text-xs text-gray-500 font-medium">Email Generate</span>
                            </div>
                            <p className="text-2xl font-bold text-gray-900">{stats.emailsGenerated}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════
                3. STAT CARDS
            ═══════════════════════════════════════════════ */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Score Medio */}
                <div
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => navigate('/leads')}
                >
                    <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <Gauge className="w-6 h-6 text-amber-500" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs text-gray-500 font-medium">Score Medio AI</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-gray-900">{stats.avgScore}%</span>
                            <span className="text-xs text-gray-400">match</span>
                        </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300" />
                </div>

                {/* Conversion Rate */}
                <div
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => navigate('/leads')}
                >
                    <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                        <Zap className="w-6 h-6 text-purple-500" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs text-gray-500 font-medium">Tasso Conversione</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-gray-900">{stats.conversionRate}%</span>
                            <span className="text-xs text-gray-400">lead → email</span>
                        </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300" />
                </div>

                {/* Products */}
                <div
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => navigate('/products')}
                >
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-blue-500" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs text-gray-500 font-medium">Prodotti Attivi</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-gray-900">{products.length}</span>
                            <span className="text-xs text-gray-400">nel catalogo</span>
                        </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300" />
                </div>
            </div>

            {/* ═══════════════════════════════════════════════
                4. PRODUCT RECAP + 5. RECENT ACTIVITY (side by side)
            ═══════════════════════════════════════════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

                {/* Product Recap (3 cols) */}
                <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="flex items-center justify-between p-5 pb-3 border-b border-gray-50">
                        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            <Package className="w-4 h-4 text-teal-600" />
                            Prodotti & Lead Associati
                        </h2>
                        <button
                            onClick={() => navigate('/products')}
                            className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-0.5"
                        >
                            Vedi tutti <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {productsWithStats.length === 0 && (
                            <div className="p-8 text-center">
                                <Package className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                                <p className="text-sm text-gray-500">Nessun prodotto ancora.</p>
                                <button
                                    onClick={() => navigate('/products')}
                                    className="mt-2 text-xs text-teal-600 font-medium flex items-center gap-1 mx-auto"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Crea il primo
                                </button>
                            </div>
                        )}
                        {productsWithStats.map(p => (
                            <div
                                key={p.id}
                                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/50 transition-colors group cursor-pointer"
                                onClick={() => navigate('/products', { state: { openProductId: p.id } })}
                            >
                                <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                                    <Package className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                                    <div className="flex items-center gap-3 mt-0.5">
                                        <span className="text-xs text-gray-500">{p.leadCount} lead</span>
                                        <span className="text-xs text-gray-400">·</span>
                                        <span className="text-xs text-gray-500">{p.emailCount} email</span>
                                        {p.target_keywords && (
                                            <>
                                                <span className="text-xs text-gray-400">·</span>
                                                <span className="text-xs text-gray-400 truncate">{p.target_keywords.split(',').slice(0, 2).join(', ')}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); navigate('/search') }}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 text-teal-700 text-xs font-medium rounded-lg border border-teal-100 hover:bg-teal-100 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <Search className="w-3 h-3" /> Cerca
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Recent Activity (2 cols) */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-5 pb-3 border-b border-gray-50">
                        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-teal-600" />
                            Attività Recente
                        </h2>
                    </div>
                    <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                        {recentActivity.length === 0 && (
                            <div className="p-8 text-center">
                                <Activity className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                                <p className="text-sm text-gray-500">Nessuna attività ancora.</p>
                            </div>
                        )}
                        {recentActivity.map((act, i) => (
                            <div
                                key={i}
                                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/50 transition-colors cursor-pointer"
                                onClick={() => navigate(act.type === 'product' ? '/products' : '/leads')}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${act.color}`}>
                                    <act.icon className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-gray-800">{act.label}</p>
                                    <p className="text-xs text-gray-500 truncate">{act.detail}</p>
                                </div>
                                <span className="text-[10px] text-gray-400 flex-shrink-0">{formatActivityDate(act.date)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
