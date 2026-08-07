"use client";

import { useState, useEffect, useRef } from "react";
import {
  fetchGmailAuthUrl,
  fetchGmailStatus,
  disconnectGmail,
  fetchGmailLabels,
  fetchGmailLabelMapping,
  saveGmailLabelMapping,
  fetchGmailMessageFieldMapping,
  saveGmailMessageFieldMapping,
  syncGmailMessages,
  fetchGmailMessages,
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
  Building2,
  ShieldCheck,
  Mail,
  Check,
  Inbox,
  Tag,
} from "lucide-react";

type Label    = { id: string; label: string; type?: string };
type EphyStage = { key: string; name: string; enabled: boolean };

type SyncedMessage = {
  id: number;
  gmail_message_id: string;
  status: string;
  subject: string;
  snippet: string;
  last_synced_at: string;
};

type WebhookLog = {
  id: number;
  event_type: string;
  status: string;
  gmail_message_id: string;
  created_at: string;
};

type GmailIntegrationProps = {
  onConnectionChange?: (connected: boolean) => void;
};

const DEFAULT_FIELD_MAPPING: Record<string, string> = {
  deal_stage:           "Snippet",
  deal_size:            "Subject",
  deal_closed_date:     "Date",
  broker_comp_producer: "From",
};

const MSG_FIELD_META: Record<string, { label: string; hint: string }> = {
  deal_stage:           { label: "Deal Stage",           hint: "Mapped to email body snippet or label mapping" },
  deal_size:            { label: "Deal Title / Subject", hint: "Mapped to Gmail message Subject line" },
  deal_closed_date:     { label: "Email Timestamp",      hint: "Date — Gmail header timestamp" },
  broker_comp_producer: { label: "Sender Email (From)",  hint: "Maps to Gmail From header originator" },
};

