const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ── Unified Multi-CRM & Cross-Sync API ──────────────────────────────────────

export const fetchCrmStatus = () =>
  fetch(`${API_BASE}/api/v1/crm/status`, { headers: getAuthHeaders() });

export const syncAllCrms = () =>
  fetch(`${API_BASE}/api/v1/crm/sync_all`, { method: "POST", headers: getAuthHeaders() });

// ── HubSpot Integrations API ───────────────────────────────────────────────

export const fetchHubspotAuthUrl = () =>
  fetch(`${API_BASE}/api/v1/hubspot/auth_url`, { headers: getAuthHeaders() });

export const fetchHubspotStatus = () =>
  fetch(`${API_BASE}/api/v1/hubspot/status`, { headers: getAuthHeaders() });

export const disconnectHubspot = () =>
  fetch(`${API_BASE}/api/v1/hubspot/disconnect`, { method: "DELETE", headers: getAuthHeaders() });

export const fetchHubspotPipelines = () =>
  fetch(`${API_BASE}/api/v1/hubspot/pipelines`, { headers: getAuthHeaders() });

export const fetchHubspotPipelineStages = (pipelineId: string) =>
  fetch(`${API_BASE}/api/v1/hubspot/pipeline_stages?pipeline_id=${pipelineId}`, { headers: getAuthHeaders() });

export const fetchHubspotStageMapping = () =>
  fetch(`${API_BASE}/api/v1/hubspot/stage_mapping`, { headers: getAuthHeaders() });

export const saveHubspotStageMapping = (stageMapping: Record<string, string>, pipelineId: string) =>
  fetch(`${API_BASE}/api/v1/hubspot/save_stage_mapping`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ stage_mapping: stageMapping, pipeline_id: pipelineId }),
  });

export const fetchHubspotDealFieldMapping = () =>
  fetch(`${API_BASE}/api/v1/hubspot/deal_field_mapping`, { headers: getAuthHeaders() });

export const saveHubspotDealFieldMapping = (mapping: Record<string, string>) =>
  fetch(`${API_BASE}/api/v1/hubspot/save_deal_field_mapping`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ mapping }),
  });

export const syncHubspotDeals = () =>
  fetch(`${API_BASE}/api/v1/hubspot/sync`, { method: "POST", headers: getAuthHeaders() });

export const fetchHubspotDeals = () =>
  fetch(`${API_BASE}/api/v1/hubspot/deals`, { headers: getAuthHeaders() });

// ── Salesforce Integrations API ───────────────────────────────────────────

export const fetchSalesforceAuthUrl = () =>
  fetch(`${API_BASE}/api/v1/salesforce/auth_url`, { headers: getAuthHeaders() });

export const fetchSalesforceStatus = () =>
  fetch(`${API_BASE}/api/v1/salesforce/status`, { headers: getAuthHeaders() });

export const disconnectSalesforce = () =>
  fetch(`${API_BASE}/api/v1/salesforce/disconnect`, { method: "DELETE", headers: getAuthHeaders() });

export const fetchSalesforceOpportunityStages = () =>
  fetch(`${API_BASE}/api/v1/salesforce/opportunity_stages`, { headers: getAuthHeaders() });

export const fetchSalesforceStageMapping = () =>
  fetch(`${API_BASE}/api/v1/salesforce/stage_mapping`, { headers: getAuthHeaders() });

export const saveSalesforceStageMapping = (stageMapping: Record<string, string>) =>
  fetch(`${API_BASE}/api/v1/salesforce/save_stage_mapping`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ stage_mapping: stageMapping }),
  });

export const fetchSalesforceOpportunityFieldMapping = () =>
  fetch(`${API_BASE}/api/v1/salesforce/opportunity_field_mapping`, { headers: getAuthHeaders() });

export const saveSalesforceOpportunityFieldMapping = (mapping: Record<string, string>) =>
  fetch(`${API_BASE}/api/v1/salesforce/save_opportunity_field_mapping`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ mapping }),
  });

export const syncSalesforceOpportunities = () =>
  fetch(`${API_BASE}/api/v1/salesforce/sync`, { method: "POST", headers: getAuthHeaders() });

export const fetchSalesforceOpportunities = () =>
  fetch(`${API_BASE}/api/v1/salesforce/opportunities`, { headers: getAuthHeaders() });
