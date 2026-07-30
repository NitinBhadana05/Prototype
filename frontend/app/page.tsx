'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import HubSpotIntegration from "@/components/integrations/HubSpot";

export default function HomePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ff7a59]"></div>
    </div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Top Navigation */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex-shrink-0 flex items-center">
              <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#ff7a59] to-[#e5694d]">
                EPHY
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500 dark:text-gray-300">
                {user.email}
              </span>
              <button
                onClick={logout}
                className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-[#ff7a59] dark:hover:text-[#ff7a59] transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl animate-slide-in">
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg mb-8 p-6 border border-gray-200 dark:border-gray-700">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Settings & Integrations
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              Manage your AI-Powered HR Compliance integrations.
            </p>
          </div>
          
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-6">
              <HubSpotIntegration />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