export default function GmailIntegration({ onConnectionChange }: GmailIntegrationProps) {
  const [activeTab, setActiveTab]         = useState<"overview" | "labels" | "fields" | "architecture">("overview");
  const [connected, setConnected]         = useState<boolean | null>(null);
  const [emailAddress, setEmailAddress]   = useState<string | null>(null);
  const [accountId, setAccountId]         = useState<string | null>(null);
  const [connecting, setConnecting]       = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing]             = useState(false);

  const [gmailLabels, setGmailLabels]     = useState<Label[]>([]);
  const [ephyStages, setEphyStages]       = useState<EphyStage[]>([]);
  const [labelMapping, setLabelMapping]   = useState<Record<string, string>>({});
  const [labelSaving, setLabelSaving]     = useState(false);
  const [labelSaved, setLabelSaved]       = useState(false);

  const [fieldMapping, setFieldMapping]   = useState<Record<string, string>>(DEFAULT_FIELD_MAPPING);
  const [msgFields, setMsgFields]         = useState<{ field: string; label: string; description: string }[]>([]);
  const [fieldSaving, setFieldSaving]     = useState(false);
  const [fieldSaved, setFieldSaved]       = useState(false);

  const [syncedMsgs, setSyncedMsgs]       = useState<SyncedMessage[]>([]);
  const [webhookLogs, setWebhookLogs]     = useState<WebhookLog[]>([]);
  const [msgsCount, setMsgsCount]         = useState<number>(0);
  const [loadingMsgs, setLoadingMsgs]     = useState<boolean>(false);

  const popupRef   = useRef<Window | null>(null);
  const popupTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { checkConnection(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connected) {
      loadGmailLabels();
      loadLabelMapping();
      loadFieldMapping();
      loadSyncedMsgs();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkConnection = async (): Promise<boolean> => {
    try {
      const res  = await fetchGmailStatus();
      const json = await res.json();
      const isConnected = json?.connected === true;
      setConnected(isConnected);
      setEmailAddress(json?.email_address ?? null);
      setAccountId(json?.account_id ?? null);
      onConnectionChange?.(isConnected);
      return isConnected;
    } catch {
      setConnected(false);
      onConnectionChange?.(false);
      return false;
    }
  };

  const loadSyncedMsgs = async () => {
    setLoadingMsgs(true);
    try {
      const res  = await fetchGmailMessages();
      const json = await res.json();
      if (json?.status === 200) {
        setSyncedMsgs(json.messages || []);
        setWebhookLogs(json.recent_logs || []);
        setMsgsCount(json.messages_count || 0);
      }
    } catch {
      toast.error("Failed to load Gmail sync data");
    } finally {
      setLoadingMsgs(false);
    }
  };

  const loadGmailLabels = async () => {
    try {
      const res  = await fetchGmailLabels();
      const json = await res.json();
      if (json?.labels) {
        setGmailLabels(json.labels);
      }
    } catch {
      toast.error("Failed to fetch Gmail labels");
    }
  };

  const loadLabelMapping = async () => {
    try {
      const res  = await fetchGmailLabelMapping();
      const json = await res.json();
      if (json?.label_mapping) setLabelMapping(json.label_mapping);
      if (json?.ephy_stages) {
        const stagesList = json.ephy_stages.map((s: string | EphyStage) =>
          typeof s === "string" ? { key: s, name: s.replace(/_/g, " ").toUpperCase(), enabled: true } : s
        );
        setEphyStages(stagesList);
      }
    } catch {
      toast.error("Failed to fetch Gmail label mapping");
    }
  };

  const loadFieldMapping = async () => {
    try {
      const res  = await fetchGmailMessageFieldMapping();
      const json = await res.json();
      if (json?.mapping && Object.keys(json.mapping).length > 0) setFieldMapping(json.mapping);
      if (json?.fields) setMsgFields(json.fields);
    } catch {
      toast.error("Failed to fetch Gmail field mapping");
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res  = await fetchGmailAuthUrl();
      const json = await res.json();
      if (!json?.url) throw new Error("Could not retrieve authorization URL");

      const width  = 600;
      const height = 700;
      const left   = window.screenX + (window.innerWidth  - width)  / 2;
      const top    = window.screenY + (window.innerHeight - height) / 2;

      popupRef.current = window.open(
        json.url,
        "GmailOAuthPopup",
        `width=${width},height=${height},top=${top},left=${left},status=no,resizable=yes,scrollbars=yes`
      );

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "gmail_connected") {
          cleanupPopup();
          checkConnection();
          toast.success("Gmail Account Connected Successfully!");
        } else if (event.data?.type === "gmail_error") {
          cleanupPopup();
          toast.error(`Gmail connection failed: ${event.data.error || "Unknown error"}`);
        }
      };

      window.addEventListener("message", handleMessage);

      popupTimer.current = setInterval(async () => {
        if (popupRef.current?.closed) {
          cleanupPopup();
          const isConn = await checkConnection();
          if (isConn) toast.success("Gmail Account Connected Successfully!");
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
    if (!confirm("Are you sure you want to disconnect Gmail? Active message sync will stop.")) return;
    setDisconnecting(true);
    try {
      await disconnectGmail();
      setConnected(false);
      setEmailAddress(null);
      setAccountId(null);
      onConnectionChange?.(false);
      toast.success("Gmail disconnected.");
    } catch {
      toast.error("Failed to disconnect Gmail.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res  = await syncGmailMessages();
      const json = await res.json();
      if (json.status === 200) {
        toast.success("Background Gmail Sync initiated!");
        setTimeout(() => loadSyncedMsgs(), 1500);
      } else {
        toast.error(json.error || "Sync failed to start");
      }
    } catch {
      toast.error("Error triggering Gmail sync");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveLabelMapping = async () => {
    setLabelSaving(true);
    try {
      const res  = await saveGmailLabelMapping(labelMapping);
      const json = await res.json();
      if (json.status === 200) {
        setLabelSaved(true);
        setTimeout(() => setLabelSaved(false), 2500);
        toast.success("Label mapping saved.");
      } else {
        toast.error(json.error || "Failed to save label mapping.");
      }
    } catch {
      toast.error("Error saving label mapping.");
    } finally {
      setLabelSaving(false);
    }
  };

  const handleSaveFieldMapping = async () => {
    setFieldSaving(true);
    try {
      const res  = await saveGmailMessageFieldMapping(fieldMapping);
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
        <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Integration Banner */}
      <div className="bg-gradient-to-r from-red-900 to-rose-950 text-white rounded-2xl p-6 shadow-xl border border-red-800/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 pointer-events-none">
          <Mail className="w-64 h-64 text-red-400" />
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-inner">
              <Mail className="w-8 h-8 text-red-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">Gmail Integration Prototype</h2>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                  connected ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-gray-700/50 text-gray-300 border border-gray-600"
                }`}>
                  {connected ? "Connected" : "Not Connected"}
                </span>
              </div>
              <p className="text-xs text-red-200 mt-1">
                Bi-directional email message sync, label mapping, and inbound PubSub notification listener.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {connected ? (
              <>
                <button
                  onClick={handleManualSync}
                  disabled={syncing}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md disabled:opacity-50"
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
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-all shadow-lg hover:shadow-red-500/25 disabled:opacity-50"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Connect Gmail Account
              </button>
            )}
          </div>
        </div>

        {connected && (
          <div className="mt-6 pt-4 border-t border-red-800/60 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-red-300/70 block">Connected Account</span>
              <span className="font-mono text-red-100 font-medium truncate block max-w-[160px]">{emailAddress || "user@gmail.com"}</span>
            </div>
            <div>
              <span className="text-red-300/70 block">History / Account ID</span>
              <span className="font-mono text-red-100 font-medium truncate block max-w-[150px]">{accountId || "10982347891234"}</span>
            </div>
            <div>
              <span className="text-red-300/70 block">OAuth Protocol</span>
              <span className="text-red-100 font-medium">OAuth 2.0 + PKCE (S256)</span>
            </div>
            <div>
              <span className="text-red-300/70 block">Sync Engine</span>
              <span className="text-red-100 font-medium">Gmail REST API v1</span>
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
                  ? "border-red-500 text-red-500 dark:text-red-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <Activity className="w-4 h-4" />
              Overview & Live Messages
            </button>
            <button
              onClick={() => setActiveTab("labels")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm border-b-2 transition-all ${
                activeTab === "labels"
                  ? "border-red-500 text-red-500 dark:text-red-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              <Tag className="w-4 h-4" />
              Label Mapping
            </button>
            <button
              onClick={() => setActiveTab("fields")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm border-b-2 transition-all ${
                activeTab === "fields"
                  ? "border-red-500 text-red-500 dark:text-red-400"
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
                  ? "border-red-500 text-red-500 dark:text-red-400"
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
                  <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center">
                    <Inbox className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Synced Messages</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{msgsCount}</p>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Zap className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Webhook Logs</p>
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

              {/* Synced Messages Table */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Mail className="w-4 h-4 text-red-500" />
                    Synced Gmail Messages
                  </h3>
                  <button
                    onClick={loadSyncedMsgs}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingMsgs ? "animate-spin" : ""}`} /> Reload
                  </button>
                </div>

                {loadingMsgs ? (
                  <div className="p-8 text-center text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-red-500" />
                    Loading messages...
                  </div>
                ) : syncedMsgs.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-xs">
                    No Gmail messages synced yet. Click "Sync Now" above to fetch messages.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          <th className="p-3">Subject / Deal Title</th>
                          <th className="p-3">Message ID</th>
                          <th className="p-3">Snippet</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Last Synced</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {syncedMsgs.map((msg) => (
                          <tr key={msg.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="p-3 font-semibold text-gray-900 dark:text-white">{msg.subject}</td>
                            <td className="p-3 font-mono text-gray-500 dark:text-gray-400">{msg.gmail_message_id}</td>
                            <td className="p-3 text-gray-600 dark:text-gray-300 max-w-xs truncate">{msg.snippet || "N/A"}</td>
                            <td className="p-3"><span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium">{msg.status}</span></td>
                            <td className="p-3 text-gray-400">{new Date(msg.last_synced_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: LABEL MAPPING */}
          {activeTab === "labels" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-6 animate-fade-in">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Tag className="w-5 h-5 text-red-500" />
                  Gmail Label Mapping Engine
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Map internal EPHY deal pipeline stages to Gmail account labels.
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
                        value={labelMapping[es.key] || ""}
                        onChange={(e) => setLabelMapping({ ...labelMapping, [es.key]: e.target.value })}
                        className="w-full text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-2 border shadow-sm focus:ring-red-500 focus:border-red-500"
                      >
                        <option value="">-- Select Gmail Label --</option>
                        {gmailLabels.map((lbl) => (
                          <option key={lbl.id} value={lbl.id}>
                            {lbl.label} ({lbl.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleSaveLabelMapping}
                  disabled={labelSaving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-all shadow-md disabled:opacity-50"
                >
                  {labelSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : labelSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {labelSaved ? "Label Mapping Saved!" : "Save Label Mapping"}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: FIELD MAPPING */}
          {activeTab === "fields" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-6 animate-fade-in">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-red-500" />
                  Gmail Message Field Mapping
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Configure message attribute bindings between EPHY deal fields and Gmail email headers.
                </p>
              </div>

              <div className="space-y-4">
                {Object.entries(MSG_FIELD_META).map(([ephyKey, meta]) => (
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
                      placeholder="e.g. Subject, Snippet, From, Date"
                      className="w-full text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-2.5 border shadow-sm focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleSaveFieldMapping}
                  disabled={fieldSaving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-all shadow-md disabled:opacity-50"
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
                  <Database className="w-4 h-4 text-red-500" />
                  System Architecture & Webhook Audit Logs
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Real-time audit log of inbound email notifications and background Sidekiq worker execution for Gmail sync.
                </p>

                {webhookLogs.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 text-xs bg-gray-50 dark:bg-gray-900 rounded-lg">
                    No webhook logs recorded yet. Inbound notifications from Gmail PubSub listener will appear here.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          <th className="p-3">Log ID</th>
                          <th className="p-3">Event Type</th>
                          <th className="p-3">Message ID</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Recorded At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {webhookLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="p-3 font-mono">#{log.id}</td>
                            <td className="p-3 font-semibold text-gray-800 dark:text-gray-200">{log.event_type}</td>
                            <td className="p-3 font-mono text-gray-500">{log.gmail_message_id}</td>
                            <td className="p-3"><span className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-medium">{log.status}</span></td>
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
