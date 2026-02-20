import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
    Search, Sparkles, Radar, ArrowRight, CheckCircle,
    Shield, XCircle, BarChart3, Building2, Globe, Gauge, ChevronDown, ChevronUp, X, MapPin
} from 'lucide-react'
import { italianCities, regions } from '../data/italianCities'
import { API_URL } from '../lib/api'

export default function SmartSearch() {
    const [products, setProducts] = useState([])
    const [selectedProduct, setSelectedProduct] = useState('')
    const [location, setLocation] = useState('Milano')
    const [includeProvince, setIncludeProvince] = useState(true)
    const [quantity, setQuantity] = useState(10)
    const [minScore, setMinScore] = useState(50)

    const [showLocationDropdown, setShowLocationDropdown] = useState(false)
    const [locationHighlight, setLocationHighlight] = useState(-1)
    const locationInputRef = useRef(null)
    const locationDropdownRef = useRef(null)

    const locationSuggestions = useMemo(() => {
        const q = location.trim().toLowerCase()
        if (q.length < 2) return []
        const results = []
        // Search cities
        for (const item of italianCities) {
            if (item.city.toLowerCase().startsWith(q)) {
                results.push({ city: item.city, region: item.region, country: 'Italia' })
            }
            if (results.length >= 8) break
        }
        // Also match cities containing the query (if not enough startsWith matches)
        if (results.length < 8) {
            for (const item of italianCities) {
                if (!item.city.toLowerCase().startsWith(q) && item.city.toLowerCase().includes(q)) {
                    results.push({ city: item.city, region: item.region, country: 'Italia' })
                }
                if (results.length >= 8) break
            }
        }
        // Also match by region name
        if (results.length < 8) {
            for (const r of regions) {
                if (r.toLowerCase().startsWith(q)) {
                    results.push({ city: r, region: r, country: 'Italia', isRegion: true })
                }
                if (results.length >= 8) break
            }
        }
        return results
    }, [location])

    // Multi-search queue
    const [jobs, setJobs] = useState([]) // [{ id, productName, location, quantity, minScore, status, progress, stats, results, showDiscarded }]
    const jobsRef = useRef([])
    const pollRef = useRef(null)
    const failCountRef = useRef({}) // { jobId: consecutiveFailCount }

    // Close location dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (locationDropdownRef.current && !locationDropdownRef.current.contains(e.target) &&
                locationInputRef.current && !locationInputRef.current.contains(e.target)) {
                setShowLocationDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
        fetchProducts()

        // Restore active jobs from localStorage logic
        const activeIds = JSON.parse(localStorage.getItem('active_search_jobs') || '[]')
        const meta = JSON.parse(localStorage.getItem('active_search_meta') || '{}')

        if (activeIds.length > 0) {
            const restoredJobs = activeIds.map(id => {
                const m = meta[id] || {}
                return {
                    id,
                    productName: m.productName || 'Ricerca in corso...',
                    location: m.location || '',
                    quantity: m.quantity || 10,
                    minScore: m.minScore || 50,
                    status: 'running',
                    progress: 'Riprendo monitoraggio...',
                    stats: null,
                    results: null,
                    showDiscarded: false
                }
            })
            // Filter out duplicates if any exist in state (unlikely on mount but safe)
            setJobs(prev => {
                const existingIds = new Set(prev.map(j => j.id))
                const newJobs = restoredJobs.filter(j => !existingIds.has(j.id))
                return [...prev, ...newJobs]
            })
        }

        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [])

    // Keep jobsRef in sync with jobs state
    useEffect(() => {
        jobsRef.current = jobs
    }, [jobs])

    // Start/stop polling based on active jobs
    useEffect(() => {
        const hasRunning = jobs.some(j => j.status === 'running')
        if (hasRunning && !pollRef.current) {
            pollRef.current = setInterval(pollAllJobs, 2000)
        } else if (!hasRunning && pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
        }
    }, [jobs])

    const fetchProducts = async () => {
        const { data } = await supabase.from('products').select('*')
        if (data) setProducts(data)
    }

    const pollAllJobs = async () => {
        const currentJobs = jobsRef.current
        const runningJobs = currentJobs.filter(j => j.status === 'running')
        if (runningJobs.length === 0) return

        // Fetch all statuses outside of setState (no side-effects in updater)
        const updates = []
        for (const job of runningJobs) {
            try {
                const res = await fetch(`${API_URL}/search-status/${job.id}`)
                if (!res.ok) {
                    failCountRef.current[job.id] = (failCountRef.current[job.id] || 0) + 1
                    if (failCountRef.current[job.id] >= 3) {
                        updates.push({ id: job.id, data: { status: 'error', progress: 'Job perso (server riavviato?)' } })
                    }
                    continue
                }
                failCountRef.current[job.id] = 0
                const data = await res.json()
                updates.push({ id: job.id, data })
            } catch {
                failCountRef.current[job.id] = (failCountRef.current[job.id] || 0) + 1
                if (failCountRef.current[job.id] >= 3) {
                    updates.push({ id: job.id, data: { status: 'error', progress: 'Connessione persa' } })
                }
            }
        }

        if (updates.length === 0) return

        // Perform localStorage cleanup for completed/error jobs
        const finishedIds = updates
            .filter(u => u.data.status === 'completed' || u.data.status === 'error')
            .map(u => u.id)

        if (finishedIds.length > 0) {
            const activeJobs = JSON.parse(localStorage.getItem('active_search_jobs') || '[]')
            const filtered = activeJobs.filter(id => !finishedIds.includes(id))
            localStorage.setItem('active_search_jobs', JSON.stringify(filtered))

            const meta = JSON.parse(localStorage.getItem('active_search_meta') || '{}')
            finishedIds.forEach(id => delete meta[id])
            localStorage.setItem('active_search_meta', JSON.stringify(meta))

            window.dispatchEvent(new Event("storage"))

            // Clean up fail counters for finished jobs
            finishedIds.forEach(id => delete failCountRef.current[id])
        }

        // Single setState call with all updates
        setJobs(prev => prev.map(j => {
            const update = updates.find(u => u.id === j.id)
            if (!update) return j
            const { data } = update
            return {
                ...j,
                progress: data.progress || j.progress,
                stats: data.stats || j.stats,
                status: data.status === 'completed' ? 'completed' : data.status === 'error' ? 'error' : j.status,
                results: {
                    accepted: data.accepted || j.results?.accepted || [],
                    discarded: data.discarded || j.results?.discarded || [],
                    below_threshold: data.below_threshold || j.results?.below_threshold || [],
                    stats: data.stats || j.results?.stats || {}
                }
            }
        }))
    }

    const handleSearch = async () => {
        if (!selectedProduct) return

        const productName = products.find(p => p.id === selectedProduct)?.name || 'Prodotto'

        try {
            const response = await fetch('${API_URL}/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: selectedProduct,
                    location: location,
                    limit: quantity,
                    min_score: minScore,
                    include_province: includeProvince
                })
            })

            if (!response.ok) throw new Error('API Request failed')

            const data = await response.json()
            const newJobId = data.job_id

            if (!newJobId) throw new Error('No job ID returned')

            // Signal Leads page: add to pending count (AFTER API confirms job started)
            const currentCount = parseInt(localStorage.getItem('incoming_leads_count') || "0")
            localStorage.setItem('incoming_leads_count', (currentCount + quantity).toString())
            localStorage.setItem('lead_activity_timestamp', Date.now().toString())
            window.dispatchEvent(new Event("storage"))

            // Add to localStorage array for Leads page
            const activeJobs = JSON.parse(localStorage.getItem('active_search_jobs') || '[]')
            activeJobs.push(newJobId)
            localStorage.setItem('active_search_jobs', JSON.stringify(activeJobs))

            // Add metadata for preview
            const meta = JSON.parse(localStorage.getItem('active_search_meta') || '{}')
            meta[newJobId] = {
                productName,
                location,
                quantity,
                minScore,
                productId: selectedProduct,
                timestamp: Date.now()
            }
            localStorage.setItem('active_search_meta', JSON.stringify(meta))

            window.dispatchEvent(new Event("storage"))

            // Add job to queue
            setJobs(prev => [{
                id: newJobId,
                productName,
                location,
                quantity,
                minScore,
                status: 'running',
                progress: 'Avvio ricerca...',
                stats: null,
                results: null,
                showDiscarded: false
            }, ...prev])

        } catch (error) {
            setJobs(prev => [{
                id: `error-${Date.now()}`,
                productName: products.find(p => p.id === selectedProduct)?.name || 'Prodotto',
                location,
                quantity,
                minScore,
                status: 'error',
                progress: error.message,
                stats: null,
                results: null,
                showDiscarded: false
            }, ...prev])
        }
    }

    const removeJob = (jobId) => {
        setJobs(prev => prev.filter(j => j.id !== jobId))
    }

    const toggleDiscarded = (jobId) => {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, showDiscarded: !j.showDiscarded } : j))
    }

    const toggleBelowThreshold = (jobId) => {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, showBelowThreshold: !j.showBelowThreshold } : j))
    }

    const isSearching = jobs.some(j => j.status === 'running')

    const getScoreBadge = (score) => {
        if (score >= 66) return 'bg-green-100 text-green-700'
        if (score >= 34) return 'bg-amber-100 text-amber-700'
        return 'bg-red-100 text-red-700'
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <header className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl text-white shadow-lg shadow-teal-200/50">
                        <Search className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Ricerca Smart</h1>
                        <p className="text-sm text-gray-500">Trova e qualifica i lead piu' affini al tuo prodotto</p>
                    </div>
                </div>
                {isSearching && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-lg">
                        <Radar className="w-4 h-4 text-teal-600 animate-pulse" />
                        <span className="text-sm font-medium text-teal-700">{jobs.filter(j => j.status === 'running').length} ricerche attive</span>
                    </div>
                )}
            </header>

            {/* ── Control Panel ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
                <div className="grid grid-cols-12 gap-4 items-end">
                    <div className="col-span-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">1. Seleziona Prodotto</label>
                        <select
                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-teal-500 focus:ring-teal-500 bg-gray-50 p-2.5 border"
                            value={selectedProduct}
                            onChange={(e) => setSelectedProduct(e.target.value)}
                        >
                            <option value="">-- Seleziona --</option>
                            {products.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="col-span-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">2. Zona Target</label>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <input
                                    ref={locationInputRef}
                                    type="text"
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-teal-500 focus:ring-teal-500 bg-gray-50 p-2.5 border"
                                    value={location}
                                    onChange={(e) => {
                                        setLocation(e.target.value)
                                        setShowLocationDropdown(true)
                                        setLocationHighlight(-1)
                                    }}
                                    onFocus={() => setShowLocationDropdown(true)}
                                    onKeyDown={(e) => {
                                        if (!showLocationDropdown || locationSuggestions.length === 0) return
                                        if (e.key === 'ArrowDown') {
                                            e.preventDefault()
                                            setLocationHighlight(prev => Math.min(prev + 1, locationSuggestions.length - 1))
                                        } else if (e.key === 'ArrowUp') {
                                            e.preventDefault()
                                            setLocationHighlight(prev => Math.max(prev - 1, 0))
                                        } else if (e.key === 'Enter' && locationHighlight >= 0) {
                                            e.preventDefault()
                                            const s = locationSuggestions[locationHighlight]
                                            setLocation(s.city)
                                            setShowLocationDropdown(false)
                                            setLocationHighlight(-1)
                                        } else if (e.key === 'Escape') {
                                            setShowLocationDropdown(false)
                                        }
                                    }}
                                    placeholder="es. Milano, Bologna..."
                                    autoComplete="off"
                                />
                                {showLocationDropdown && locationSuggestions.length > 0 && (
                                    <div
                                        ref={locationDropdownRef}
                                        className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto"
                                    >
                                        {locationSuggestions.map((s, i) => (
                                            <button
                                                key={`${s.city}-${s.region}`}
                                                type="button"
                                                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 text-sm transition-colors ${
                                                    i === locationHighlight
                                                        ? 'bg-teal-50 text-teal-700'
                                                        : 'hover:bg-gray-50 text-gray-700'
                                                }`}
                                                onMouseEnter={() => setLocationHighlight(i)}
                                                onClick={() => {
                                                    setLocation(s.city)
                                                    setShowLocationDropdown(false)
                                                    setLocationHighlight(-1)
                                                }}
                                            >
                                                <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                                                <span className="font-medium">{s.city}</span>
                                                <span className="text-gray-400 text-xs">{s.region}, {s.country}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <label className="flex items-center gap-1.5 cursor-pointer group whitespace-nowrap" title="Includi aziende nella provincia">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                                    checked={includeProvince}
                                    onChange={(e) => setIncludeProvince(e.target.checked)}
                                />
                                <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors">Provincia</span>
                            </label>
                        </div>
                    </div>

                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">3. Quantita': <span className="font-bold text-teal-600">{quantity}</span></label>
                        <input
                            type="range"
                            min="5" max="50"
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                            value={quantity}
                            onChange={(e) => setQuantity(parseInt(e.target.value))}
                        />
                    </div>

                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            4. Min: <span className={`font-bold ${minScore >= 70 ? 'text-green-600' : minScore >= 50 ? 'text-teal-600' : 'text-amber-600'}`}>{minScore}%</span>
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="range"
                                min="20" max="90" step="5"
                                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                                value={minScore}
                                onChange={(e) => setMinScore(parseInt(e.target.value))}
                            />
                            <Shield className={`w-4 h-4 flex-shrink-0 ${minScore >= 70 ? 'text-green-500' : minScore >= 50 ? 'text-teal-500' : 'text-amber-500'}`} />
                        </div>
                    </div>

                    <div className="col-span-2">
                        <button
                            onClick={handleSearch}
                            disabled={!selectedProduct}
                            className={`w-full px-4 py-2.5 flex items-center justify-center gap-2 rounded-xl font-semibold text-white shadow-sm transition-all text-sm ${!selectedProduct ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 shadow-teal-200/50'
                                }`}
                        >
                            <Search className="w-4 h-4" /> Avvia Ricerca
                            {isSearching && <span className="ml-1 text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">+1</span>}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Jobs Queue ── */}
            {jobs.length > 0 && (
                <div className="space-y-4">
                    {jobs.map((job) => (
                        <div key={job.id} className={`rounded-xl overflow-hidden shadow-lg transition-all ${job.status === 'completed'
                            ? 'bg-gradient-to-r from-green-500 to-emerald-500 shadow-green-200/40'
                            : job.status === 'error'
                                ? 'bg-gradient-to-r from-red-500 to-red-600 shadow-red-200/40'
                                : 'bg-gradient-to-r from-teal-600 via-teal-500 to-emerald-500 shadow-teal-200/40'
                            }`}>
                            {/* Job Header */}
                            <div className="p-4 text-white">
                                <div className="flex items-center gap-4">
                                    <div className="relative flex-shrink-0">
                                        {job.status === 'completed'
                                            ? <CheckCircle className="w-8 h-8" />
                                            : job.status === 'error'
                                                ? <XCircle className="w-8 h-8" />
                                                : <><Radar className="w-8 h-8 animate-pulse" />
                                                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-ping" /></>
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm">
                                            {job.productName} — {job.location}
                                            <span className="text-white/60 font-normal ml-2">({job.quantity} lead, min {job.minScore}%)</span>
                                        </p>
                                        <p className="text-xs text-white/70 mt-0.5 truncate">
                                            {job.status === 'completed' ? 'Ricerca completata!' : job.status === 'error' ? job.progress : job.progress}
                                        </p>
                                    </div>

                                    {/* Stats badges */}
                                    {job.stats && (
                                        <div className="flex gap-2 flex-shrink-0">
                                            <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[55px]">
                                                <span className="text-sm font-bold block">{job.stats.analyzed}</span>
                                                <span className="text-[10px] text-white/70">Analizzati</span>
                                            </div>
                                            <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[55px]">
                                                <span className="text-sm font-bold block">{job.stats.accepted}</span>
                                                <span className="text-[10px] text-white/70">Accettati</span>
                                            </div>
                                            {job.stats.below_threshold > 0 && (
                                                <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[55px]">
                                                    <span className="text-sm font-bold block">{job.stats.below_threshold}</span>
                                                    <span className="text-[10px] text-white/70">Sotto Soglia</span>
                                                </div>
                                            )}
                                            <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[55px]">
                                                <span className="text-sm font-bold block">{job.stats.discarded}</span>
                                                <span className="text-[10px] text-white/70">Scartati</span>
                                            </div>
                                            <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-center min-w-[55px]">
                                                <span className="text-sm font-bold block">{job.stats.avg_score}%</span>
                                                <span className="text-[10px] text-white/70">Score</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Remove button for completed/error */}
                                    {(job.status === 'completed' || job.status === 'error') && (
                                        <button onClick={() => removeJob(job.id)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                                            <X className="w-5 h-5 text-white/60 hover:text-white" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Progress bar for running */}
                            {job.status === 'running' && job.stats && (
                                <div className="h-1.5 bg-white/10">
                                    <div
                                        className="h-full bg-white/50 transition-all duration-500 ease-out"
                                        style={{ width: `${Math.min(100, ((job.stats.accepted + job.stats.discarded) / Math.max(1, job.quantity)) * 100)}%` }}
                                    />
                                </div>
                            )}

                            {/* Completed Results */}
                            {job.status === 'completed' && job.results && (
                                <div className="bg-white border-t border-gray-100">
                                    {/* Stats row */}
                                    <div className="px-5 py-3 flex items-center justify-between border-b border-gray-50">
                                        <div className="flex gap-4 text-xs">
                                            <span className="text-gray-500">Analizzati: <b className="text-gray-800">{job.results.stats?.analyzed || 0}</b></span>
                                            <span className="text-green-600">Accettati: <b>{job.results.accepted?.length || 0}</b></span>
                                            {(job.results.below_threshold?.length || 0) > 0 && (
                                                <span className="text-amber-600">Sotto Soglia: <b>{job.results.below_threshold.length}</b></span>
                                            )}
                                            <span className="text-red-500">Scartati: <b>{job.results.discarded?.length || 0}</b></span>
                                            <span className="text-teal-600">Score medio: <b>{job.results.stats?.avg_score || 0}%</b></span>
                                        </div>
                                        <Link
                                            to="/leads"
                                            className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-xs font-medium"
                                        >
                                            Vai ai Contatti <ArrowRight className="w-3 h-3" />
                                        </Link>
                                    </div>

                                    {/* Accepted leads list */}
                                    {job.results.accepted?.length > 0 && (
                                        <div className="divide-y divide-gray-50">
                                            {job.results.accepted.map((lead, i) => (
                                                <div key={i} className="flex items-center gap-4 px-5 py-2.5">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${getScoreBadge(lead.score)}`}>
                                                        {lead.score}%
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                                            <Building2 className="w-3.5 h-3.5 text-gray-400" />
                                                            {lead.company_name}
                                                        </p>
                                                        <p className="text-xs text-gray-500 truncate">{lead.reason}</p>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-gray-400">
                                                        {lead.email && <span className="text-teal-600 font-medium">{lead.email}</span>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Below Threshold toggle — saved in DB but below min_score */}
                                    {job.results.below_threshold?.length > 0 && (
                                        <>
                                            <button
                                                onClick={() => toggleBelowThreshold(job.id)}
                                                className="w-full px-5 py-2 flex items-center justify-between hover:bg-amber-50/50 transition-colors border-t border-gray-100"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Shield className="w-3.5 h-3.5 text-amber-500" />
                                                    <span className="text-xs font-medium text-amber-600">Sotto Soglia ({job.results.below_threshold.length}) — salvati nei contatti</span>
                                                </div>
                                                {job.showBelowThreshold ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                                            </button>
                                            {job.showBelowThreshold && (
                                                <div className="divide-y divide-gray-50 border-t border-gray-100 bg-amber-50/20">
                                                    {job.results.below_threshold.map((lead, i) => (
                                                        <div key={i} className="flex items-center gap-4 px-5 py-2.5 opacity-70">
                                                            <span className={`text-xs font-bold px-2 py-1 rounded-md ${getScoreBadge(lead.score)}`}>
                                                                {lead.score}%
                                                            </span>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-medium text-gray-800 flex items-center gap-2">
                                                                    <Building2 className="w-3.5 h-3.5 text-gray-400" />
                                                                    {lead.company_name}
                                                                </p>
                                                                <p className="text-xs text-gray-500 truncate">{lead.reason}</p>
                                                            </div>
                                                            <div className="flex items-center gap-3 text-xs text-gray-400">
                                                                {lead.email && <span className="text-amber-600 font-medium">{lead.email}</span>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Discarded toggle */}
                                    {job.results.discarded?.length > 0 && (
                                        <>
                                            <button
                                                onClick={() => toggleDiscarded(job.id)}
                                                className="w-full px-5 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors border-t border-gray-100"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                                                    <span className="text-xs font-medium text-gray-500">Scartati ({job.results.discarded.length})</span>
                                                </div>
                                                {job.showDiscarded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                                            </button>
                                            {job.showDiscarded && (
                                                <div className="divide-y divide-gray-50 border-t border-gray-100">
                                                    {job.results.discarded.map((lead, i) => (
                                                        <div key={i} className="flex items-center gap-4 px-5 py-2.5 opacity-50">
                                                            <span className={`text-xs font-bold px-2 py-1 rounded-md ${getScoreBadge(lead.score)}`}>
                                                                {lead.score}%
                                                            </span>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                                                    <Building2 className="w-3.5 h-3.5 text-gray-400" />
                                                                    {lead.company_name}
                                                                </p>
                                                                <p className="text-xs text-gray-500 truncate">{lead.reason}</p>
                                                            </div>
                                                            {lead.website && (
                                                                <a
                                                                    href={lead.website?.startsWith('http') ? lead.website : `https://${lead.website}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                                                                >
                                                                    <Globe className="w-3 h-3" /> Sito
                                                                </a>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
