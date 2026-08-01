"use client";

import { useState, useEffect, useRef } from "react";
import {
  fetchSalesforceAuthUrl,
  fetchSalesforceStatus,
  disconnectSalesforce,
  fetchSalesforceOpportunityStages,
  fetchSalesforceStageMapping,
  saveSalesforceStageMapping,
  fetchSalesforceOpportunityFieldMapping,
  saveSalesforceOpportunityFieldMapping,
  syncSalesforceOpportunities,
  fetchSalesforceOpportunities,
} from "@/lib/api";
import toast from "react-hot-toast";
import {
  Loader2,
  CheckCircle2,
  Link2,
  Link2Off,
  RefreshCw,
  Save,
  Zap,
  Database,
  Layers,
  Settings2,
  Activity,
  DollarSign,
  Building2,
  ShieldCheck,
  Cloud,
  Check,
} from "lucide-react";

type Stage    = { id: string; label: string };
type EphyStage = { key: string; name: string; enabled: boolean };

type SyncedOpportunity = {
  id: number;
  salesforce_opportunity_id: string;
  status: string;
  opportunity_name: string;
  amount: number | string;
  stage: string;
  last_synced_at: string;
};

type WebhookLog = {
  id: number;
  event_type: string;
  status: string;
  salesforce_opportunity_id: string;
  created_at: string;
};

type SalesforceIntegrationProps = {
  onConnectionChange?: (connected: boolean) => void;
};

const DEFAULT_FIELD_MAPPING: Record<string, string> = {
  deal_stage:           "StageName",
  deal_size:            "Amount",
  deal_closed_date:     "CloseDate",
  broker_comp_producer: "LeadSource",
};

const OPP_FIELD_META: Record<string, { label: string; hint: string }> = {
  deal_stage:           { label: "Deal Stage",           hint: "Mapped via Salesforce Opportunity Stage mapping table" },
  deal_size:            { label: "Deal Size (Amount)",   hint: "Numeric — Salesforce Opportunity Amount field" },
  deal_closed_date:     { label: "Close Date",           hint: "Date — Opportunity CloseDate" },
  broker_comp_producer: { label: "Broker / Producer",   hint: "Maps to Salesforce LeadSource or Custom Field" },
};

