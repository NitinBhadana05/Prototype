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
} from "@/lib/api";
import toast from "react-hot-toast";
import {
  Loader2,
  CheckCircle2,
  Link2,
  Link2Off,
  RefreshCw,
  Save,
  ChevronDown,
  ChevronUp,
  ArrowLeftRight,
} from "lucide-react";

type Pipeline = { id: string; label: string };
type Stage    = { id: string; label: string };
type EphyStage = { key: string; name: string; enabled: boolean };

type HubSpotIntegrationProps = {
  user?: any;
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

export default function HubSpotIntegration({ user, onConnectionChange }: HubSpotIntegrationProps) {
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
  const [stageMappingOpen, setStageMappingOpen] = useState(true);
  const [stageSaving, setStageSaving]     = useState(false);
  const [stageSaved, setStageSaved]       = useState(false);

  const [fieldMapping, setFieldMapping]       = useState<Record<string, string>>(DEFAULT_FIELD_MAPPING);
  const [hsFields, setHsFields]               = useState<{ hs_field: string; label: string; description: string }[]>([]);
  const [fieldMappingOpen, setFieldMappingOpen] = useState(false);
  const [fieldSaving, setFieldSaving]         = useState(false);
  const [fieldSaved, setFieldSaved]           = useState(false);

  const popupRef   = useRef<Window | null>(null);
  const popupTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { checkConnection(); }, []);

  useEffect(() => {
    if (connected) {
      loadPipelines();
      loadStageMapping();
      loadFieldMapping();
    }
  }, [connected]);

  useEffect(() => {
    if (connected && selectedPipeline) loadPipelineStages();
  }, [selectedPipeline, connected]);

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

  const loadPipelines = async () => {
    setPipelineLoading(true);
    try {
      const res  = await fetchHubspotPipelines();
      const json = await res.json();
      const list: Pipeline[] = (json?.pipelines ?? []).map((p: any) => ({
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
      const list: Stage[] = (json?.stages ?? []).map((s: any) => ({
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
          toast.success("HubSpot connected! Custom properties are being set up automatically.");
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
        toast.success(`Synced ${json.synced} deal${json.synced === 1 ? "" : "s"} from HubSpot.`);
      } else {
        toast.error("Failed to sync deals.");
      }
    } catch {
      toast.error("Failed to sync deals.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-orange-500" />
          HubSpot Integration
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Connect your HubSpot account for bidirectional deal sync. Stage changes, field updates, and outcomes flow between HubSpot and EPHY automatically. Configure which HubSpot pipeline stages map to each EPHY deal stage below.
        </p>
      </div>

      {/* Connection status */}
      <div className="mb-6">
        {connected === null ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking HubSpot connection…
          </div>
        ) : connected ? (
          <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-700">HubSpot connected</p>
                {hubId && (
                  <p className="text-xs text-green-600 mt-0.5">Portal ID: {hubId}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync deals"}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
              >
                <Link2Off className="w-3.5 h-3.5" />
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="text-sm text-gray-500">No HubSpot account connected</span>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 bg-[#ff7a59] hover:bg-[#ff7a59]/90 text-white text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5" /> Connect HubSpot
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {connected && (
        <>
          {/* Pipeline selector */}
          <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">Pipeline</p>
            <p className="text-xs text-gray-500 mb-3">
              Select the HubSpot pipeline whose stages map to EPHY deal stages.
            </p>
            {pipelineLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading pipelines…
              </div>
            ) : (
              <select
                value={selectedPipeline}
                onChange={(e) => setSelectedPipeline(e.target.value)}
                className="w-full max-w-sm text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
              >
                <option value="">— Select pipeline —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            )}
          </div>

          {/* Stage mapping */}
          <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => setStageMappingOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Stage Mapping</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Map each EPHY deal stage to its corresponding HubSpot pipeline stage.
                </p>
              </div>
              {stageMappingOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
              )}
            </button>

            {stageMappingOpen && (
              <div className="px-4 py-4">
                {ephyStages.length === 0 ? (
                  <p className="text-sm text-gray-400">No EPHY stages configured. Set up deal stages in <strong>Deal Structure → Deal Statuses</strong> first.</p>
                ) : hsStages.length === 0 && selectedPipeline ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading stages…
                  </div>
                ) : !selectedPipeline ? (
                  <p className="text-sm text-gray-400">Select a pipeline above to load its stages.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-2 items-center mb-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 pb-1 border-b border-gray-100">EPHY Stage</div>
                      <div className="pb-1 border-b border-gray-100" />
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 pb-1 border-b border-gray-100">HubSpot Stage</div>

                      {ephyStages.map((stage) => (
                        <div className="contents" key={stage.key}>
                          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 py-1">
                            {stage.name}
                          </div>
                          <div className="flex justify-center text-gray-300">
                            <ArrowLeftRight className="w-4 h-4" />
                          </div>
                          <div className="py-1">
                            <select
                              value={stageMapping[stage.key] ?? ""}
                              onChange={(e) =>
                                setStageMapping((prev) => ({ ...prev, [stage.key]: e.target.value }))
                              }
                              className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                            >
                              <option value="">— Not mapped —</option>
                              {hsStages.map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 mb-4">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Auto-advance on Underwriter Completion</p>
                      <p className="text-xs text-gray-400 mb-2">
                        When an underwriter submits their form, automatically move the deal to the selected stage and push form details to HubSpot. Set to &quot;Disabled&quot; to turn this off.
                      </p>
                      <select
                        value={underwriterCompletionStage}
                        onChange={(e) => setUnderwriterCompletionStage(e.target.value)}
                        className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      >
                        <option value="">— Disabled —</option>
                        {ephyStages.map((s) => (
                          <option key={s.key} value={s.key}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSaveStageMapping}
                        disabled={stageSaving}
                        className="inline-flex items-center gap-1.5 bg-[#ff7a59] hover:bg-[#ff7a59]/90 text-white text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        {stageSaving ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                        ) : (
                          <><Save className="w-3.5 h-3.5" /> Save Stage Mapping</>
                        )}
                      </button>
                      {stageSaved && (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Field mapping */}
          <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => setFieldMappingOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Field Mapping</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Configure which HubSpot deal properties map to EPHY fields. Defaults are preconfigured.
                </p>
              </div>
              {fieldMappingOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
              )}
            </button>

            {fieldMappingOpen && (
              <div className="px-4 py-4">
                <div className="grid grid-cols-[1fr_1fr] gap-x-4 gap-y-2 mb-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 pb-1 border-b border-gray-100 dark:border-gray-700">
                    EPHY Deal Field
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 pb-1 border-b border-gray-100 dark:border-gray-700">
                    HubSpot Property
                  </div>

                  {Object.keys(DEFAULT_FIELD_MAPPING).map((dealKey) => {
                    const meta = DEAL_FIELD_META[dealKey];
                    return (
                      <div className="contents" key={dealKey}>
                        <div className="flex flex-col justify-center py-1">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {meta?.label ?? dealKey}
                          </span>
                          <span className="text-xs text-gray-400">{meta?.hint}</span>
                        </div>
                        <div className="flex items-center py-1">
                          <select
                            value={fieldMapping[dealKey] ?? ""}
                            onChange={(e) =>
                              setFieldMapping((prev) => ({ ...prev, [dealKey]: e.target.value }))
                            }
                            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                          >
                            <option value="">— Select property —</option>
                            {hsFields.map((f) => (
                              <option key={f.hs_field} value={f.hs_field} title={f.description}>
                                {f.label} ({f.hs_field})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSaveFieldMapping}
                    disabled={fieldSaving}
                    className="inline-flex items-center gap-1.5 bg-[#ff7a59] hover:bg-[#ff7a59]/90 text-white text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {fieldSaving ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    ) : (
                      <><Save className="w-3.5 h-3.5" /> Save Field Mapping</>
                    )}
                  </button>
                  {fieldSaved && (
                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                    </span>
                  )}
                  <button
                    onClick={() => setFieldMapping({ ...DEFAULT_FIELD_MAPPING })}
                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Info panel */}
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold text-blue-800">How bidirectional sync works</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-700">
              <li>HubSpot deal reaches Stage 2 → EPHY creates the deal automatically</li>
              <li>Stage advances in either system → the other system updates within 60 seconds</li>
              <li>Underwriter data (premium rate, multiplier, etc.) flows EPHY → HubSpot</li>
              <li>Census counts are <strong>never</strong> synced — each system keeps its own</li>
              <li>Won/Lost in either system closes the deal in both</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
