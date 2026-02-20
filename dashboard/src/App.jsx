import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './layout/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import SmartSearch from './pages/SmartSearch'
import Leads from './pages/Leads'
import Messages from './pages/Messages'
import Settings from './pages/Settings'

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <div className="flex min-h-screen bg-gray-50 text-gray-900">
                <Sidebar />
                <main className="flex-1 w-full relative ml-64">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/search" element={<SmartSearch />} />
                    <Route path="/leads" element={<Leads />} />
                    <Route path="/messages" element={<Messages />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            </ProtectedRoute>
          } />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
