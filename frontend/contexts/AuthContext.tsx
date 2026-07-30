'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface User {
  id: string;
  email: string;
  company_info_id?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, company_name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          // Simple JWT decode for payload
          const payload = JSON.parse(atob(token.split('.')[1]));
          setUser({
            id: payload.id || payload.sub,
            email: payload.email,
            company_info_id: payload.company_info_id
          });
        } catch (error) {
          console.error("Failed to decode token", error);
          localStorage.removeItem('token');
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Login failed');
      }

      const data = await res.json();
      localStorage.setItem('token', data.token);
      
      const payload = JSON.parse(atob(data.token.split('.')[1]));
      setUser({
        id: payload.id || payload.sub,
        email: payload.email,
        company_info_id: payload.company_info_id
      });
      toast.success('Successfully logged in!');
    } catch (error: any) {
      toast.error(error.message || 'An error occurred during login');
      throw error;
    }
  };

  const register = async (email: string, password: string, company_name: string) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, company_name }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Registration failed');
      }

      const data = await res.json();
      localStorage.setItem('token', data.token);
      
      const payload = JSON.parse(atob(data.token.split('.')[1]));
      setUser({
        id: payload.id || payload.sub,
        email: payload.email,
        company_info_id: payload.company_info_id
      });
      toast.success('Successfully registered!');
    } catch (error: any) {
      toast.error(error.message || 'An error occurred during registration');
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    router.push('/login');
    toast.success('Logged out');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
