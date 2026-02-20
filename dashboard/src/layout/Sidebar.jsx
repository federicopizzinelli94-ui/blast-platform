import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Package, Search, Users, MessageSquareText, Settings, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Sidebar() {
    const location = useLocation()
    const { user, signOut } = useAuth()

    const isActive = (path) => location.pathname === path

    const menuItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        { icon: Package, label: 'Prodotti', path: '/products' },
        { icon: Search, label: 'Ricerca Smart', path: '/search' },
        { icon: Users, label: 'Contatti (Leads)', path: '/leads' },
        { icon: MessageSquareText, label: 'Messaggi', path: '/messages' },
    ]

    return (
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen fixed left-0 top-0 z-50">
            <div className="flex flex-col items-center px-6 py-5 border-b border-gray-100">
                <img src="/New Logo LS.png" alt="Laser Services Logo" className="h-10 object-contain" />
            </div>

            <nav className="flex-1 py-6 space-y-1">
                {menuItems.map((item) => (
                    <Link
                        key={item.path}
                        to={item.path}
                        className={`flex items-center px-6 py-3 text-sm font-medium transition-colors ${isActive(item.path)
                            ? 'bg-teal-50 text-teal-600 border-r-4 border-teal-500'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                    >
                        <item.icon className="w-5 h-5 mr-3" />
                        {item.label}
                    </Link>
                ))}
            </nav>

            <div className="p-4 border-t border-gray-100 space-y-2">
                <Link
                    to="/settings"
                    className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${isActive('/settings') ? 'bg-teal-50 text-teal-600' : 'hover:bg-gray-50'}`}
                >
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                        <Settings className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{user?.email || 'Settings'}</div>
                        <div className="text-xs text-gray-500">v1.0.0</div>
                    </div>
                </Link>
                <button
                    onClick={signOut}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                    <LogOut className="w-4 h-4" />
                    Esci
                </button>
            </div>
        </div>
    )
}
