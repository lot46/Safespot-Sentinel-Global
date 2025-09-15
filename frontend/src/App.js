import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';
import './App.css';

// Import Leaflet CSS
import 'leaflet/dist/leaflet.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Create axios instance with interceptors
const api = axios.create({
  baseURL: API,
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth Context
const AuthContext = React.createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { access_token, user: userData } = response.data;
      
      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      
      toast.success('Connexion réussie !');
      return true;
    } catch (error) {
      toast.error('Erreur de connexion');
      return false;
    }
  };

  const register = async (email, password, full_name, phone) => {
    try {
      const response = await api.post('/auth/register', { 
        email, 
        password, 
        full_name, 
        phone 
      });
      const { access_token, user: userData } = response.data;
      
      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      
      toast.success('Inscription réussie !');
      return true;
    } catch (error) {
      toast.error('Erreur lors de l\'inscription');
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    toast.success('Déconnexion réussie');
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Landing Page Component
const LandingPage = () => {
  const navigate = (path) => window.location.href = path;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800">
      {/* Header */}
      <header className="relative z-10 px-6 py-4">
        <nav className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-green-400 rounded-lg flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white rounded-full"></div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">SafeSpot Sentinel</h1>
              <p className="text-xs text-cyan-400">Global</p>
            </div>
          </div>
          <div className="space-x-4">
            <button 
              onClick={() => navigate('/login')}
              className="px-4 py-2 text-cyan-400 hover:text-white transition-colors"
            >
              Connexion
            </button>
            <button 
              onClick={() => navigate('/register')}
              className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-green-500 text-white rounded-lg hover:from-cyan-600 hover:to-green-600 transition-all transform hover:scale-105"
            >
              S'inscrire
            </button>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative px-6 py-20">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl lg:text-6xl font-bold text-white leading-tight">
                Ensemble,
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-green-400">
                  sécurisons
                </span>
                le monde
              </h1>
              <p className="text-xl text-slate-300 max-w-lg">
                SafeSpot Sentinel Global - Votre bouclier numérique pour une sécurité personnelle et collective en temps réel.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <button 
                onClick={() => navigate('/register')}
                className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-green-500 text-white text-lg font-semibold rounded-xl hover:from-cyan-600 hover:to-green-600 transition-all transform hover:scale-105 shadow-lg shadow-cyan-500/25"
              >
                Rejoindre maintenant
              </button>
              <button 
                onClick={() => navigate('/demo')}
                className="px-8 py-4 border-2 border-cyan-500 text-cyan-400 text-lg font-semibold rounded-xl hover:bg-cyan-500 hover:text-white transition-all"
              >
                Voir la démo
              </button>
            </div>

            {/* Features */}
            <div className="grid grid-cols-2 gap-6 pt-8">
              <div className="space-y-2">
                <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold">SOS</span>
                </div>
                <h3 className="font-semibold text-white">SOS Ultra-Rapide</h3>
                <p className="text-sm text-slate-400">Alerte d'urgence en 1-clic</p>
              </div>
              <div className="space-y-2">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xl">🗺️</span>
                </div>
                <h3 className="font-semibold text-white">Carte Temps Réel</h3>
                <p className="text-sm text-slate-400">Incidents géolocalisés live</p>
              </div>
              <div className="space-y-2">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xl">👥</span>
                </div>
                <h3 className="font-semibold text-white">Communauté</h3>
                <p className="text-sm text-slate-400">Signalements collaboratifs</p>
              </div>
              <div className="space-y-2">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xl">🤖</span>
                </div>
                <h3 className="font-semibold text-white">IA Modération</h3>
                <p className="text-sm text-slate-400">Vérification automatique</p>
              </div>
            </div>
          </div>

          {/* Hero Image */}
          <div className="relative">
            <div className="relative z-10">
              <img 
                src="https://images.unsplash.com/photo-1634176866089-b633f4aec882?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Njd8MHwxfHNlYXJjaHwxfHxkaWdpdGFsJTIwZ2xvYmV8ZW58MHx8fHwxNzU3OTMyMDc5fDA&ixlib=rb-4.1.0&q=85"
                alt="Digital Globe" 
                className="w-full h-96 object-cover rounded-2xl shadow-2xl"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/20 to-transparent rounded-2xl"></div>
            <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 to-green-500/20 rounded-3xl blur-xl"></div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-20 bg-slate-900/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-4xl font-bold text-white">Fonctionnalités Premium</h2>
            <p className="text-xl text-slate-400">Sécurité maximale avec technologie de pointe</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-8 border border-slate-700 hover:border-cyan-500/50 transition-all">
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center mb-6">
                <span className="text-white text-2xl">🛡️</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-4">Bouclier Digital</h3>
              <p className="text-slate-400">Protection en temps réel avec zones de sécurité intelligentes et alertes de proximité.</p>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-8 border border-slate-700 hover:border-green-500/50 transition-all">
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center mb-6">
                <span className="text-white text-2xl">🌍</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-4">Réseau Global</h3>
              <p className="text-slate-400">Communauté mondiale connectée pour une veille sécuritaire collaborative 24/7.</p>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-8 border border-slate-700 hover:border-purple-500/50 transition-all">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center mb-6">
                <span className="text-white text-2xl">⚡</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-4">Réaction Éclair</h3>
              <p className="text-slate-400">Système SOS instantané avec notification multi-canal vers vos contacts d'urgence.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h2 className="text-4xl font-bold text-white">Prêt à sécuriser votre monde ?</h2>
          <p className="text-xl text-slate-400">Rejoignez des milliers d'utilisateurs qui font confiance à SafeSpot Sentinel</p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={() => navigate('/register')}
              className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-green-500 text-white text-lg font-semibold rounded-xl hover:from-cyan-600 hover:to-green-600 transition-all transform hover:scale-105 shadow-lg shadow-cyan-500/25"
            >
              Commencer gratuitement
            </button>
            <button 
              onClick={() => navigate('/premium')}
              className="px-8 py-4 border-2 border-cyan-500 text-cyan-400 text-lg font-semibold rounded-xl hover:bg-cyan-500 hover:text-white transition-all"
            >
              Découvrir Premium
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center space-x-3 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-green-400 rounded-lg flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-white rounded-full"></div>
            </div>
            <span className="text-white font-semibold">SafeSpot Sentinel Global</span>
          </div>
          <p className="text-slate-500">© 2025 SafeSpot Sentinel Global. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
};

// Login Component
const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    const success = await login(email, password);
    if (success) {
      window.location.href = '/dashboard';
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-8 border border-slate-700">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-green-400 rounded-xl flex items-center justify-center mx-auto mb-4">
              <div className="w-8 h-8 border-2 border-white rounded-full"></div>
            </div>
            <h1 className="text-2xl font-bold text-white">Connexion</h1>
            <p className="text-slate-400">Accédez à votre espace sécurisé</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors"
                required
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-gradient-to-r from-cyan-500 to-green-500 text-white font-semibold rounded-lg hover:from-cyan-600 hover:to-green-600 disabled:opacity-50 transition-all"
            >
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-slate-400">Pas encore de compte ? </span>
            <a href="/register" className="text-cyan-400 hover:text-cyan-300 transition-colors">
              S'inscrire
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

// Register Component
const RegisterPage = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    phone: ''
  });
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    const success = await register(
      formData.email,
      formData.password,
      formData.full_name,
      formData.phone
    );
    
    if (success) {
      window.location.href = '/dashboard';
    }
    
    setLoading(false);
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-8 border border-slate-700">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-green-400 rounded-xl flex items-center justify-center mx-auto mb-4">
              <div className="w-8 h-8 border-2 border-white rounded-full"></div>
            </div>
            <h1 className="text-2xl font-bold text-white">Inscription</h1>
            <p className="text-slate-400">Rejoignez la communauté SafeSpot</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <input
                type="text"
                name="full_name"
                placeholder="Nom complet"
                value={formData.full_name}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors"
                required
              />
            </div>
            <div>
              <input
                type="email"
                name="email"
                placeholder="Email"
                value={formData.email}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors"
                required
              />
            </div>
            <div>
              <input
                type="tel"
                name="phone"
                placeholder="Téléphone"
                value={formData.phone}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <input
                type="password"
                name="password"
                placeholder="Mot de passe"
                value={formData.password}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-gradient-to-r from-cyan-500 to-green-500 text-white font-semibold rounded-lg hover:from-cyan-600 hover:to-green-600 disabled:opacity-50 transition-all"
            >
              {loading ? 'Inscription...' : 'S\'inscrire'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-slate-400">Déjà un compte ? </span>
            <a href="/login" className="text-cyan-400 hover:text-cyan-300 transition-colors">
              Se connecter
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

// Dashboard Component  
const Dashboard = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('map');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800">
      {/* Header */}
      <header className="bg-slate-800/50 backdrop-blur-sm border-b border-slate-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-green-400 rounded-lg flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white rounded-full"></div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">SafeSpot Sentinel</h1>
              <p className="text-xs text-cyan-400">Global Dashboard</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <span className="text-slate-400">Bonjour, {user?.full_name}</span>
            {user?.is_premium && (
              <span className="px-3 py-1 bg-gradient-to-r from-yellow-500 to-orange-500 text-white text-xs font-semibold rounded-full">
                PREMIUM
              </span>
            )}
            <button
              onClick={logout}
              className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-80px)]">
        {/* Sidebar */}
        <div className="w-64 bg-slate-800/30 backdrop-blur-sm border-r border-slate-700 p-6">
          <nav className="space-y-2">
            {[
              { id: 'map', label: 'Carte', icon: '🗺️' },
              { id: 'reports', label: 'Signalements', icon: '📍' },
              { id: 'sos', label: 'SOS', icon: '🚨' },
              { id: 'contacts', label: 'Contacts', icon: '👥' },
              { id: 'premium', label: 'Premium', icon: '⭐' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-cyan-500/20 to-green-500/20 text-white border border-cyan-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <span className="text-xl">{tab.icon}</span>
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-6">
          {activeTab === 'map' && <MapView />}
          {activeTab === 'reports' && <ReportsView />}
          {activeTab === 'sos' && <SOSView />}
          {activeTab === 'contacts' && <ContactsView />}
          {activeTab === 'premium' && <PremiumView />}
        </div>
      </div>

      {/* Floating SOS Button */}
      <SOSButton />
    </div>
  );
};

// Map View Component
const MapView = () => {
  return (
    <div className="h-full bg-slate-800/50 rounded-2xl border border-slate-700 p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Carte des Incidents</h2>
        <div className="flex space-x-2">
          <button className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg border border-green-500/30">
            Sûr
          </button>
          <button className="px-4 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg border border-yellow-500/30">
            Vigilance
          </button>
          <button className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30">
            Danger
          </button>
        </div>
      </div>
      
      <div className="h-full bg-slate-700/50 rounded-xl flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-green-500 rounded-full flex items-center justify-center mx-auto">
            <span className="text-white text-2xl">🗺️</span>
          </div>
          <h3 className="text-xl font-semibold text-white">Carte Interactive</h3>
          <p className="text-slate-400 max-w-md">
            La carte interactive sera intégrée ici avec les incidents en temps réel,
            zones de sécurité et alerts météo.
          </p>
        </div>
      </div>
    </div>
  );
};

// Reports View Component
const ReportsView = () => {
  const [reports, setReports] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const response = await api.get('/reports');
      setReports(response.data);
    } catch (error) {
      toast.error('Erreur lors du chargement des signalements');
    }
  };

  return (
    <div className="h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Signalements</h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-green-500 text-white rounded-lg hover:from-cyan-600 hover:to-green-600 transition-all"
        >
          Nouveau signalement
        </button>
      </div>

      <div className="grid gap-4">
        {reports.length === 0 ? (
          <div className="bg-slate-800/50 rounded-xl p-8 text-center">
            <span className="text-4xl">📍</span>
            <h3 className="text-xl font-semibold text-white mt-4">Aucun signalement</h3>
            <p className="text-slate-400 mt-2">Soyez le premier à signaler un incident dans votre zone</p>
          </div>
        ) : (
          reports.map((report) => (
            <div key={report.id} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{report.title}</h3>
                  <p className="text-slate-400">{report.description}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  report.type === 'crime' ? 'bg-red-500/20 text-red-400' :
                  report.type === 'weather' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {report.type}
                </span>
              </div>
              <div className="flex justify-between text-sm text-slate-500">
                <span>Score: {report.trust_score}/100</span>
                <span>{new Date(report.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {showCreateForm && (
        <CreateReportModal onClose={() => setShowCreateForm(false)} onSuccess={fetchReports} />
      )}
    </div>
  );
};

// Create Report Modal
const CreateReportModal = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    type: 'crime',
    title: '',
    description: '',
    latitude: 0,
    longitude: 0
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Get user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setFormData(prev => ({
          ...prev,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        }));
      });
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.post('/reports', formData);
      toast.success('Signalement créé avec succès');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error('Erreur lors de la création du signalement');
    }

    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white">Nouveau Signalement</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-cyan-500 focus:outline-none"
            >
              <option value="crime">Crime</option>
              <option value="harassment">Harcèlement</option>
              <option value="robbery">Vol</option>
              <option value="transport">Transport</option>
              <option value="fire">Incendie</option>
              <option value="flood">Inondation</option>
              <option value="weather">Météo</option>
              <option value="other">Autre</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Titre</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none"
              placeholder="Titre du signalement"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none resize-none"
              rows="4"
              placeholder="Décrivez l'incident..."
              required
            />
          </div>

          <div className="flex space-x-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-500 to-green-500 text-white rounded-lg hover:from-cyan-600 hover:to-green-600 disabled:opacity-50 transition-all"
            >
              {loading ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// SOS View Component
const SOSView = () => {
  const [contacts, setContacts] = useState([]);
  const [activeSOS, setActiveSOS] = useState(null);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const response = await api.get('/contacts');
      setContacts(response.data);
    } catch (error) {
      toast.error('Erreur lors du chargement des contacts');
    }
  };

  const handleSOS = async () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const response = await api.post('/sos/start', {
            message: "URGENCE - J'ai besoin d'aide immédiatement !",
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          
          setActiveSOS(response.data);
          toast.success('Alerte SOS envoyée !');
        } catch (error) {
          toast.error('Erreur lors de l\'envoi de l\'alerte SOS');
        }
      });
    }
  };

  const endSOS = async () => {
    if (activeSOS) {
      try {
        await api.post(`/sos/${activeSOS.id}/end`);
        setActiveSOS(null);
        toast.success('Alerte SOS terminée');
      } catch (error) {
        toast.error('Erreur lors de l\'arrêt de l\'alerte SOS');
      }
    }
  };

  return (
    <div className="h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Système SOS</h2>
        <div className="text-slate-400">
          {contacts.length} contact(s) d'urgence
        </div>
      </div>

      {/* SOS Status */}
      <div className="mb-8">
        {activeSOS ? (
          <div className="bg-red-500/20 border border-red-500 rounded-xl p-6 text-center">
            <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl animate-pulse">🚨</span>
            </div>
            <h3 className="text-xl font-bold text-red-400 mb-2">ALERTE SOS ACTIVE</h3>
            <p className="text-red-300 mb-4">Vos contacts ont été notifiés</p>
            <button
              onClick={endSOS}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Terminer l'alerte
            </button>
          </div>
        ) : (
          <div className="bg-slate-800/50 rounded-xl p-8 text-center border border-slate-700">
            <div className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-white text-3xl">SOS</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-4">Système SOS d'urgence</h3>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              En cas d'urgence, appuyez sur le bouton SOS pour alerter immédiatement vos contacts d'urgence
            </p>
            <button
              onClick={handleSOS}
              className="px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white text-lg font-bold rounded-xl hover:from-red-600 hover:to-red-700 transition-all transform hover:scale-105 shadow-lg"
            >
              DÉCLENCHER SOS
            </button>
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Contacts d'urgence</h3>
        {contacts.length === 0 ? (
          <div className="bg-slate-800/50 rounded-xl p-6 text-center border border-slate-700">
            <p className="text-slate-400">Aucun contact d'urgence configuré</p>
          </div>
        ) : (
          contacts.map((contact) => (
            <div key={contact.id} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="font-semibold text-white">{contact.name}</h4>
                  <p className="text-slate-400">{contact.phone}</p>
                  <p className="text-xs text-slate-500">{contact.relationship}</p>
                </div>
                <button className="text-red-400 hover:text-red-300 transition-colors">
                  Supprimer
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// Contacts View Component
const ContactsView = () => {
  const [contacts, setContacts] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const response = await api.get('/contacts');
      setContacts(response.data);
    } catch (error) {
      toast.error('Erreur lors du chargement des contacts');
    }
  };

  const deleteContact = async (contactId) => {
    try {
      await api.delete(`/contacts/${contactId}`);
      toast.success('Contact supprimé');
      fetchContacts();
    } catch (error) {
      toast.error('Erreur lors de la suppression');
    }
  };

  return (
    <div className="h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Contacts d'Urgence</h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-green-500 text-white rounded-lg hover:from-cyan-600 hover:to-green-600 transition-all"
        >
          Ajouter un contact
        </button>
      </div>

      <div className="grid gap-4">
        {contacts.length === 0 ? (
          <div className="bg-slate-800/50 rounded-xl p-8 text-center border border-slate-700">
            <span className="text-4xl">👥</span>
            <h3 className="text-xl font-semibold text-white mt-4">Aucun contact d'urgence</h3>
            <p className="text-slate-400 mt-2">Ajoutez vos contacts d'urgence pour recevoir des alertes SOS</p>
          </div>
        ) : (
          contacts.map((contact) => (
            <div key={contact.id} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold text-white">{contact.name}</h3>
                  <p className="text-slate-400">{contact.phone}</p>
                  {contact.email && <p className="text-slate-400">{contact.email}</p>}
                  <span className="inline-block mt-2 px-3 py-1 bg-slate-700 text-slate-300 text-sm rounded-full">
                    {contact.relationship}
                  </span>
                </div>
                <button
                  onClick={() => deleteContact(contact.id)}
                  className="text-red-400 hover:text-red-300 transition-colors"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showAddForm && (
        <AddContactModal onClose={() => setShowAddForm(false)} onSuccess={fetchContacts} />
      )}
    </div>
  );
};

// Add Contact Modal
const AddContactModal = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    relationship: 'family'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.post('/contacts', formData);
      toast.success('Contact ajouté avec succès');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error('Erreur lors de l\'ajout du contact');
    }

    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white">Ajouter un Contact</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Nom</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none"
              placeholder="Nom du contact"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Téléphone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none"
              placeholder="Numéro de téléphone"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Email (optionnel)</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none"
              placeholder="Adresse email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Relation</label>
            <select
              value={formData.relationship}
              onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-cyan-500 focus:outline-none"
            >
              <option value="family">Famille</option>
              <option value="friend">Ami(e)</option>
              <option value="colleague">Collègue</option>
              <option value="partner">Partenaire</option>
              <option value="other">Autre</option>
            </select>
          </div>

          <div className="flex space-x-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-500 to-green-500 text-white rounded-lg hover:from-cyan-600 hover:to-green-600 disabled:opacity-50 transition-all"
            >
              {loading ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Premium View Component
const PremiumView = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async (plan) => {
    setLoading(true);
    try {
      const response = await api.post('/payments/checkout', { plan });
      window.location.href = response.data.url;
    } catch (error) {
      toast.error('Erreur lors de la redirection vers le paiement');
      setLoading(false);
    }
  };

  if (user?.is_premium) {
    return (
      <div className="h-full">
        <div className="text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-white text-3xl">⭐</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">Vous êtes Premium !</h2>
          <p className="text-slate-400 mb-8">Profitez de toutes les fonctionnalités avancées</p>
          
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-4">✓ SOS Illimité</h3>
              <p className="text-slate-400">Alertes d'urgence vers tous vos contacts</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-4">✓ Rayon Étendu</h3>
              <p className="text-slate-400">Alertes jusqu'à 20km de distance</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-4">✓ Notifications Prioritaires</h3>
              <p className="text-slate-400">Alertes importantes en temps réel</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-4">✓ Médias Illimités</h3>
              <p className="text-slate-400">Upload photos/vidéos sans limite</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white mb-4">Passez à Premium</h2>
        <p className="text-xl text-slate-400">Débloquez toutes les fonctionnalités avancées</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Monthly Plan */}
        <div className="bg-slate-800/50 rounded-2xl p-8 border border-slate-700">
          <div className="text-center mb-6">
            <h3 className="text-2xl font-bold text-white mb-2">Premium Mensuel</h3>
            <div className="text-4xl font-bold text-cyan-400 mb-2">9,99€</div>
            <p className="text-slate-400">par mois</p>
          </div>
          
          <ul className="space-y-3 mb-8">
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              SOS contacts illimités
            </li>
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              Rayon d'alerte 20km
            </li>
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              Notifications prioritaires
            </li>
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              Médias illimités
            </li>
          </ul>
          
          <button
            onClick={() => handleUpgrade('premium_monthly')}
            disabled={loading}
            className="w-full px-6 py-3 bg-gradient-to-r from-cyan-500 to-green-500 text-white font-semibold rounded-lg hover:from-cyan-600 hover:to-green-600 disabled:opacity-50 transition-all"
          >
            {loading ? 'Redirection...' : 'Choisir Mensuel'}
          </button>
        </div>

        {/* Yearly Plan */}
        <div className="bg-slate-800/50 rounded-2xl p-8 border-2 border-yellow-500 relative">
          <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
            <span className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black px-4 py-1 rounded-full text-sm font-bold">
              ÉCONOMISEZ 17%
            </span>
          </div>
          
          <div className="text-center mb-6">
            <h3 className="text-2xl font-bold text-white mb-2">Premium Annuel</h3>
            <div className="text-4xl font-bold text-yellow-400 mb-2">99,99€</div>
            <p className="text-slate-400">par an</p>
            <p className="text-sm text-green-400 mt-1">Soit 8,33€/mois</p>
          </div>
          
          <ul className="space-y-3 mb-8">
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              Toutes les fonctionnalités Premium
            </li>
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              Mode escorte avancé
            </li>
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              Support prioritaire
            </li>
            <li className="flex items-center text-slate-300">
              <span className="text-green-400 mr-3">✓</span>
              Fonctionnalités exclusives
            </li>
          </ul>
          
          <button
            onClick={() => handleUpgrade('premium_yearly')}
            disabled={loading}
            className="w-full px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-semibold rounded-lg hover:from-yellow-600 hover:to-orange-600 disabled:opacity-50 transition-all"
          >
            {loading ? 'Redirection...' : 'Choisir Annuel'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Floating SOS Button
const SOSButton = () => {
  const [isPressed, setIsPressed] = useState(false);

  const handleSOS = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          await api.post('/sos/start', {
            message: "URGENCE - J'ai besoin d'aide immédiatement !",
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          
          toast.success('Alerte SOS envoyée !');
        } catch (error) {
          toast.error('Erreur lors de l\'envoi de l\'alerte SOS');
        }
      });
    }
  };

  return (
    <button
      onClick={handleSOS}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      className={`fixed bottom-8 right-8 w-16 h-16 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-lg hover:from-red-600 hover:to-red-700 transition-all transform ${
        isPressed ? 'scale-95' : 'hover:scale-110'
      } z-50`}
      title="Appuyez en cas d'urgence"
    >
      SOS
    </button>
  );
};

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-green-400 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <div className="w-8 h-8 border-2 border-white rounded-full"></div>
          </div>
          <p className="text-white">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Main App Component
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="App">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster 
            position="top-right"
            toastOptions={{
              style: {
                background: '#1e293b',
                color: '#fff',
                border: '1px solid #374151',
              },
            }}
          />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;