"use client";

import { useState, useEffect, useRef } from "react";
import {
  fetchHubspotAuthUrl,
  fetchHubspotStatus,
  disconnectHubspot,
  fetchHubspotPipelines,
  fetchHubspotPipelineStages,
  fetchHubspotStageMapping,
  saveHubspotStageMapping,
  fetchHubspotDealFieldMapping,
  saveHubspotDealFieldMapping,
  syncHubspotDeals,
  fetchHubspotDeals,
} from "@/lib/api";
import toast from "react-hot-toast";
import {
  Loader2,
  CheckCircle2,
  Link2,
  Link2Off,
  RefreshCw,
  Save,
  ArrowLeftRight,
  Zap,
  Database,
  Layers,
  Settings2,
  Activity,
  DollarSign,
  Building2,
  Check,
  ShieldCheck,
} from "lucide-react";

type Pipeline = { id: string; label: string };
type Stage    = { id: string; label: string };
type EphyStage = { key: string; name: string; enabled: boolean };

type SyncedDeal = {
  id: number;
  hubspot_deal_id: string;
  status: string;
  deal_name: string;
  amount: number | string;
  stage: string;
  last_synced_at: string;
};

type WebhookLog = {
  id: number;
  event_type: string;
  status: string;
  hubspot_deal_id: string;
  created_at: string;
};

type HubSpotIntegrationProps = {
  onConnectionChange?: (connected: boolean) => void;
};

const DEFAULT_FIELD_MAPPING: Record<string, string> = {
  deal_stage:           "dealstage",
  deal_size:            "amount",
  deal_closed_date:     "closedate",
  broker_comp_producer: "hs_deal_source",
};

const DEAL_FIELD_META: Record<string, { label: string; hint: string }> = {
  deal_stage:           { label: "Deal Stage",           hint: "Mapped via stage mapping table above" },
  deal_size:            { label: "Deal Size (Amount)",   hint: "Numeric — HubSpot amount field" },
  deal_closed_date:     { label: "Close Date",           hint: "Date — estimated implementation date" },
  broker_comp_producer: { label: "Broker / Producer",   hint: "Maps to HubSpot Deal Source field" },
};

