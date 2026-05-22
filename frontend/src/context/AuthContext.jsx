import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);
export const API_BASE = 'http://localhost:8000/api/v1';

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState('');
  const [user, setUser] = useState(null); 
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('accessToken');
    
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
      setAccessToken(savedToken);
    }
    setLoading(false);
  }, []);

  const login = (userData, token, refreshToken) => {
    setUser(userData);
    setAccessToken(token);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('accessToken', token);
    localStorage.setItem('refreshToken', refreshToken);
  };

  // НОВИЙ МЕТОД: Дозволяє динамічно збагачувати або оновлювати профіль ресторану в сесії
  const updateRestaurantProfile = (profileData) => {
    setUser(prev => {
      if (!prev) return null;
      const updatedUser = {
        ...prev,
        restaurantProfile: {
          ...(prev.restaurantProfile || {}),
          ...profileData
        }
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      return updatedUser;
    });
  };

  const logout = () => {
    setUser(null);
    setAccessToken('');
    localStorage.removeItem('user');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  };

  const handleTokenRefresh = async () => {
    const currentRefreshToken = localStorage.getItem('refreshToken');
    if (!currentRefreshToken) {
      logout();
      return null;
    }

    try {
      const res = await fetch(`${API_BASE}/users/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: currentRefreshToken })
      });

      if (res.ok) {
        const data = await res.json();
        setAccessToken(data.accessToken);
        localStorage.setItem('accessToken', data.accessToken);
        
        if (data.refreshToken) {
            localStorage.setItem('refreshToken', data.refreshToken);
        }
        return data.accessToken;
      } else {
        logout();
        return null;
      }
    } catch (err) {
      console.error("Token refresh processing failed:", err);
      logout();
      return null;
    }
  };

  const authenticatedFetch = async (url, options = {}) => {
    let tokenToUse = accessToken || localStorage.getItem('accessToken');

    if (!tokenToUse && localStorage.getItem('refreshToken')) {
      tokenToUse = await handleTokenRefresh();
    }

    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${tokenToUse}`,
      'Content-Type': 'application/json'
    };

    try {
      let response = await fetch(url, { ...options, headers });

      if (response.status === 401 || response.status === 403) {
        const newValidToken = await handleTokenRefresh();
        if (newValidToken) {
          headers['Authorization'] = `Bearer ${newValidToken}`;
          response = await fetch(url, { ...options, headers });
        } else {
          logout();
          throw new Error("Session expired");
        }
      }
      return response;
    } catch (error) {
      console.error("Fetch error:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, logout, authenticatedFetch, updateRestaurantProfile }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);