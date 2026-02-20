import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Plus, Package, Sparkles, FileImage, Loader, Pencil, Trash2, X, FileSearch } from 'lucide-react'
import FileUpload from '../components/FileUpload'
import { API_URL } from '../lib/api'

export default function Products() {
    const [products, setProducts] = useState([])
    const [showForm, setShowForm] = useState(false)
    const [editingProduct, setEditingProduct] = useState(null) // null = create mode, object = edit mode
    const [formData, setFormData] = useState({ name: '', description: '', target_keywords: '' })
    const [saving, setSaving] = useState(false)
    const [savingStatus, setSavingStatus] = useState('')
    const [deleteConfirm, setDeleteConfirm] = useState(null)
    const [reportProduct, setReportProduct] = useState(null) // product to show AI report for
    const fileUploadRef = useRef(null)

    useEffect(() => {
        fetchProducts()
    }, [])

    // Deep-link: auto-open product from Dashboard navigation
    const location = useLocation()
    useEffect(() => {
        if (location.state?.openProductId && products.length > 0) {
            const product = products.find(p => p.id === location.state.openProductId)
            if (product) {
                openEditForm(product)
                // Clear the state so it doesn't re-trigger on re-render
                window.history.replaceState({}, '')
            }
        }
    }, [location.state, products])

    const fetchProducts = async () => {
        const { data } = await supabase
            .from('products')
            .select('*, product_files(*)')
            .order('created_at', { ascending: false })
        if (data) setProducts(data)
    }

    const openCreateForm = () => {
        setEditingProduct(null)
        setFormData({ name: '', description: '', target_keywords: '' })
        setShowForm(true)
    }

    const openEditForm = (product) => {
        setEditingProduct(product)
        setFormData({
            name: product.name || '',
            description: product.description || '',
            target_keywords: product.target_keywords || ''
        })
        setShowForm(true)
    }

    // ── Tag Input helpers for target_keywords ──
    const addKeyword = (value) => {
        const trimmed = value.trim()
        if (!trimmed) return
        const tags = formData.target_keywords
            ? formData.target_keywords.split(',').map(t => t.trim()).filter(Boolean)
            : []
        if (tags.some(t => t.toLowerCase() === trimmed.toLowerCase())) return
        setFormData({ ...formData, target_keywords: [...tags, trimmed].join(', ') })
    }

    const removeKeyword = (index) => {
        const tags = formData.target_keywords.split(',').map(t => t.trim()).filter(Boolean)
        tags.splice(index, 1)
        setFormData({ ...formData, target_keywords: tags.join(', ') })
    }

    const handleCancelForm = () => {
        setShowForm(false)
        setEditingProduct(null)
        setFormData({ name: '', description: '', target_keywords: '' })
        setSaving(false)
        setSavingStatus('')
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!formData.name || !formData.description) return

        setSaving(true)

        if (editingProduct) {
            await handleUpdate()
        } else {
            await handleCreate()
        }

        setSaving(false)
        setSavingStatus('')
        setShowForm(false)
        setEditingProduct(null)
        setFormData({ name: '', description: '', target_keywords: '' })
        fetchProducts()
    }

    const handleCreate = async () => {
        setSavingStatus('Salvataggio prodotto...')

        const { data: productData, error } = await supabase
            .from('products')
            .insert([formData])
            .select()
            .single()

        if (error) {
            alert('Errore creazione prodotto: ' + error.message)
            return
        }

        const productId = productData.id

        if (fileUploadRef.current && fileUploadRef.current.hasFiles()) {
            setSavingStatus('Caricamento file...')
            const uploaded = await fileUploadRef.current.uploadAllFiles(productId)

            if (uploaded.length > 0) {
                setSavingStatus('Analisi AI delle immagini in corso...')
                await waitForAnalyses(productId, uploaded.length)

                setSavingStatus('Generazione descrizione AI...')
                try {
                    await fetch(`${API_URL}/synthesize-description`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product_id: productId })
                    })
                } catch (err) {
                    console.error('Synthesis error:', err)
                }
            }
        }
    }

    const handleUpdate = async () => {
        setSavingStatus('Aggiornamento prodotto...')

        const { error } = await supabase
            .from('products')
            .update({
                name: formData.name,
                description: formData.description,
                target_keywords: formData.target_keywords
            })
            .eq('id', editingProduct.id)

        if (error) {
            alert('Errore aggiornamento: ' + error.message)
            return
        }

        // Upload new files if any
        if (fileUploadRef.current && fileUploadRef.current.hasFiles()) {
            setSavingStatus('Caricamento nuovi file...')
            const uploaded = await fileUploadRef.current.uploadAllFiles(editingProduct.id)

            if (uploaded.length > 0) {
                setSavingStatus('Analisi AI delle nuove immagini...')
                await waitForAnalyses(editingProduct.id, uploaded.length)

                // Re-synthesize with all files (old + new)
                setSavingStatus('Rigenerazione descrizione AI...')
                try {
                    await fetch(`${API_URL}/synthesize-description`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product_id: editingProduct.id })
                    })
                } catch (err) {
                    console.error('Synthesis error:', err)
                }
            }
        }
    }

    const handleDelete = async (productId) => {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', productId)

        if (error) {
            alert('Errore eliminazione: ' + error.message)
            return
        }

        setDeleteConfirm(null)
        fetchProducts()
    }

    const waitForAnalyses = async (productId, fileCount) => {
        const maxAttempts = 40
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 3000))

            const { data } = await supabase
                .from('product_files')
                .select('ai_analysis')
                .eq('product_id', productId)

            if (!data) continue

            const analyzed = data.filter(f => f.ai_analysis && f.ai_analysis.length > 0)
            if (analyzed.length >= fileCount) {
                return
            }
        }
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            <header className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">I Miei Prodotti</h1>
                <button
                    onClick={openCreateForm}
                    className="bg-teal-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-teal-700 transition-colors"
                >
                    <Plus className="w-5 h-5" /> Nuovo Prodotto
                </button>
            </header>

            {showForm && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-in fade-in slide-in-from-top-4">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-800">
                            {editingProduct ? 'Modifica Prodotto' : 'Nuovo Prodotto'}
                        </h2>
                        <button onClick={handleCancelForm} className="p-1 hover:bg-gray-100 rounded-lg">
                            <X className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Nome Prodotto</label>
                            <input
                                type="text"
                                className="w-full mt-1 border-gray-300 rounded-md shadow-sm p-2 border"
                                placeholder="Es. Etichette Vino Premium"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                disabled={saving}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Descrizione Dettagliata (per AI)</label>
                            <textarea
                                className="w-full mt-1 border-gray-300 rounded-md shadow-sm p-2 border"
                                rows="3"
                                placeholder="Descrivi il prodotto e a chi serve..."
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                disabled={saving}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Keyword Target (query di ricerca)</label>
                            {(() => {
                                const currentTags = formData.target_keywords
                                    ? formData.target_keywords.split(',').map(t => t.trim()).filter(Boolean)
                                    : []
                                return (
                                    <>
                                        <div className="w-full mt-1 border border-gray-300 rounded-md shadow-sm p-2 flex flex-wrap gap-2 items-center min-h-[42px] focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-teal-500 bg-white">
                                            {currentTags.map((tag, i) => (
                                                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 text-teal-700 text-xs font-medium rounded-full border border-teal-200">
                                                    {tag}
                                                    {!saving && (
                                                        <button type="button" onClick={() => removeKeyword(i)} className="ml-0.5 hover:text-red-500 transition-colors">
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </span>
                                            ))}
                                            <input
                                                type="text"
                                                className="flex-1 min-w-[150px] outline-none text-sm border-none p-0 placeholder:text-gray-400 bg-transparent"
                                                placeholder={currentTags.length === 0 ? "Es. Cantine vinicole, Enoteche..." : "Aggiungi keyword..."}
                                                disabled={saving}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ',') {
                                                        e.preventDefault()
                                                        addKeyword(e.target.value)
                                                        e.target.value = ''
                                                    }
                                                    if (e.key === 'Backspace' && e.target.value === '' && currentTags.length > 0) {
                                                        removeKeyword(currentTags.length - 1)
                                                    }
                                                }}
                                                onBlur={(e) => {
                                                    if (e.target.value.trim()) {
                                                        addKeyword(e.target.value)
                                                        e.target.value = ''
                                                    }
                                                }}
                                            />
                                        </div>
                                        <p className="mt-1 text-xs text-gray-400">Premi Invio per aggiungere. Ogni keyword genera una ricerca separata su Google Maps.</p>
                                    </>
                                )
                            })()}
                        </div>

                        {/* File Upload - pass existing files in edit mode */}
                        <FileUpload
                            ref={fileUploadRef}
                            existingFiles={editingProduct?.product_files || []}
                        />

                        {/* AI Analysis Report (edit mode only) */}
                        {editingProduct?.product_files?.some(f => f.ai_analysis) && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 pt-2">
                                    <div className="h-px flex-1 bg-gray-200" />
                                    <span className="text-xs font-semibold text-purple-600 uppercase tracking-wider flex items-center gap-1">
                                        <Sparkles className="w-3.5 h-3.5" /> Report Analisi AI
                                    </span>
                                    <div className="h-px flex-1 bg-gray-200" />
                                </div>

                                {/* Per-file analysis cards */}
                                {editingProduct.product_files
                                    .filter(f => f.ai_analysis)
                                    .map((f) => (
                                        <div key={f.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                            {/* File thumbnail */}
                                            <div className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden border border-gray-200">
                                                {f.file_type?.startsWith('image/') ? (
                                                    <img src={f.file_url} alt={f.file_name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-red-50">
                                                        <FileImage className="w-5 h-5 text-red-400" />
                                                        <span className="text-[8px] text-red-500 mt-0.5">PDF</span>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Analysis text */}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-gray-700 truncate mb-1">{f.file_name}</p>
                                                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{f.ai_analysis}</p>
                                            </div>
                                        </div>
                                    ))
                                }

                                {/* Synthesized description */}
                                {editingProduct.ai_description && (
                                    <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                                        <p className="text-xs text-purple-600 font-medium mb-1 flex items-center gap-1">
                                            <Sparkles className="w-3 h-3" /> Descrizione AI Unificata
                                        </p>
                                        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{editingProduct.ai_description}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* AI Description only (no files analyzed yet) */}
                        {editingProduct?.ai_description && !editingProduct?.product_files?.some(f => f.ai_analysis) && (
                            <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                                <p className="text-xs text-purple-600 font-medium mb-1 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> Descrizione AI attuale
                                </p>
                                <p className="text-xs text-gray-600">{editingProduct.ai_description}</p>
                            </div>
                        )}

                        {/* Saving Status */}
                        {saving && (
                            <div className="flex items-center gap-3 p-3 bg-teal-50 border border-teal-100 rounded-lg">
                                <Loader className="w-4 h-4 text-teal-600 animate-spin" />
                                <span className="text-sm text-teal-700 font-medium">{savingStatus}</span>
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={handleCancelForm}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                                disabled={saving}
                            >
                                Annulla
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-400 flex items-center gap-2"
                                disabled={saving}
                            >
                                {saving
                                    ? <><Loader className="w-4 h-4 animate-spin" /> Salvataggio...</>
                                    : editingProduct ? 'Aggiorna Prodotto' : 'Salva Prodotto'
                                }
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map(product => (
                    <div key={product.id} className="bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow overflow-hidden group relative">
                        {/* File Thumbnails */}
                        {product.product_files && product.product_files.length > 0 && (
                            <div className="flex overflow-x-auto bg-gray-50 border-b border-gray-100">
                                {product.product_files.slice(0, 4).map((f) => (
                                    <div key={f.id} className="flex-shrink-0 w-20 h-20">
                                        {f.file_type?.startsWith('image/') ? (
                                            <img src={f.file_url} alt={f.file_name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-red-50">
                                                <FileImage className="w-6 h-6 text-red-400" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {product.product_files.length > 4 && (
                                    <div className="flex-shrink-0 w-20 h-20 flex items-center justify-center bg-gray-100 text-gray-500 text-sm font-medium">
                                        +{product.product_files.length - 4}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Action Buttons (hover) */}
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            {product.product_files?.some(f => f.ai_analysis) && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setReportProduct(product) }}
                                    className="p-1.5 bg-white/90 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors shadow-sm"
                                    title="Report Analisi AI"
                                >
                                    <FileSearch className="w-3.5 h-3.5 text-purple-600" />
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); openEditForm(product) }}
                                className="p-1.5 bg-white/90 border border-gray-200 rounded-lg hover:bg-teal-50 hover:border-teal-300 transition-colors shadow-sm"
                                title="Modifica prodotto"
                            >
                                <Pencil className="w-3.5 h-3.5 text-gray-600" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(product.id) }}
                                className="p-1.5 bg-white/90 border border-gray-200 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors shadow-sm"
                                title="Elimina prodotto"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-gray-600" />
                            </button>
                        </div>

                        <div className="p-6 cursor-pointer" onClick={() => openEditForm(product)}>
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center text-teal-600">
                                        <Package className="w-6 h-6" />
                                    </div>
                                    {product.ai_description && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 text-[10px] font-semibold rounded-full border border-purple-100">
                                            <Sparkles className="w-3 h-3" /> AI Enhanced
                                        </span>
                                    )}
                                </div>
                                <span className="text-xs text-gray-400">{new Date(product.created_at).toLocaleDateString()}</span>
                            </div>
                            <h3 className="font-semibold text-gray-900 mb-2">{product.name}</h3>
                            <p className="text-sm text-gray-600 line-clamp-3 mb-4">{product.description}</p>

                            {product.ai_description && (
                                <div className="mb-4 p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                                    <p className="text-xs text-purple-600 font-medium mb-1 flex items-center gap-1">
                                        <Sparkles className="w-3 h-3" /> Descrizione AI
                                    </p>
                                    <p className="text-xs text-gray-600 line-clamp-3">{product.ai_description}</p>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-1.5">
                                {product.target_keywords?.split(',').map((k, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs font-medium rounded-full border border-teal-200">{k.trim()}</span>
                                ))}
                            </div>

                            {/* View Report Button */}
                            {product.product_files?.some(f => f.ai_analysis) && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setReportProduct(product) }}
                                    className="mt-4 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-50 text-purple-700 text-xs font-medium rounded-lg border border-purple-100 hover:bg-purple-100 transition-colors"
                                >
                                    <FileSearch className="w-3.5 h-3.5" /> Vedi Report Analisi AI
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* AI Report Modal */}
            {reportProduct && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setReportProduct(null)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                    <FileSearch className="w-5 h-5 text-purple-600" />
                                    Report Analisi AI
                                </h3>
                                <p className="text-sm text-gray-500 mt-0.5">{reportProduct.name}</p>
                            </div>
                            <button onClick={() => setReportProduct(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* Per-file analysis */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Analisi per File ({reportProduct.product_files?.filter(f => f.ai_analysis).length} file analizzati)
                                </h4>
                                {reportProduct.product_files
                                    ?.filter(f => f.ai_analysis)
                                    .map((f) => (
                                        <div key={f.id} className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                            <div className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-gray-200 bg-white">
                                                {f.file_type?.startsWith('image/') ? (
                                                    <img src={f.file_url} alt={f.file_name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-red-50">
                                                        <FileImage className="w-8 h-8 text-red-400" />
                                                        <span className="text-[10px] text-red-500 mt-1">PDF</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-800 mb-2">{f.file_name}</p>
                                                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{f.ai_analysis}</p>
                                            </div>
                                        </div>
                                    ))
                                }
                            </div>

                            {/* Synthesized description */}
                            {reportProduct.ai_description && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                                        <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                                        Descrizione AI Unificata
                                    </h4>
                                    <div className="p-4 bg-purple-50/50 rounded-lg border border-purple-200">
                                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{reportProduct.ai_description}</p>
                                    </div>
                                </div>
                            )}

                            {/* Files without analysis */}
                            {reportProduct.product_files?.some(f => !f.ai_analysis) && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        File in attesa di analisi
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {reportProduct.product_files
                                            .filter(f => !f.ai_analysis)
                                            .map(f => (
                                                <span key={f.id} className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-50 text-yellow-700 text-xs rounded-md border border-yellow-200">
                                                    <Loader className="w-3 h-3 animate-spin" /> {f.file_name}
                                                </span>
                                            ))
                                        }
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
                    <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Eliminare il prodotto?</h3>
                        <p className="text-sm text-gray-600 mb-6">
                            Questa azione eliminera' il prodotto, tutti i file associati e non potra' essere annullata.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                                Elimina
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