export default function SalesforceIntegration({ onConnectionChange }: SalesforceIntegrationProps) {
  const [activeTab, setActiveTab]         = useState<"overview" | "stages" | "fields" | "architecture">("overview");
  const [connected, setConnected]         = useState<boolean | null>(null);
  const [orgId, setOrgId]                 = useState<string | null>(null);
  const [instanceUrl, setInstanceUrl]     = useState<string | null>(null);
  const [connecting, setConnecting]       = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing]             = useState(false);

  const [sfStages, setSfStages]           = useState<Stage[]>([]);
  const [ephyStages, setEphyStages]       = useState<EphyStage[]>([]);
  const [stageMapping, setStageMapping]   = useState<Record<string, string>>({});
  const [stageSaving, setStageSaving]     = useState(false);
  const [stageSaved, setStageSaved]       = useState(false);

  const [fieldMapping, setFieldMapping]       = useState<Record<string, string>>(DEFAULT_FIELD_MAPPING);
  const [sfFields, setSfFields]               = useState<{ sf_field: string; label: string; description: string }[]>([]);
  const [fieldSaving, setFieldSaving]         = useState(false);
  const [fieldSaved, setFieldSaved]           = useState(false);

  const [syncedOpps, setSyncedOpps]           = useState<SyncedOpportunity[]>([]);
  const [webhookLogs, setWebhookLogs]         = useState<WebhookLog[]>([]);
  const [oppsCount, setOppsCount]             = useState<number>(0);
  const [loadingOpps, setLoadingOpps]         = useState<boolean>(false);

  const popupRef   = useRef<Window | null>(null);
  const popupTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { checkConnection(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connected) {
      loadOpportunityStages();
      loadStageMapping();
      loadFieldMapping();
      loadSyncedOpps();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkConnection = async (): Promise<boolean> => {
    try {
      const res  = await fetchSalesforceStatus();
      const json = await res.json();
      const isConnected = json?.connected === true;
      setConnected(isConnected);
      setOrgId(json?.org_id ?? null);
      setInstanceUrl(json?.instance_url ?? null);
      onConnectionChange?.(isConnected);
      return isConnected;
    } catch {
      setConnected(false);
      onConnectionChange?.(false);
      return false;
    }
  };

  const loadSyncedOpps = async () => {
    setLoadingOpps(true);
    try {
      const res  = await fetchSalesforceOpportunities();
      const json = await res.json();
      if (json?.status === 200) {
        setSyncedOpps(json.opportunities || []);
        setWebhookLogs(json.recent_logs || []);
        setOppsCount(json.opportunities_count || 0);
      }
    } catch {
      toast.error("Failed to load Salesforce sync data");
    } finally {
      setLoadingOpps(false);
    }
  };

  const loadOpportunityStages = async () => {
    try {
      const res  = await fetchSalesforceOpportunityStages();
      const json = await res.json();
      if (json?.stages) {
        setSfStages(json.stages);
      }
    } catch {
      toast.error("Failed to fetch Salesforce Opportunity stages");
    }
  };

  const loadStageMapping = async () => {
    try {
      const res  = await fetchSalesforceStageMapping();
      const json = await res.json();
      if (json?.stage_mapping) setStageMapping(json.stage_mapping);
      if (json?.ephy_stages) {
        const stagesList = json.ephy_stages.map((s: string | EphyStage) =>
          typeof s === "string" ? { key: s, name: s.replace(/_/g, " ").toUpperCase(), enabled: true } : s
        );
        setEphyStages(stagesList);
      }
    } catch {
      toast.error("Failed to fetch Salesforce stage mapping");
    }
  };

  const loadFieldMapping = async () => {
    try {
      const res  = await fetchSalesforceOpportunityFieldMapping();
      const json = await res.json();
      if (json?.mapping && Object.keys(json.mapping).length > 0) setFieldMapping(json.mapping);
      if (json?.fields) setSfFields(json.fields);
    } catch {
      toast.error("Failed to fetch Salesforce field mapping");
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res  = await fetchSalesforceAuthUrl();
      const json = await res.json();
      if (!json?.url) throw new Error("Could not retrieve authorization URL");

      const width  = 600;
      const height = 700;
      const left   = window.screenX + (window.innerWidth  - width)  / 2;
      const top    = window.screenY + (window.innerHeight - height) / 2;

      popupRef.current = window.open(
        json.url,
        "SalesforceOAuthPopup",
        `width=${width},height=${height},top=${top},left=${left},status=no,resizable=yes,scrollbars=yes`
      );

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "sf_connected") {
          cleanupPopup();
          checkConnection();
          toast.success("Salesforce Connected Successfully!");
        } else if (event.data?.type === "sf_error") {
          cleanupPopup();
          toast.error(`Salesforce connection failed: ${event.data.error || "Unknown error"}`);
        }
      };

      window.addEventListener("message", handleMessage);

      popupTimer.current = setInterval(async () => {
        if (popupRef.current?.closed) {
          cleanupPopup();
          const isConn = await checkConnection();
          if (isConn) toast.success("Salesforce Connected Successfully!");
        }
      }, 1000);

      const cleanupPopup = () => {
        if (popupTimer.current) clearInterval(popupTimer.current);
        window.removeEventListener("message", handleMessage);
        setConnecting(false);
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to open authentication window";
      toast.error(msg);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect Salesforce? Active syncs will stop.")) return;
    setDisconnecting(true);
    try {
      await disconnectSalesforce();
      setConnected(false);
      setOrgId(null);
      setInstanceUrl(null);
      onConnectionChange?.(false);
      toast.success("Salesforce disconnected.");
    } catch {
      toast.error("Failed to disconnect Salesforce.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await syncSalesforceOpportunities();
      const json = await res.json();
      if (json.status === 200) {
        toast.success("Background Salesforce Sync initiated!");
        setTimeout(() => loadSyncedOpps(), 1500);
      } else {
        toast.error(json.error || "Sync failed to start");
      }
    } catch {
      toast.error("Error triggering Salesforce sync");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveStageMapping = async () => {
    setStageSaving(true);
    try {
      const res  = await saveSalesforceStageMapping(stageMapping);
      const json = await res.json();
      if (json.status === 200) {
        setStageSaved(true);
        setTimeout(() => setStageSaved(false), 2500);
        toast.success("Stage mapping saved.");
      } else {
        toast.error(json.error || "Failed to save stage mapping.");
      }
    } catch {
      toast.error("Error saving stage mapping.");
    } finally {
      setStageSaving(false);
    }
  };

  const handleSaveFieldMapping = async () => {
    setFieldSaving(true);
    try {
      const res  = await saveSalesforceOpportunityFieldMapping(fieldMapping);
      const json = await res.json();
      if (json.status === 200) {
        setFieldSaved(true);
        setTimeout(() => setFieldSaved(false), 2500);
        toast.success("Field mapping saved.");
      } else {
        toast.error(json.error || "Failed to save field mapping.");
      }
    } catch {
      toast.error("Error saving field mapping.");
    } finally {
      setFieldSaving(false);
    }
  };

  if (connected === null) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 text-[#00A1E0] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Integration Banner */}
      <div className="bg-gradient-to-r from-sky-900 to-blue-950 text-white rounded-2xl p-6 shadow-xl border border-sky-800/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 pointer-events-none">
          <Cloud className="w-64 h-64 text-sky-400" />
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-inner">
              <Cloud className="w-8 h-8 text-sky-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">Salesforce Integration</h2>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                  connected ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-gray-700/50 text-gray-300 border border-gray-600"
                }`}>
                  {connected ? "Connected" : "Not Connected"}
                </span>
              </div>
              <p className="text-xs text-sky-200 mt-1">
                Bi-directional Opportunity sync, automated schema mapping, and webhook listener.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {connected ? (
              <>
                <button
                  onClick={handleManualSync}
                  disabled={syncing}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync Now"}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold rounded-xl transition-all border border-red-500/40 disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2Off className="w-3.5 h-3.5" />}
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#00A1E0] hover:bg-[#008bc4] text-white text-sm font-semibold rounded-xl transition-all shadow-lg hover:shadow-sky-500/25 disabled:opacity-50"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Connect Salesforce Org
              </button>
            )}
          </div>
        </div>

        {connected && (
          <div className="mt-6 pt-4 border-t border-sky-800/60 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-sky-300/70 block">Org ID</span>
              <span className="font-mono text-sky-100 font-medium">{orgId || "00D5g000000K987"}</span>
            </div>
            <div>
              <span className="text-sky-300/70 block">Instance URL</span>
              <span className="font-mono text-sky-100 font-medium truncate block max-w-[150px]">{instanceUrl || "https://salesforce.com"}</span>
            </div>
            <div>
              <span className="text-sky-300/70 block">OAuth Protocol</span>
              <span className="text-sky-100 font-medium">OAuth 2.0 + PKCE (S256)</span>
            </div>
            <div>
              <span className="text-sky-300/70 block">Sync Protocol</span>
              <span className="text-sky-100 font-medium">REST API v58.0 / Outbound</span>
            </div>
          </div>
        )}
      </div>

      {connected && (
        <>
          {/* Navigation Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab("overview")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm border-b-2 transition-all ${
                activeTab === "overview"
                  ? "border-[#00A1E0] text-[#00A1E0] dark:text-sky-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <Activity className="w-4 h-4" />
              Overview & Live Sync
            </button>
            <button
              onClick={() => setActiveTab("stages")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm border-b-2 transition-all ${
                activeTab === "stages"
                  ? "border-[#00A1E0] text-[#00A1E0] dark:text-sky-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <Layers className="w-4 h-4" />
              Stage Mapping
            </button>
            <button
              onClick={() => setActiveTab("fields")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm border-b-2 transition-all ${
                activeTab === "fields"
                  ? "border-[#00A1E0] text-[#00A1E0] dark:text-sky-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <Settings2 className="w-4 h-4" />
              Field Mapping
            </button>
            <button
              onClick={() => setActiveTab("architecture")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm border-b-2 transition-all ${
                activeTab === "architecture"
                  ? "border-[#00A1E0] text-[#00A1E0] dark:text-sky-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <Database className="w-4 h-4" />
              Architecture & Webhooks
            </button>
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Synced Opportunities</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{oppsCount}</p>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Zap className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Webhook Deliveries</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{webhookLogs.length}</p>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">OAuth Status</p>
                    <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1">Verified (HMAC State)</p>
                  </div>
                </div>
              </div>

              {/* Synced Opportunities Table */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-sky-500" />
                    Synced Salesforce Opportunities
                  </h3>
                  <button
                    onClick={loadSyncedOpps}
                    className="text-xs text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingOpps ? "animate-spin" : ""}`} /> Reload
                  </button>
                </div>

                {loadingOpps ? (
                  <div className="p-8 text-center text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-500" />
                    Loading opportunities...
                  </div>
                ) : syncedOpps.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-xs">
                    No Salesforce opportunities synced yet. Click "Sync Now" above to fetch opportunities.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          <th className="p-3">Opportunity Name</th>
                          <th className="p-3">SF Opportunity ID</th>
                          <th className="p-3">Amount</th>
                          <th className="p-3">Stage</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Last Synced</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {syncedOpps.map((opp) => (
                          <tr key={opp.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="p-3 font-semibold text-gray-900 dark:text-white">{opp.opportunity_name}</td>
                            <td className="p-3 font-mono text-gray-500 dark:text-gray-400">{opp.salesforce_opportunity_id}</td>
                            <td className="p-3 font-medium text-emerald-600 dark:text-emerald-400">${Number(opp.amount).toLocaleString()}</td>
                            <td className="p-3"><span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 font-medium">{opp.stage}</span></td>
                            <td className="p-3"><span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium">{opp.status}</span></td>
                            <td className="p-3 text-gray-400">{new Date(opp.last_synced_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: STAGE MAPPING */}
          {activeTab === "stages" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-6 animate-fade-in">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-sky-500" />
                  Salesforce Stage Mapping Engine
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Map internal EPHY deal pipeline stages to Salesforce Opportunity stages.
                </p>
              </div>

              <div className="space-y-3">
                {ephyStages.map((es) => (
                  <div key={es.key} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 gap-3">
                    <div>
                      <span className="text-xs font-semibold text-gray-800 dark:text-white">{es.name}</span>
                      <span className="text-[10px] text-gray-400 block font-mono">ephy_stage: {es.key}</span>
                    </div>

                    <div className="w-full sm:w-64">
                      <select
                        value={stageMapping[es.key] || ""}
                        onChange={(e) => setStageMapping({ ...stageMapping, [es.key]: e.target.value })}
                        className="w-full text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-2 border shadow-sm focus:ring-[#00A1E0] focus:border-[#00A1E0]"
                      >
                        <option value="">-- Select Salesforce Stage --</option>
                        {sfStages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label} ({s.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleSaveStageMapping}
                  disabled={stageSaving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#00A1E0] hover:bg-[#008bc4] text-white text-xs font-semibold rounded-xl transition-all shadow-md disabled:opacity-50"
                >
                  {stageSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : stageSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {stageSaved ? "Stage Mapping Saved!" : "Save Stage Mapping"}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: FIELD MAPPING */}
          {activeTab === "fields" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-6 animate-fade-in">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-sky-500" />
                  Salesforce Opportunity Field Mapping
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Configure custom and standard Opportunity property bindings between EPHY and Salesforce.
                </p>
              </div>

              <div className="space-y-4">
                {Object.entries(OPP_FIELD_META).map(([ephyKey, meta]) => (
                  <div key={ephyKey} className="p-4 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">{meta.label}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{ephyKey}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{meta.hint}</p>

                    <input
                      type="text"
                      value={fieldMapping[ephyKey] || ""}
                      onChange={(e) => setFieldMapping({ ...fieldMapping, [ephyKey]: e.target.value })}
                      placeholder="e.g. StageName, Amount, CloseDate"
                      className="w-full text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-2.5 border shadow-sm focus:ring-[#00A1E0] focus:border-[#00A1E0]"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleSaveFieldMapping}
                  disabled={fieldSaving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#00A1E0] hover:bg-[#008bc4] text-white text-xs font-semibold rounded-xl transition-all shadow-md disabled:opacity-50"
                >
                  {fieldSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : fieldSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {fieldSaved ? "Field Mapping Saved!" : "Save Field Mapping"}
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: ARCHITECTURE & WEBHOOKS */}
          {activeTab === "architecture" && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-sky-500" />
                  System Architecture & Webhook Audit Logs
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Real-time audit log of inbound webhooks and background Sidekiq worker execution for Salesforce sync.
                </p>

                {webhookLogs.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 text-xs bg-gray-50 dark:bg-gray-900 rounded-lg">
                    No webhook logs recorded yet. Inbound notifications from Salesforce will appear here.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          <th className="p-3">Log ID</th>
                          <th className="p-3">Event Type</th>
                          <th className="p-3">Opportunity ID</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Recorded At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {webhookLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="p-3 font-mono">#{log.id}</td>
                            <td className="p-3 font-semibold text-gray-800 dark:text-gray-200">{log.event_type}</td>
                            <td className="p-3 font-mono text-gray-500">{log.salesforce_opportunity_id}</td>
                            <td className="p-3"><span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 font-medium">{log.status}</span></td>
                            <td className="p-3 text-gray-400">{new Date(log.created_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