export default function HubSpotIntegration({ onConnectionChange }: HubSpotIntegrationProps) {
  const [activeTab, setActiveTab]         = useState<"overview" | "stages" | "fields" | "architecture">("overview");
  const [connected, setConnected]         = useState<boolean | null>(null);
  const [hubId, setHubId]                 = useState<string | null>(null);
  const [connecting, setConnecting]       = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing]             = useState(false);

  const [pipelines, setPipelines]               = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>("");
  const [pipelineLoading, setPipelineLoading]   = useState(false);

  const [hsStages, setHsStages]           = useState<Stage[]>([]);
  const [ephyStages, setEphyStages]       = useState<EphyStage[]>([]);
  const [stageMapping, setStageMapping]   = useState<Record<string, string>>({});
  const [underwriterCompletionStage, setUnderwriterCompletionStage] = useState<string>("");
  const [stageSaving, setStageSaving]     = useState(false);
  const [stageSaved, setStageSaved]       = useState(false);

  const [fieldMapping, setFieldMapping]       = useState<Record<string, string>>(DEFAULT_FIELD_MAPPING);
  const [hsFields, setHsFields]               = useState<{ hs_field: string; label: string; description: string }[]>([]);
  const [fieldSaving, setFieldSaving]         = useState(false);
  const [fieldSaved, setFieldSaved]           = useState(false);

  const [syncedDeals, setSyncedDeals]         = useState<SyncedDeal[]>([]);
  const [webhookLogs, setWebhookLogs]         = useState<WebhookLog[]>([]);
  const [dealsCount, setDealsCount]           = useState<number>(0);
  const [loadingDeals, setLoadingDeals]       = useState<boolean>(false);

  const popupRef   = useRef<Window | null>(null);
  const popupTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { checkConnection(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connected) {
      loadPipelines();
      loadStageMapping();
      loadFieldMapping();
      loadSyncedDeals();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connected && selectedPipeline) loadPipelineStages();
  }, [selectedPipeline, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkConnection = async (): Promise<boolean> => {
    try {
      const res  = await fetchHubspotStatus();
      const json = await res.json();
      const isConnected = json?.connected === true;
      setConnected(isConnected);
      setHubId(json?.hub_id ?? null);
      onConnectionChange?.(isConnected);
      return isConnected;
    } catch {
      setConnected(false);
      onConnectionChange?.(false);
      return false;
    }
  };

  const loadSyncedDeals = async () => {
    setLoadingDeals(true);
    try {
      const res  = await fetchHubspotDeals();
      const json = await res.json();
      if (json?.status === 200) {
        setSyncedDeals(json.deals || []);
        setWebhookLogs(json.recent_logs || []);
        setDealsCount(json.deals_count || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDeals(false);
    }
  };

  const loadPipelines = async () => {
    setPipelineLoading(true);
    try {
      const res  = await fetchHubspotPipelines();
      const json = await res.json();
      const list: Pipeline[] = (json?.pipelines ?? []).map((p: { id: string; label: string }) => ({
        id:    p.id,
        label: p.label,
      }));
      setPipelines(list);
    } catch {
      // ignore
    } finally {
      setPipelineLoading(false);
    }
  };

  const loadPipelineStages = async () => {
    if (!selectedPipeline) return;
    try {
      const res  = await fetchHubspotPipelineStages(selectedPipeline);
      const json = await res.json();
      const list: Stage[] = (json?.stages ?? []).map((s: { id: string; label: string }) => ({
        id:    s.id,
        label: s.label,
      }));
      setHsStages(list);
    } catch {
      // ignore
    }
  };

  const loadStageMapping = async () => {
    try {
      const res  = await fetchHubspotStageMapping();
      const json = await res.json();
      if (json?.ephy_stages) setEphyStages(json.ephy_stages.filter((s: EphyStage) => s.enabled));
      if (json?.stage_mapping && Object.keys(json.stage_mapping).length > 0) {
        const { underwriter_completion_stage, ...rest } = json.stage_mapping;
        setStageMapping(rest);
        setUnderwriterCompletionStage(underwriter_completion_stage || "");
      }
      if (json?.pipeline_id && !selectedPipeline) {
        setSelectedPipeline(json.pipeline_id);
      }
    } catch {
      // ignore
    }
  };

  const loadFieldMapping = async () => {
    try {
      const res  = await fetchHubspotDealFieldMapping();
      const json = await res.json();
      if (json?.mapping && Object.keys(json.mapping).length > 0) {
        setFieldMapping({ ...DEFAULT_FIELD_MAPPING, ...json.mapping });
      }
      if (json?.fields) setHsFields(json.fields);
    } catch {
      // ignore
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res  = await fetchHubspotAuthUrl();
      const json = await res.json();
      if (!json?.url) throw new Error("No auth URL");

      popupRef.current = window.open(
        json.url,
        "hs_oauth",
        "width=600,height=720,left=200,top=100"
      );

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "hs_connected") {
          window.removeEventListener("message", onMessage);
          clearInterval(popupTimer.current!);
          setConnecting(false);
          checkConnection();
          toast.success("HubSpot connected successfully! Custom properties are provisioning.");
        } else if (event.data?.type === "hs_error") {
          window.removeEventListener("message", onMessage);
          clearInterval(popupTimer.current!);
          setConnecting(false);
          checkConnection().then((isConnected) => {
            if (!isConnected) {
              toast.error("HubSpot connection failed. Please try again.");
            }
          });
        }
      };

      window.addEventListener("message", onMessage);

      popupTimer.current = setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          clearInterval(popupTimer.current!);
          window.removeEventListener("message", onMessage);
          setConnecting(false);
          checkConnection();
        }
      }, 500);
    } catch {
      setConnecting(false);
      toast.error("Failed to get HubSpot auth URL.");
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectHubspot();
      setConnected(false);
      setHubId(null);
      setPipelines([]);
      setHsStages([]);
      setStageMapping({});
      setUnderwriterCompletionStage("");
      setSyncedDeals([]);
      onConnectionChange?.(false);
      toast.success("HubSpot disconnected.");
    } catch {
      toast.error("Failed to disconnect.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSaveStageMapping = async () => {
    setStageSaving(true);
    setStageSaved(false);
    try {
      const mappingPayload = { ...stageMapping, underwriter_completion_stage: underwriterCompletionStage };
      const res  = await saveHubspotStageMapping(mappingPayload, selectedPipeline);
      const json = await res.json();
      if (json?.status === 200) {
        setStageSaved(true);
        setTimeout(() => setStageSaved(false), 3000);
        toast.success("Stage mapping saved.");
      } else {
        toast.error("Failed to save stage mapping.");
      }
    } catch {
      toast.error("Failed to save stage mapping.");
    } finally {
      setStageSaving(false);
    }
  };

  const handleSaveFieldMapping = async () => {
    setFieldSaving(true);
    setFieldSaved(false);
    try {
      const res  = await saveHubspotDealFieldMapping(fieldMapping);
      const json = await res.json();
      if (json?.status === 200) {
        setFieldSaved(true);
        setTimeout(() => setFieldSaved(false), 3000);
        toast.success("Field mapping saved.");
      } else {
        toast.error("Failed to save field mapping.");
      }
    } catch {
      toast.error("Failed to save field mapping.");
    } finally {
      setFieldSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res  = await syncHubspotDeals();
      const json = await res.json();
      if (json?.status === 200) {
        toast.success("Sync worker triggered. Refreshing deals...");
        setTimeout(() => loadSyncedDeals(), 1500);
      } else {
        toast.error("Failed to sync deals.");
      }
    } catch {
      toast.error("Failed to sync deals.");
    } finally {
      setSyncing(false);
    }
  };

  const totalDealValue = syncedDeals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700/60 p-6 text-white shadow-xl">
        <div className="absolute -right-10 -bottom-10 w-60 h-60 bg-[#ff7a59]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-[#ff7a59]/20 border border-[#ff7a59]/30 rounded-2xl shrink-0 text-[#ff7a59]">
              <Building2 className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">HubSpot CRM Integration</h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-[#ff7a59]/20 text-[#ff7a59] border border-[#ff7a59]/30">
                  v2.0 Bidirectional
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-300 max-w-2xl leading-relaxed">
                Connect EPHY to HubSpot for continuous real-time deal sync, stage progression, custom property mapping, and underwriter feedback.
              </p>
            </div>
          </div>

          {/* Connection Action Box */}
          <div className="shrink-0 flex items-center gap-3">
            {connected === null ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
                <Loader2 className="w-4 h-4 animate-spin text-[#ff7a59]" /> Checking status...
              </div>
            ) : connected ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#ff7a59] to-[#e5694d] hover:opacity-90 text-white text-xs font-semibold rounded-xl shadow-md transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync Deals"}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-medium rounded-xl transition-all disabled:opacity-50"
                >
                  <Link2Off className="w-3.5 h-3.5" />
                  {disconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#ff7a59] to-[#e5694d] hover:from-[#e5694d] hover:to-[#ff7a59] text-white text-sm font-bold rounded-xl shadow-lg hover:shadow-[#ff7a59]/30 transition-all disabled:opacity-50"
              >
                {connecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Connecting Portal...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4" /> Connect HubSpot Portal
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Quick Connection Badges */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            <span className="text-slate-300">Status:</span>
            <span className={`font-semibold ${connected ? "text-emerald-400" : "text-slate-400"}`}>
              {connected ? "Active & Authenticated" : "Not Connected"}
            </span>
          </div>

          {hubId && (
            <div className="flex items-center gap-1.5 text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-[#ff7a59]" />
              <span>Portal ID:</span>
              <span className="font-mono font-bold text-white">{hubId}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-slate-400">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Webhook Listener:</span>
            <span className="text-slate-200">Active (HMAC Signed)</span>
          </div>
        </div>
      </div>

      {connected && (
        <>
          {/* Navigation Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-700 flex space-x-8">
            <button
              onClick={() => setActiveTab("overview")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === "overview"
                  ? "border-[#ff7a59] text-[#ff7a59]"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <Activity className="w-4 h-4" />
              Overview & Synced Deals
            </button>
            <button
              onClick={() => setActiveTab("stages")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === "stages"
                  ? "border-[#ff7a59] text-[#ff7a59]"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <Layers className="w-4 h-4" />
              Pipeline & Stage Mapping
            </button>
            <button
              onClick={() => setActiveTab("fields")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === "fields"
                  ? "border-[#ff7a59] text-[#ff7a59]"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <Settings2 className="w-4 h-4" />
              Field Mapping
            </button>
            <button
              onClick={() => setActiveTab("architecture")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === "architecture"
                  ? "border-[#ff7a59] text-[#ff7a59]"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <Database className="w-4 h-4" />
              Integration Architecture
            </button>
          </div>

          {/* TAB 1: OVERVIEW & SYNCED DEALS */}
          {activeTab === "overview" && (
            <div className="space-y-6 animate-fade-in">
              {/* KPI Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Synced Deals</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{dealsCount}</p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl">
                    <Database className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Synced Pipeline Value</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      ${totalDealValue.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <DollarSign className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Pipeline</p>
                    <p className="text-base font-bold text-gray-900 dark:text-white mt-1 truncate max-w-[180px]">
                      {pipelines.find((p) => p.id === selectedPipeline)?.label || "Default Pipeline"}
                    </p>
                  </div>
                  <div className="p-3 bg-orange-50 dark:bg-orange-900/20 text-[#ff7a59] rounded-xl">
                    <Layers className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {/* Deals Table Card */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">Recent Synced Deals</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Deals automatically imported from your HubSpot CRM portal.
                    </p>
                  </div>
                  <button
                    onClick={loadSyncedDeals}
                    disabled={loadingDeals}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Refresh list"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingDeals ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {loadingDeals ? (
                  <div className="p-8 text-center text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#ff7a59]" />
                    Fetching HubSpot deal status...
                  </div>
                ) : syncedDeals.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400">
                      <Database className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">No deals imported yet</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                      Click <strong>&quot;Sync Deals&quot;</strong> above or move deals in HubSpot to mapped stages to begin automatic synchronization.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700/50 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                          <th className="px-5 py-3">Deal Name</th>
                          <th className="px-5 py-3">HubSpot Deal ID</th>
                          <th className="px-5 py-3">Stage</th>
                          <th className="px-5 py-3">Amount</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3">Last Synced</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
                        {syncedDeals.map((deal) => (
                          <tr key={deal.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
                            <td className="px-5 py-3.5 font-medium text-gray-900 dark:text-white">
                              {deal.deal_name}
                            </td>
                            <td className="px-5 py-3.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                              #{deal.hubspot_deal_id}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 dark:bg-orange-900/20 text-[#ff7a59] border border-orange-200 dark:border-orange-800/30">
                                {deal.stage}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 font-semibold text-gray-800 dark:text-gray-200">
                              ${Number(deal.amount).toLocaleString()}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Synced
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-xs text-gray-400">
                              {new Date(deal.last_synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
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
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Pipeline & Stage Alignment</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
                  Select your active HubSpot pipeline and map each internal EPHY deal status to its corresponding HubSpot deal stage.
                </p>

                {/* Pipeline Selector */}
                <div className="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 max-w-xl">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">
                    HubSpot Deal Pipeline
                  </label>
                  {pipelineLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading pipelines from HubSpot...
                    </div>
                  ) : (
                    <select
                      value={selectedPipeline}
                      onChange={(e) => setSelectedPipeline(e.target.value)}
                      className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3.5 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-[#ff7a59]"
                    >
                      <option value="">— Select HubSpot Pipeline —</option>
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Mapping Grid */}
                {ephyStages.length === 0 ? (
                  <p className="text-sm text-gray-400">No EPHY stages configured.</p>
                ) : !selectedPipeline ? (
                  <p className="text-sm text-gray-400">Select a pipeline above to load its stages.</p>
                ) : (
                  <div className="space-y-3 max-w-2xl">
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 text-xs font-semibold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-gray-700">
                      <div>EPHY Deal Stage</div>
                      <div>Direction</div>
                      <div>HubSpot Pipeline Stage</div>
                    </div>

                    {ephyStages.map((stage) => (
                      <div key={stage.key} className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center p-3 rounded-xl bg-gray-50/70 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700">
                        <div className="font-medium text-sm text-gray-800 dark:text-gray-200">
                          {stage.name}
                        </div>
                        <div className="text-[#ff7a59]">
                          <ArrowLeftRight className="w-4 h-4" />
                        </div>
                        <div>
                          <select
                            value={stageMapping[stage.key] ?? ""}
                            onChange={(e) =>
                              setStageMapping((prev) => ({ ...prev, [stage.key]: e.target.value }))
                            }
                            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                          >
                            <option value="">— Not mapped —</option>
                            {hsStages.map((s) => (
                              <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}

                    <div className="pt-4 flex items-center gap-4">
                      <button
                        onClick={handleSaveStageMapping}
                        disabled={stageSaving}
                        className="px-5 py-2.5 bg-gradient-to-r from-[#ff7a59] to-[#e5694d] text-white text-xs font-bold rounded-xl shadow-md hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {stageSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Stage Mapping
                      </button>
                      {stageSaved && (
                        <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                          <Check className="w-4 h-4" /> Saved successfully
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: FIELD MAPPING */}
          {activeTab === "fields" && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">HubSpot Deal Property Mapping</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
                  Map deal attributes between EPHY and HubSpot deal properties.
                </p>

                <div className="space-y-4 max-w-2xl">
                  {Object.keys(DEFAULT_FIELD_MAPPING).map((dealKey) => {
                    const meta = DEAL_FIELD_META[dealKey];
                    return (
                      <div key={dealKey} className="p-4 rounded-xl bg-gray-50/70 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {meta?.label ?? dealKey}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{meta?.hint}</p>
                        </div>
                        <div className="w-full sm:w-64">
                          <select
                            value={fieldMapping[dealKey] ?? ""}
                            onChange={(e) =>
                              setFieldMapping((prev) => ({ ...prev, [dealKey]: e.target.value }))
                            }
                            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                          >
                            <option value="">— Select property —</option>
                            {hsFields.map((f) => (
                              <option key={f.hs_field} value={f.hs_field}>
                                {f.label} ({f.hs_field})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}

                  <div className="pt-4 flex items-center gap-4">
                    <button
                      onClick={handleSaveFieldMapping}
                      disabled={fieldSaving}
                      className="px-5 py-2.5 bg-gradient-to-r from-[#ff7a59] to-[#e5694d] text-white text-xs font-bold rounded-xl shadow-md hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                      {fieldSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save Field Mapping
                    </button>
                    {fieldSaved && (
                      <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                        <Check className="w-4 h-4" /> Saved successfully
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ARCHITECTURE */}
          {activeTab === "architecture" && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Integration System Architecture</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  How EPHY and HubSpot synchronize deals, properties, and webhooks securely.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-700 space-y-2">
                    <div className="flex items-center gap-2 text-[#ff7a59] font-bold text-sm">
                      <Zap className="w-4 h-4" /> Webhook Listener
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      HubSpot pushes deal stage changes in real-time to <code className="text-amber-300">/api/v1/hubspot/webhook</code>. Events are verified with HMAC SHA-256 signatures.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-700 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                      <ShieldCheck className="w-4 h-4" /> OAuth 2.0 + PKCE
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Tokens are stored encrypted per company tenant. Token refresh occurs automatically using PKCE security standards.
                    </p>
                  </div>
                </div>

                {/* Recent Webhook Event Logs */}
                <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                  <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Recent Webhook Activity</h4>
                  {webhookLogs.length === 0 ? (
                    <p className="text-xs text-gray-400">No recent webhook events logged yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {webhookLogs.map((log) => (
                        <div key={log.id} className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs">
                          <span className="font-mono text-gray-700 dark:text-gray-300">{log.event_type || "deal.propertyChange"}</span>
                          <span className="text-gray-400">Deal #{log.hubspot_deal_id}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">{log.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
