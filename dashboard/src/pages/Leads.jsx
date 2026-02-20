import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, Mail, Phone, MapPin, Trash2, Gauge, ChevronDown, ChevronUp, Radar, Globe, Send, Loader, X, Copy, CheckCircle, BarChart3, Calendar } from 'lucide-react'
import { getProductColor } from '../lib/colorUtils'
import { API_URL } from '../lib/api'

// Sub-component for Expandable Match Reason
const MatchReasonObj = ({ reason }) => {
    const [expanded, setExpanded] = useState(false)

    if (!reason || reason.length < 50) return <p className="text-xs text-gray-500 leading-snug">{reason}</p>

    return (
        <div onClick={() => setExpanded(!expanded)} className="cursor-pointer group">
            <p className={`text-xs text-gray-500 leading-snug ${expanded ? '' : 'line-clamp-2'} group-hover:text-gray-700 transition-colors`}>
                {reason}
            </p>
            <div className="text-[10px] text-teal-600 mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {expanded ? <><ChevronUp className="w-3 h-3" /> Riduci</> : <><ChevronDown className="w-3 h-3" /> Espandi</>}
            </div>
        </div>
    )
}

export default function Leads() {
    const [leads, setLeads] = useState([])
    const [loading, setLoading] = useState(true)
    const [pendingCount, setPendingCount] = useState(0)
    const [productsMap, setProductsMap] = useState({})

    // Bulk Selection State
    const [selectedLeads, setSelectedLeads] = useState([])

    // Modal State
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [leadToDelete, setLeadToDelete] = useState(null)

    // Email Generation State
    const [generatingEmail, setGeneratingEmail] = useState(null) // lead_id being generated
    const [emailModal, setEmailModal] = useState(null) // { lead, email } to show
    const [copied, setCopied] = useState(false)

    // Yellow highlight for new leads
    const [newLeadIds, setNewLeadIds] = useState(new Set())
    const knownLeadIdsRef = useRef(new Set())
    const newLeadTimerRef = useRef(null)

    // Real-time search progress
    const [searchProgress, setSearchProgress] = useState(null) // { progress, stats, status }
    const [searchMeta, setSearchMeta] = useState({}) // { jobId: { productName, location, quantity, productId... } }
    const searchPollRef = useRef(null)
    const dbRefreshRef = useRef(null)
    const searchJobIdRef = useRef([]) // array of active job IDs
    const jobFailCountRef = useRef({}) // { jobId: consecutiveFailCount }

    useEffect(() => {
        fetchProducts()
        fetchLeads(true) // initial load — mark all as known
        checkPendingScrapes()

        window.addEventListener('storage', checkPendingScrapes)

        // Use unique channel name to avoid subscription conflicts
        const channelName = `leads-realtime-${Date.now()}`
        const subscription = supabase
            .channel(channelName)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    const newLead = { ...payload.new }
                    console.log('📥 RT INSERT:', newLead.company_name, 'score:', newLead.match_score)
                    setProductsMap(currentMap => {
                        const productName = currentMap[newLead.interested_product_id]
                        newLead.products = productName ? { name: productName } : null
                        setLeads(prev => {
                            // Avoid duplicates
                            if (prev.some(l => l.id === newLead.id)) return prev
                            // Newest first (prepend)
                            return [newLead, ...prev]
                        })
                        return currentMap
                    })
                    // Mark as new for yellow highlight
                    setNewLeadIds(prev => {
                        const next = new Set(prev)
                        next.add(newLead.id)
                        return next
                    })
                    // Add to known IDs preventing double-count in poll
                    knownLeadIdsRef.current.add(newLead.id)

                    setPendingCount(prev => Math.max(0, prev - 1))
                    updateLocalStorageCount()
                    localStorage.setItem('lead_activity_timestamp', Date.now().toString())
                } else if (payload.eventType === 'UPDATE') {
                    setLeads(prev => prev.map(l => l.id === payload.new.id ? { ...l, ...payload.new } : l))
                } else if (payload.eventType === 'DELETE') {
                    setLeads(prev => prev.filter(l => l.id !== payload.old.id))
                    setSelectedLeads(prev => prev.filter(id => id !== payload.old.id))
                }
            })
            .subscribe((status) => {
                console.log('🔌 Supabase RT status:', status)
            })

        // Check for active search job
        checkActiveJob()
        window.addEventListener('storage', checkActiveJob)

        return () => {
            supabase.removeChannel(subscription)
            window.removeEventListener('storage', checkPendingScrapes)
            window.removeEventListener('storage', checkActiveJob)
            if (searchPollRef.current) clearInterval(searchPollRef.current)
            if (dbRefreshRef.current) clearInterval(dbRefreshRef.current)
            if (newLeadTimerRef.current) clearTimeout(newLeadTimerRef.current)
        }
    }, [])

    const fetchProducts = async () => {
        const { data } = await supabase.from('products').select('id, name')
        if (data) {
            const map = {}
            data.forEach(p => { map[p.id] = p.name })
            setProductsMap(map)
        }
    }

    const checkPendingScrapes = () => {
        const count = parseInt(localStorage.getItem('incoming_leads_count') || "0")
        if (count > 0) {
            // If no active jobs remain, clear stale pending count immediately
            const activeJobs = JSON.parse(localStorage.getItem('active_search_jobs') || '[]')
            if (activeJobs.length === 0) {
                localStorage.setItem('incoming_leads_count', '0')
                localStorage.removeItem('lead_activity_timestamp')
                setPendingCount(0)
                return
            }

            const timestamp = localStorage.getItem('lead_activity_timestamp')
            if (timestamp) {
                const minutesAgo = (Date.now() - parseInt(timestamp)) / 1000 / 60
                if (minutesAgo > 60) {
                    localStorage.setItem('incoming_leads_count', '0')
                    localStorage.removeItem('lead_activity_timestamp')
                    setPendingCount(0)
                    return
                }
            } else {
                localStorage.setItem('incoming_leads_count', '0')
                setPendingCount(0)
                return
            }
            setPendingCount(count)
        } else {
            setPendingCount(0)
        }
    }

    const updateLocalStorageCount = () => {
        const current = parseInt(localStorage.getItem('incoming_leads_count') || "0")
        if (current > 0) {
            localStorage.setItem('incoming_leads_count', Math.max(0, current - 1))
        }
    }

    useEffect(() => {
        const checkStuck = () => {
            const count = parseInt(localStorage.getItem('incoming_leads_count') || "0")
            if (count > 0) {
                const timestampStr = localStorage.getItem('lead_activity_timestamp')
                if (!timestampStr) {
                    localStorage.setItem('incoming_leads_count', '0')
                    setPendingCount(0)
                    return
                }
                const lastActivity = parseInt(timestampStr)
                const minutesSinceActivity = (Date.now() - lastActivity) / 1000 / 60
                if (minutesSinceActivity > 60) {
                    fetchLeads().then(() => {
                        localStorage.setItem('incoming_leads_count', '0')
                        setPendingCount(0)
                        localStorage.removeItem('lead_activity_timestamp')
                    })
                }
            }
        }

        checkStuck()
        const safetyInterval = setInterval(checkStuck, 10000)
        return () => clearInterval(safetyInterval)
    }, [])

    const fetchLeads = async (isInitial = false) => {
        if (isInitial) setLoading(true)
        try {
            const { data, error } = await supabase
                .from('leads')
                .select('*, products(name)')
                .order('created_at', { ascending: false })

            if (error) {
                console.error('❌ fetchLeads error:', error)
            }
            if (data) {

                if (isInitial) {
                    // On initial load, record all as "known" — no highlight
                    knownLeadIdsRef.current = new Set(data.map(l => l.id))
                } else {
                    // On refresh, find truly new leads
                    const freshIds = data
                        .filter(l => !knownLeadIdsRef.current.has(l.id))
                        .map(l => l.id)
                    if (freshIds.length > 0) {
                        setNewLeadIds(prev => {
                            const next = new Set(prev)
                            freshIds.forEach(id => next.add(id))
                            return next
                        })
                        // Add them to known so future refreshes don't re-highlight
                        freshIds.forEach(id => knownLeadIdsRef.current.add(id))

                        // Decrement pending count for these fresh leads (missed by realtime)
                        const currentPending = parseInt(localStorage.getItem('incoming_leads_count') || "0")
                        if (currentPending > 0) {
                            const newCount = Math.max(0, currentPending - freshIds.length)
                            localStorage.setItem('incoming_leads_count', newCount.toString())
                            setPendingCount(newCount)
                            if (newCount === 0) {
                                localStorage.removeItem('lead_activity_timestamp')
                            }
                        }

                        // Clear highlight after 30 seconds
                        if (newLeadTimerRef.current) clearTimeout(newLeadTimerRef.current)
                        newLeadTimerRef.current = setTimeout(() => {
                            setNewLeadIds(new Set())
                        }, 30000)
                    }
                }

                setLeads(data)
            }
        } catch (e) {
            console.error('❌ fetchLeads exception:', e)
        }
        if (isInitial) setLoading(false)
    }

    // ── Real-time search job tracking (multi-job) ──
    const checkActiveJob = () => {
        // Support both old single-job and new multi-job localStorage
        const oldJobId = localStorage.getItem('active_search_job_id')
        const jobsJson = localStorage.getItem('active_search_jobs')
        let activeJobIds = []

        if (jobsJson) {
            try { activeJobIds = JSON.parse(jobsJson) } catch { activeJobIds = [] }
        }
        // Backwards compat: migrate old single key
        if (oldJobId && !activeJobIds.includes(oldJobId)) {
            activeJobIds.push(oldJobId)
            localStorage.setItem('active_search_jobs', JSON.stringify(activeJobIds))
            localStorage.removeItem('active_search_job_id')
        }

        // --- NEW: Load Metadata for Previews ---
        const meta = JSON.parse(localStorage.getItem('active_search_meta') || '{}')
        setSearchMeta(meta)

        const currentTracked = searchJobIdRef.current || []
        const currentSet = new Set(currentTracked)
        const newSet = new Set(activeJobIds)

        // Start polling if we have new jobs
        if (activeJobIds.length > 0 && (activeJobIds.length !== currentTracked.length || activeJobIds.some(id => !currentSet.has(id)))) {
            searchJobIdRef.current = [...activeJobIds]
            startMultiJobPolling(activeJobIds)
        } else if (activeJobIds.length === 0 && currentTracked.length > 0) {
            searchJobIdRef.current = []
            setSearchProgress(null)
            if (searchPollRef.current) {
                clearInterval(searchPollRef.current)
                searchPollRef.current = null
            }
            // Clean up stale pending count when no jobs remain
            const pendingRemaining = parseInt(localStorage.getItem('incoming_leads_count') || '0')
            if (pendingRemaining > 0) {
                localStorage.setItem('incoming_leads_count', '0')
                localStorage.removeItem('lead_activity_timestamp')
                setPendingCount(0)
            }
            fetchLeads()
        }
    }

    const startMultiJobPolling = (jobIds) => {
        if (searchPollRef.current) clearInterval(searchPollRef.current)

        // DB refresh failsafe
        if (dbRefreshRef.current) clearInterval(dbRefreshRef.current)
        dbRefreshRef.current = setInterval(() => { fetchLeads() }, 5000)

        // Track discarded counts to decrement pending rows
        let lastDiscardedByJob = {}

        searchPollRef.current = setInterval(async () => {
            const currentJobs = JSON.parse(localStorage.getItem('active_search_jobs') || '[]')
            if (currentJobs.length === 0) {
                clearInterval(searchPollRef.current)
                searchPollRef.current = null
                if (dbRefreshRef.current) { clearInterval(dbRefreshRef.current); dbRefreshRef.current = null }
                setSearchProgress(null)
                searchJobIdRef.current = []
                localStorage.setItem('incoming_leads_count', '0')
                setPendingCount(0)
                fetchLeads()
                return
            }

            // Poll all active jobs
            let aggregatedStats = { analyzed: 0, accepted: 0, discarded: 0, below_threshold: 0, avg_score: 0 }
            let latestProgress = ''
            let allCompleted = true
            let hasError = false
            let totalScores = 0
            let scoreCount = 0

            const staleJobIds = []
            for (const jid of currentJobs) {
                try {
                    const res = await fetch(`${API_URL}/search-status/${jid}`)
                    if (!res.ok) {
                        jobFailCountRef.current[jid] = (jobFailCountRef.current[jid] || 0) + 1
                        if (jobFailCountRef.current[jid] >= 3) {
                            hasError = true
                            staleJobIds.push(jid)
                        } else {
                            allCompleted = false
                        }
                        continue
                    }
                    jobFailCountRef.current[jid] = 0
                    const data = await res.json()

                    if (data.status === 'running') allCompleted = false
                    if (data.status === 'error') hasError = true

                    if (data.stats) {
                        aggregatedStats.analyzed += data.stats.analyzed || 0
                        aggregatedStats.accepted += data.stats.accepted || 0
                        aggregatedStats.discarded += data.stats.discarded || 0
                        aggregatedStats.below_threshold += data.stats.below_threshold || 0
                        if (data.stats.avg_score > 0) {
                            totalScores += data.stats.avg_score
                            scoreCount++
                        }

                        // Handle discarded delta for pending count
                        const currentDiscarded = data.stats.discarded || 0
                        const prevDiscarded = lastDiscardedByJob[jid] || 0
                        const delta = currentDiscarded - prevDiscarded

                        if (delta > 0) {
                            const currentPending = parseInt(localStorage.getItem('incoming_leads_count') || "0")
                            if (currentPending > 0) {
                                const newCount = Math.max(0, currentPending - delta)
                                localStorage.setItem('incoming_leads_count', newCount.toString())
                                setPendingCount(newCount)
                                if (newCount === 0) {
                                    localStorage.removeItem('lead_activity_timestamp')
                                }
                            }
                        }
                        lastDiscardedByJob[jid] = currentDiscarded
                    }

                    // Show the progress of whichever job is currently active
                    if (data.status === 'running' && data.progress) {
                        latestProgress = data.progress
                    }
                } catch {
                    jobFailCountRef.current[jid] = (jobFailCountRef.current[jid] || 0) + 1
                    if (jobFailCountRef.current[jid] >= 3) {
                        hasError = true
                        staleJobIds.push(jid)
                    } else {
                        allCompleted = false
                    }
                }
            }

            // Remove stale (404) jobs from localStorage
            if (staleJobIds.length > 0) {
                const activeJobs = JSON.parse(localStorage.getItem('active_search_jobs') || '[]')
                const filtered = activeJobs.filter(id => !staleJobIds.includes(id))
                localStorage.setItem('active_search_jobs', JSON.stringify(filtered))
                const meta = JSON.parse(localStorage.getItem('active_search_meta') || '{}')
                staleJobIds.forEach(id => {
                    delete meta[id]
                    delete jobFailCountRef.current[id]
                })
                localStorage.setItem('active_search_meta', JSON.stringify(meta))
                window.dispatchEvent(new Event("storage"))
            }

            aggregatedStats.avg_score = scoreCount > 0 ? Math.round(totalScores / scoreCount) : 0

            setSearchProgress({
                status: allCompleted ? (hasError ? 'error' : 'completed') : 'running',
                progress: latestProgress || (allCompleted ? 'Tutte le ricerche completate!' : 'Elaborazione in corso...'),
                stats: aggregatedStats,
                jobCount: currentJobs.length
            })

            if (allCompleted) {
                clearInterval(searchPollRef.current)
                searchPollRef.current = null
                if (dbRefreshRef.current) { clearInterval(dbRefreshRef.current); dbRefreshRef.current = null }
                // Force-cleanup ALL pending state — skeleton rows must disappear
                localStorage.setItem('active_search_jobs', '[]')
                localStorage.setItem('active_search_meta', '{}')
                localStorage.setItem('incoming_leads_count', '0')
                localStorage.removeItem('lead_activity_timestamp')
                setPendingCount(0)
                setSearchMeta({})
                searchJobIdRef.current = []
                fetchLeads()
                window.dispatchEvent(new Event("storage"))

                setTimeout(() => { setSearchProgress(null) }, 6000)
            }
        }, 2000)
    }

    // --- Email Generation ---
    const handleGenerateEmail = async (lead) => {
        // Check if already generated
        if (lead.generated_email) {
            try {
                const emailData = JSON.parse(lead.generated_email)
                setEmailModal({ lead, email: emailData })
            } catch {
                setEmailModal({ lead, email: { subject: '', body: lead.generated_email } })
            }
            return
        }

        setGeneratingEmail(lead.id)
        try {
            const response = await fetch('${API_URL}/generate-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead_id: lead.id })
            })

            const data = await response.json()

            if (data.status === 'completed' && data.email) {
                // Update local state
                setLeads(prev => prev.map(l =>
                    l.id === lead.id
                        ? { ...l, generated_email: JSON.stringify(data.email) }
                        : l
                ))
                setEmailModal({ lead, email: data.email })
            } else {
                alert('Errore: ' + (data.message || 'Generazione fallita'))
            }
        } catch (err) {
            alert('Errore di connessione: ' + err.message)
        } finally {
            setGeneratingEmail(null)
        }
    }

    const copyEmailToClipboard = (email) => {
        const text = `Oggetto: ${email.subject}\n\n${email.body}`
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    // --- Bulk Selection ---
    const toggleSelectAll = () => {
        if (selectedLeads.length === leads.length) {
            setSelectedLeads([])
        } else {
            setSelectedLeads(leads.map(l => l.id))
        }
    }

    const toggleSelectOne = (id) => {
        if (selectedLeads.includes(id)) {
            setSelectedLeads(prev => prev.filter(item => item !== id))
        } else {
            setSelectedLeads(prev => [...prev, id])
        }
    }

    const RequestDelete = (id) => {
        setLeadToDelete(id)
        setShowDeleteModal(true)
    }

    const RequestBulkDelete = () => {
        setLeadToDelete('BULK')
        setShowDeleteModal(true)
    }

    const confirmDelete = async () => {
        if (!leadToDelete) return

        let error = null

        if (leadToDelete === 'BULK') {
            const res = await supabase.from('leads').delete().in('id', selectedLeads)
            error = res.error
            if (!error) {
                setLeads(prev => prev.filter(l => !selectedLeads.includes(l.id)))
                setSelectedLeads([])
            }
        } else {
            const res = await supabase.from('leads').delete().eq('id', leadToDelete)
            error = res.error
            if (!error) {
                setLeads(prev => prev.filter(l => l.id !== leadToDelete))
            }
        }

        if (error) {
            alert("Errore durante l'eliminazione: " + error.message)
        }

        setShowDeleteModal(false)
        setLeadToDelete(null)
    }

    const formatDate = (dateString) => {
        if (!dateString) return ""
        const date = new Date(dateString)
        return new Intl.DateTimeFormat('it-IT', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }).format(date)
    }

    const getScoreColor = (score) => {
        if (!score) return "bg-gray-100 text-gray-500"
        if (score >= 66) return "bg-green-100 text-green-700 border-green-200"
        if (score >= 34) return "bg-amber-100 text-amber-700 border-amber-200"
        return "bg-red-50 text-red-600 border-red-100"
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 relative">
            <header className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold text-gray-800">Tutti i Contatti</h1>

                    {selectedLeads.length > 0 && (
                        <button
                            onClick={RequestBulkDelete}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors animate-in fade-in slide-in-from-left-2"
                        >
                            <Trash2 className="w-4 h-4" />
                            Elimina ({selectedLeads.length}) selezionati
                        </button>
                    )}
                </div>

                <div className="text-sm text-gray-500">
                    Totale: <span className="font-bold text-teal-600">{leads.length}</span>
                    {pendingCount > 0 && (
                        <div className="inline-flex items-center gap-2 ml-2">
                            <span className="text-orange-500 animate-pulse">({pendingCount} in arrivo...)</span>
                            <button
                                onClick={() => {
                                    localStorage.setItem('incoming_leads_count', '0')
                                    localStorage.setItem('active_search_jobs', '[]')
                                    localStorage.setItem('active_search_meta', '{}')
                                    localStorage.removeItem('lead_activity_timestamp')
                                    setPendingCount(0)
                                    setSearchProgress(null)
                                    searchJobIdRef.current = []
                                    if (searchPollRef.current) clearInterval(searchPollRef.current)
                                    window.dispatchEvent(new Event("storage"))
                                }}
                                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-500 px-2 py-1 rounded-md transition-colors"
                                title="Interrompi e pulisci ricerca"
                            >
                                Interrompi
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Search in progress banner — real-time AI details */}
            {(pendingCount > 0 || searchProgress) && (
                <div className={`rounded-xl overflow-hidden text-white shadow-lg animate-in fade-in slide-in-from-top-4 ${searchProgress?.status === 'completed'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 shadow-green-200/50'
                    : searchProgress?.status === 'error'
                        ? 'bg-gradient-to-r from-red-500 to-red-600 shadow-red-200/50'
                        : 'bg-gradient-to-r from-teal-600 via-teal-500 to-emerald-500 shadow-teal-200/50'
                    }`}>
                    <div className="p-4 space-y-3">
                        {/* Row 1: Icon + Status + Stats badges */}
                        <div className="flex items-center gap-4">
                            <div className="relative flex-shrink-0">
                                {searchProgress?.status === 'completed'
                                    ? <CheckCircle className="w-8 h-8" />
                                    : searchProgress?.status === 'error'
                                        ? <X className="w-8 h-8" />
                                        : <><Radar className="w-8 h-8 animate-pulse" />
                                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-ping" /></>
                                }
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm">
                                    {searchProgress?.status === 'completed' ? 'Ricerca completata!' : searchProgress?.status === 'error' ? 'Errore nella ricerca' : 'Analisi AI in corso...'}
                                    {searchProgress?.jobCount > 1 && searchProgress?.status === 'running' && (
                                        <span className="ml-2 text-xs font-normal bg-white/20 px-2 py-0.5 rounded-full">{searchProgress.jobCount} ricerche attive</span>
                                    )}
                                </p>
                            </div>
                            {searchProgress?.stats ? (
                                <div className="flex gap-2 flex-shrink-0">
                                    <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[60px]">
                                        <span className="text-sm font-bold block">{searchProgress.stats.analyzed}</span>
                                        <span className="text-[10px] text-white/70">Analizzati</span>
                                    </div>
                                    <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[60px]">
                                        <span className="text-sm font-bold block">{searchProgress.stats.accepted}</span>
                                        <span className="text-[10px] text-white/70">Accettati</span>
                                    </div>
                                    {searchProgress.stats.below_threshold > 0 && (
                                        <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[60px]">
                                            <span className="text-sm font-bold block">{searchProgress.stats.below_threshold}</span>
                                            <span className="text-[10px] text-white/70">Sotto Soglia</span>
                                        </div>
                                    )}
                                    <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[60px]">
                                        <span className="text-sm font-bold block">{searchProgress.stats.discarded}</span>
                                        <span className="text-[10px] text-white/70">Scartati</span>
                                    </div>
                                    <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[60px]">
                                        <span className="text-sm font-bold block">{searchProgress.stats.avg_score}%</span>
                                        <span className="text-[10px] text-white/70">Score</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-shrink-0 bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-lg">
                                    <span className="text-sm font-bold">{pendingCount}</span>
                                    <span className="text-xs text-white/70 ml-1">in arrivo</span>
                                </div>
                            )}
                        </div>
                        {/* Row 2: Live activity detail — what AI is doing right now */}
                        {searchProgress?.progress && searchProgress?.status !== 'completed' && searchProgress?.status !== 'error' && (
                            <div className="bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-white/60 flex-shrink-0 animate-pulse" />
                                <p className="text-sm text-white/90 truncate">{searchProgress.progress}</p>
                            </div>
                        )}
                    </div>
                    {/* Progress bar */}
                    {searchProgress?.stats && searchProgress?.status !== 'completed' && searchProgress?.status !== 'error' && (
                        <div className="h-1.5 bg-white/10">
                            <div
                                className="h-full bg-white/50 transition-all duration-500 ease-out"
                                style={{ width: `${Math.min(100, ((searchProgress.stats.accepted + searchProgress.stats.discarded) / Math.max(1, Object.values(searchMeta).reduce((sum, m) => sum + (m.quantity || 0), 0) || searchProgress.stats.analyzed)) * 100)}%` }}
                            />
                        </div>
                    )}
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-3 py-2.5 w-10">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                                    checked={leads.length > 0 && selectedLeads.length === leads.length}
                                    onChange={toggleSelectAll}
                                />
                            </th>
                            <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Azienda</th>
                            <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Matching AI</th>
                            <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contatto</th>
                            <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Sito Web</th>
                            <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Interesse</th>
                            <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {/* PREVIEW ROWS — showing incoming leads context, distributed across active jobs */}
                        {pendingCount > 0 && (() => {
                            const activeJobs = Object.entries(searchMeta)
                                .map(([id, m]) => ({ id, ...m }))
                                .sort((a, b) => b.timestamp - a.timestamp)

                            // Distribute skeleton rows proportionally across active jobs
                            const totalQuantity = activeJobs.reduce((sum, j) => sum + (j.quantity || 0), 0)
                            let rows = []
                            let remaining = pendingCount

                            for (let jobIdx = 0; jobIdx < activeJobs.length && remaining > 0; jobIdx++) {
                                const job = activeJobs[jobIdx]
                                const jobRows = jobIdx === activeJobs.length - 1
                                    ? remaining  // last job gets all remaining
                                    : Math.max(1, Math.round((job.quantity / Math.max(1, totalQuantity)) * pendingCount))
                                const count = Math.min(jobRows, remaining)
                                remaining -= count

                                for (let i = 0; i < count; i++) {
                                    rows.push(
                                        <tr key={`preview-${job.id}-${i}`} className="bg-teal-50/5 border-b border-gray-50/50">
                                            <td className="px-3 py-2.5">
                                                <div className="w-4 h-4 rounded border border-gray-100 bg-gray-50 animate-pulse"></div>
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center flex-shrink-0 animate-pulse">
                                                        <Radar className="w-5 h-5 text-teal-500 animate-spin" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-medium text-gray-900 flex items-center gap-2 animate-pulse">
                                                            Ricerca: {job.productName}
                                                        </div>
                                                        <div className="text-xs text-gray-500 flex items-center gap-1 animate-pulse">
                                                            {job.location && <><MapPin className="w-3 h-3" /> {job.location}</>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5 w-1/5">
                                                <div className="space-y-1 opacity-50">
                                                    <div className="h-4 bg-gray-100 rounded w-20 animate-pulse"></div>
                                                    <div className="h-3 bg-gray-50 rounded w-full animate-pulse"></div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5"><div className="h-4 w-24 bg-gray-50 rounded animate-pulse"></div></td>
                                            <td className="px-3 py-2.5"><div className="h-4 w-20 bg-gray-50 rounded animate-pulse"></div></td>
                                            <td className="px-3 py-2.5">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getProductColor(job.productId)} opacity-60 animate-pulse`}>
                                                    {job.productName}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                                <div className="h-8 w-8 bg-gray-50 rounded ml-auto animate-pulse"></div>
                                            </td>
                                        </tr>
                                    )
                                }
                            }

                            // Fallback: if no metadata available, show generic skeletons
                            if (rows.length === 0) {
                                rows = Array.from({ length: pendingCount }).map((_, i) => (
                                    <tr key={`preview-${i}`} className="bg-teal-50/5 border-b border-gray-50/50">
                                        <td className="px-3 py-2.5"><div className="w-4 h-4 rounded border border-gray-100 bg-gray-50 animate-pulse"></div></td>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center flex-shrink-0 animate-pulse">
                                                    <Radar className="w-5 h-5 text-teal-500 animate-spin" />
                                                </div>
                                                <div className="text-sm font-medium text-gray-900 animate-pulse">Ricerca in corso...</div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 w-1/5"><div className="h-4 bg-gray-100 rounded w-20 animate-pulse"></div></td>
                                        <td className="px-3 py-2.5"><div className="h-4 w-24 bg-gray-50 rounded animate-pulse"></div></td>
                                        <td className="px-3 py-2.5"><div className="h-4 w-20 bg-gray-50 rounded animate-pulse"></div></td>
                                        <td className="px-3 py-2.5"><div className="h-5 rounded-full w-20 bg-gray-50 animate-pulse"></div></td>
                                        <td className="px-3 py-2.5 text-right"><div className="h-8 w-8 bg-gray-50 rounded ml-auto animate-pulse"></div></td>
                                    </tr>
                                ))
                            }

                            return rows
                        })()}
                        {/* REAL LEADS (newest first, below skeletons) */}
                        {leads.map((lead) => (
                            <tr key={lead.id} className={`hover:bg-gray-50 transition-all duration-500 group ${selectedLeads.includes(lead.id) ? 'bg-teal-50/30' : newLeadIds.has(lead.id) ? 'lead-enter border-l-2 border-l-amber-400' : ''}`}>
                                <td className="px-3 py-2.5">
                                    <input
                                        type="checkbox"
                                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                                        checked={selectedLeads.includes(lead.id)}
                                        onChange={() => toggleSelectOne(lead.id)}
                                    />
                                </td>
                                <td className="px-3 py-2.5">
                                    <div className="flex items-center">
                                        <div className="flex-shrink-0 h-9 w-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600">
                                            <Building2 className="h-4 w-4" />
                                        </div>
                                        <div className="ml-3">
                                            <div className="text-sm font-medium text-gray-900">{lead.company_name}</div>
                                            <div className="text-xs text-gray-500 flex items-center gap-1">
                                                <MapPin className="w-3 h-3" /> {lead.location || "N/A"}
                                            </div>
                                            {lead.created_at && (
                                                <div className="text-gray-400 mt-0.5" style={{ fontSize: '10px' }}>{formatDate(lead.created_at)}</div>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 w-1/5">
                                    {lead.match_score !== null ? (
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold border ${getScoreColor(lead.match_score)}`}>
                                                    {lead.match_score}% MATCH
                                                </span>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${lead.match_score >= 66
                                                    ? 'bg-green-50 text-green-600'
                                                    : lead.match_score >= 34
                                                        ? 'bg-amber-50 text-amber-600'
                                                        : 'bg-red-50 text-red-500'
                                                    }`}>
                                                    {lead.match_score >= 66 ? 'ALTA' : lead.match_score >= 34 ? 'MEDIA' : 'BASSA'}
                                                </span>
                                            </div>
                                            <MatchReasonObj reason={lead.match_reason || "Nessuna descrizione disponibile."} />
                                        </div>
                                    ) : (
                                        <span className="text-xs text-gray-400 italic flex items-center gap-1">
                                            <Gauge className="w-3 h-3 animate-spin duration-1000" /> Analisi AI...
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5">
                                    <div className="text-sm text-gray-900">
                                        {lead.email ? (
                                            <div className="flex items-center gap-1.5">
                                                <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                                <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline text-xs truncate max-w-[160px]">{lead.email}</a>
                                            </div>
                                        ) : lead.phone ? (
                                            <div className="flex items-center gap-1.5">
                                                <Phone className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                                                <a href={`tel:${lead.phone}`} className="text-emerald-700 hover:underline text-xs">{lead.phone}</a>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1.5">
                                                <Mail className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                                                <span className="text-gray-400 italic text-xs">Mancante</span>
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-3 py-2.5">
                                    {lead.website ? (
                                        <a
                                            href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate max-w-[150px]"
                                        >
                                            <Globe className="w-3 h-3 flex-shrink-0" />
                                            {lead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                                        </a>
                                    ) : (
                                        <span className="text-xs text-gray-400 italic">N/A</span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getProductColor(lead.interested_product_id)}`}>
                                        {lead.products?.name || "Generico"}
                                    </span>
                                </td>

                                <td className="px-3 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <button
                                            onClick={() => handleGenerateEmail(lead)}
                                            disabled={generatingEmail === lead.id}
                                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${lead.generated_email
                                                ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                                : generatingEmail === lead.id
                                                    ? 'bg-gray-100 text-gray-400'
                                                    : 'bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100'
                                                }`}
                                            title={lead.generated_email ? "Vedi email generata" : "Genera email di presentazione"}
                                        >
                                            {generatingEmail === lead.id ? (
                                                <><Loader className="w-3 h-3 animate-spin" /> Genero...</>
                                            ) : lead.generated_email ? (
                                                <><CheckCircle className="w-3 h-3" /> Vedi Mail</>
                                            ) : (
                                                <><Send className="w-3 h-3" /> Genera Mail</>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => RequestDelete(lead.id)}
                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Elimina Contatto"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!loading && leads.length === 0 && pendingCount === 0 && (
                            <tr>
                                <td colSpan={7} className="px-6 py-10 text-center text-gray-500 italic">
                                    Nessun lead trovato finora. Lancia una ricerca!
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Email Modal */}
            {emailModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEmailModal(null)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                    <Send className="w-5 h-5 text-teal-600" />
                                    Email Generata
                                </h3>
                                <p className="text-sm text-gray-500 mt-0.5">{emailModal.lead.company_name}</p>
                            </div>
                            <button onClick={() => setEmailModal(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* Subject */}
                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Oggetto</label>
                                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm font-medium text-gray-900">
                                    {emailModal.email.subject}
                                </div>
                            </div>

                            {/* Hook (if present) */}
                            {emailModal.email.hook && (
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Hook Personalizzato</label>
                                    <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 text-sm text-teal-800 italic">
                                        {emailModal.email.hook}
                                    </div>
                                </div>
                            )}

                            {/* Body */}
                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Testo Email</label>
                                <div className="p-4 bg-white rounded-lg border border-gray-200 text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                                    {emailModal.email.body}
                                </div>
                            </div>

                            {/* Recipient info */}
                            {emailModal.lead.email && (
                                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <Mail className="w-4 h-4 text-blue-600" />
                                    <span className="text-sm text-blue-700">
                                        Destinatario: <a href={`mailto:${emailModal.lead.email}`} className="font-medium underline">{emailModal.lead.email}</a>
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="p-4 border-t border-gray-100 flex gap-2">
                            <button
                                onClick={() => copyEmailToClipboard(emailModal.email)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                            >
                                {copied ? <><CheckCircle className="w-4 h-4 text-green-600" /> Copiato!</> : <><Copy className="w-4 h-4" /> Copia Email</>}
                            </button>
                            {emailModal.lead.email && (
                                <a
                                    href={`mailto:${emailModal.lead.email}?subject=${encodeURIComponent(emailModal.email.subject)}&body=${encodeURIComponent(emailModal.email.body)}`}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                                >
                                    <Send className="w-4 h-4" /> Apri in Mail
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 text-center space-y-4 animate-in fade-in zoom-in duration-200">
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                            <Trash2 className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">Sei sicuro?</h3>
                            <p className="text-sm text-red-600 mt-2 font-medium">
                                {leadToDelete === 'BULK'
                                    ? `Vuoi davvero eliminare TUTTI i ${selectedLeads.length} contatti selezionati?`
                                    : "Vuoi davvero eliminare questo contatto?"
                                }
                                <br />
                                Questa azione non puo' essere annullata.
                            </p>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setShowDeleteModal(false)}
                                className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-red-200"
                            >
                                {leadToDelete === 'BULK' ? 'Si, Elimina Tutti' : 'Si, Elimina'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
