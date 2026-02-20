import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { supabase } from '../lib/supabase'
import { Upload, FileText, X, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import { API_URL } from '../lib/api'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const MAX_FILES = 10

const FileUpload = forwardRef(function FileUpload({ existingFiles = [] }, ref) {
    const [localFiles, setLocalFiles] = useState([])
    const [uploadedFiles, setUploadedFiles] = useState([])
    const [uploading, setUploading] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [analysisStatus, setAnalysisStatus] = useState({})
    const fileInputRef = useRef(null)
    const localFilesRef = useRef([])

    // Load existing files when editing a product
    useEffect(() => {
        if (existingFiles.length > 0) {
            setUploadedFiles(existingFiles)
        }
    }, [existingFiles])

    // Keep ref in sync with state for use in imperative handle
    const updateLocalFiles = (updater) => {
        setLocalFiles(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater
            localFilesRef.current = next
            return next
        })
    }

    const validateFile = (file) => {
        const total = localFilesRef.current.length + uploadedFiles.length
        if (!ACCEPTED_TYPES.includes(file.type)) {
            return 'Formato non supportato. Usa JPEG, PNG o PDF.'
        }
        if (file.size > MAX_FILE_SIZE) {
            return 'File troppo grande. Massimo 10MB.'
        }
        if (total >= MAX_FILES) {
            return `Massimo ${MAX_FILES} file per prodotto.`
        }
        return null
    }

    const addLocalFiles = (fileList) => {
        const newFiles = []
        for (const file of fileList) {
            const error = validateFile(file)
            if (error) {
                alert(error)
                continue
            }
            const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
            newFiles.push({ file, preview, id: crypto.randomUUID() })
        }
        updateLocalFiles(prev => [...prev, ...newFiles])
    }

    const removeLocalFile = (id) => {
        updateLocalFiles(prev => {
            const entry = prev.find(f => f.id === id)
            if (entry?.preview) URL.revokeObjectURL(entry.preview)
            return prev.filter(f => f.id !== id)
        })
    }

    const removeUploadedFile = async (fileRecord) => {
        await supabase.storage.from('product-files').remove([fileRecord.file_path])
        await supabase.from('product_files').delete().eq('id', fileRecord.id)
        setUploadedFiles(prev => prev.filter(f => f.id !== fileRecord.id))
    }

    // Expose methods to parent via ref
    useImperativeHandle(ref, () => ({
        hasFiles: () => localFilesRef.current.length > 0,
        reset: () => {
            updateLocalFiles([])
            setUploadedFiles([])
            setAnalysisStatus({})
        },
        uploadAllFiles: async (newProductId) => {
            const files = localFilesRef.current
            if (files.length === 0) return []

            setUploading(true)
            const uploaded = []

            for (const { file } of files) {
                try {
                    const storagePath = `${newProductId}/${crypto.randomUUID()}_${file.name}`

                    const { error: uploadError } = await supabase.storage
                        .from('product-files')
                        .upload(storagePath, file)

                    if (uploadError) {
                        console.error('Upload error:', uploadError)
                        continue
                    }

                    const { data: urlData } = supabase.storage
                        .from('product-files')
                        .getPublicUrl(storagePath)

                    const fileUrl = urlData.publicUrl

                    const { data: fileRecord, error: insertError } = await supabase
                        .from('product_files')
                        .insert({
                            product_id: newProductId,
                            file_name: file.name,
                            file_path: storagePath,
                            file_url: fileUrl,
                            file_type: file.type,
                            file_size: file.size,
                            sort_order: uploaded.length
                        })
                        .select()
                        .single()

                    if (insertError) {
                        console.error('DB insert error:', insertError)
                        continue
                    }

                    uploaded.push(fileRecord)
                    setAnalysisStatus(prev => ({ ...prev, [fileRecord.id]: 'analyzing' }))

                    fetch('${API_URL}/analyze-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            file_url: fileUrl,
                            file_type: file.type,
                            product_file_id: fileRecord.id
                        })
                    }).catch(err => {
                        console.error('Analysis trigger error:', err)
                        setAnalysisStatus(prev => ({ ...prev, [fileRecord.id]: 'error' }))
                    })

                } catch (err) {
                    console.error('File upload error:', err)
                }
            }

            setUploadedFiles(prev => [...prev, ...uploaded])
            updateLocalFiles([])
            setUploading(false)
            return uploaded
        }
    }))

    // Drag & drop handlers
    const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false) }
    const handleDrop = (e) => {
        e.preventDefault()
        setIsDragging(false)
        addLocalFiles(e.dataTransfer.files)
    }

    const handleFileInput = (e) => {
        addLocalFiles(e.target.files)
        e.target.value = ''
    }

    return (
        <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
                Immagini / Cataloghi Prodotto
            </label>

            {/* Drop Zone */}
            <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                    border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
                    ${isDragging
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-300 bg-gray-50 hover:border-teal-400 hover:bg-teal-50/50'
                    }
                `}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={handleFileInput}
                    className="hidden"
                />
                <Upload className={`w-8 h-8 mx-auto mb-2 ${isDragging ? 'text-teal-600' : 'text-gray-400'}`} />
                <p className="text-sm text-gray-600">
                    <span className="font-medium text-teal-600">Clicca per caricare</span> o trascina i file qui
                </p>
                <p className="text-xs text-gray-400 mt-1">
                    JPEG, PNG, PDF - Max 10MB per file - Max {MAX_FILES} file
                </p>
            </div>

            {/* File Previews */}
            {(localFiles.length > 0 || uploadedFiles.length > 0) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {/* Already uploaded files */}
                    {uploadedFiles.map((f) => (
                        <div key={f.id} className="relative group rounded-lg border border-gray-200 bg-white overflow-hidden">
                            {f.file_type?.startsWith('image/') ? (
                                <img src={f.file_url} alt={f.file_name} className="w-full h-24 object-cover" />
                            ) : (
                                <div className="w-full h-24 flex flex-col items-center justify-center bg-red-50">
                                    <FileText className="w-8 h-8 text-red-400" />
                                    <span className="text-[10px] text-red-500 mt-1">PDF</span>
                                </div>
                            )}
                            <div className="px-2 py-1.5 flex items-center justify-between">
                                <span className="text-[10px] text-gray-500 truncate flex-1">{f.file_name}</span>
                                {analysisStatus[f.id] === 'analyzing' && (
                                    <Loader className="w-3 h-3 text-teal-500 animate-spin flex-shrink-0" />
                                )}
                                {(analysisStatus[f.id] === 'done' || f.ai_analysis) && (
                                    <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                                )}
                                {analysisStatus[f.id] === 'error' && (
                                    <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                                )}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); removeUploadedFile(f) }}
                                className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}

                    {/* Local files (not yet uploaded) */}
                    {localFiles.map(({ file, preview, id }) => (
                        <div key={id} className="relative group rounded-lg border border-dashed border-teal-300 bg-teal-50/30 overflow-hidden">
                            {preview ? (
                                <img src={preview} alt={file.name} className="w-full h-24 object-cover" />
                            ) : (
                                <div className="w-full h-24 flex flex-col items-center justify-center">
                                    <FileText className="w-8 h-8 text-red-400" />
                                    <span className="text-[10px] text-red-500 mt-1">PDF</span>
                                </div>
                            )}
                            <div className="px-2 py-1.5">
                                <span className="text-[10px] text-gray-500 truncate block">{file.name}</span>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); removeLocalFile(id) }}
                                className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="w-3 h-3" />
                            </button>
                            {uploading && (
                                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                                    <Loader className="w-5 h-5 text-teal-600 animate-spin" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
})

export default FileUpload
