'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import HubSpotIntegration from "@/components/integrations/HubSpot";
import SalesforceIntegration from "@/components/integrations/Salesforce";
import { fetchCrmStatus, syncAllCrms } from "@/lib/api";
import toast from "react-hot-toast";
import { Cloud, Layers, RefreshCw, ArrowLeftRight, Loader2 } from "lucide-react";

type CrmStatusData = {
  hubspot?: { connected: boolean; hub_id?: string; deals_count?: number };
  salesforce?: { connected: boolean; org_id?: string; opportunities_count?: number };
  cross_crm?: { active: boolean; total_ephy_deals: number; dual_synced_deals: number; mode: string };
};

export default function HomePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [selectedIntegration, setSelectedIntegration] = useState<'hubspot' | 'salesforce'>('hubspot');
  const [crmStatus, setCrmStatus] = useState<CrmStatusData | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) loadCrmStatus();
  }, [user]);

  const loadCrmStatus = async () => {
    try {
      const res = await fetchCrmStatus();
      const json = await res.json();
      if (json.status === 200) {
        setCrmStatus(json);
      }
    } catch {
      // ignore silent status fetch error
    }
  };

  const handleDualSyncAll = async () => {
    setSyncingAll(true);
    try {
      const res = await syncAllCrms();
      const json = await res.json();
      if (json.status === 200) {
        toast.success(json.message || "Unified Dual-CRM Sync started!");
        setTimeout(() => loadCrmStatus(), 2000);
      } else {
        toast.error(json.error || "Failed to start dual sync");
      }
    } catch {
      toast.error("Error triggering unified CRM sync");
    } finally {
      setSyncingAll(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ff7a59]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Top Navigation */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex-shrink-0 flex items-center gap-2">
              <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#ff7a59] via-[#00A1E0] to-[#e5694d]">
                EPHY
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">
                Multi-CRM Core Prototype
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
          {/* Header Card */}
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg mb-6 p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                  Settings & Multi-CRM Hub
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  HubSpot & Salesforce are linked via EPHY's unified core deal entity (<code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">SalesFile</code>) for real-time bi-directional cross-CRM sync.
                </p>
              </div>

              {(crmStatus?.hubspot?.connected || crmStatus?.salesforce?.connected) && (
                <button
                  onClick={handleDualSyncAll}
                  disabled={syncingAll}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#ff7a59] to-[#00A1E0] hover:opacity-90 text-white text-xs font-bold rounded-xl transition-all shadow-md disabled:opacity-50"
                >
                  {syncingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Dual Sync All CRMs
                </button>
              )}
            </div>

            {/* Cross-CRM Connection Architecture Indicator */}
            {crmStatus && (
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/40 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#ff7a59] text-white flex items-center justify-center font-bold">HS</div>
                  <div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white block">HubSpot CRM</span>
                    <span className={`text-[10px] font-medium ${crmStatus.hubspot?.connected ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>
                      {crmStatus.hubspot?.connected ? `Connected (ID: ${crmStatus.hubspot.hub_id || "Portal"})` : "Disconnected"}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/40 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#00A1E0] text-white flex items-center justify-center font-bold">SF</div>
                  <div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white block">Salesforce CRM</span>
                    <span className={`text-[10px] font-medium ${crmStatus.salesforce?.connected ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>
                      {crmStatus.salesforce?.connected ? `Connected (Org: ${crmStatus.salesforce.org_id || "Org"})` : "Disconnected"}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-600 text-white flex items-center justify-center">
                    <ArrowLeftRight className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white block">Cross-CRM Pipeline</span>
                    <span className="text-[10px] font-medium text-purple-700 dark:text-purple-300 block">
                      {crmStatus.cross_crm?.active ? "Active Bi-directional Propagation" : "HubSpot ↔ EPHY ↔ Salesforce"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Integration Switcher Tabs */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setSelectedIntegration('hubspot')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-sm ${
                  selectedIntegration === 'hubspot'
                    ? 'bg-[#ff7a59] text-white ring-2 ring-[#ff7a59]/30'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <Layers className="w-4 h-4" />
                HubSpot Integration
              </button>

              <button
                onClick={() => setSelectedIntegration('salesforce')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-sm ${
                  selectedIntegration === 'salesforce'
                    ? 'bg-[#00A1E0] text-white ring-2 ring-[#00A1E0]/30'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <Cloud className="w-4 h-4" />
                Salesforce Integration
              </button>
            </div>
          </div>

          {/* Integration Component View */}
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-6">
              {selectedIntegration === 'hubspot' && <HubSpotIntegration onConnectionChange={loadCrmStatus} />}
              {selectedIntegration === 'salesforce' && <SalesforceIntegration onConnectionChange={loadCrmStatus} />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
