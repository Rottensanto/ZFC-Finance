import { supabase } from "./supabase.js";

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const rpc = async (name, args = {}) =>
  unwrap(await supabase.rpc(name, args));

export async function loadProfile(userId) {
  return unwrap(
    await supabase.from("profiles").select("id,email,display_name,role").eq("id", userId).single(),
  );
}

export async function loadLanding() {
  const [{ data: teams, error: teamError }, { data: market, error: marketError }] =
    await Promise.all([
      supabase.from("public_team_directory").select("*").order("name"),
      supabase.rpc("public_market_snapshot"),
    ]);
  if (teamError) throw teamError;
  if (marketError) throw marketError;
  return { teams: teams || [], market };
}

export async function loadTeamAccount(teamId) {
  const [teamResult, snapshotResult, invoiceResult, ledgerResult, claimsResult, contractsResult, reservationResult, documentResult] =
    await Promise.all([
      supabase
        .from("teams")
        .select("id,name,public_description,ownership_active,active_hq_offer_id,discord_channel_name,discord_channel_id,team_drivers(id,name,driver_type,is_active),hq_offers(city,country,tier)")
        .eq("id", teamId)
        .single(),
      supabase.rpc("account_snapshot", { p_team_id: teamId }),
      supabase
        .from("invoices")
        .select("*,invoice_items(*)")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false }),
      supabase
        .from("journal_entries")
        .select("id,season_id,invoice_id,claim_id,category,description,amount_cents,source_type,created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false }),
      supabase
        .from("sponsor_claims")
        .select("*,claim_reviews(*)")
        .eq("team_id", teamId)
        .order("due_on", { ascending: false }),
      supabase
        .from("sponsor_contracts")
        .select("*,sponsor_templates(display_name,slot,description)")
        .eq("team_id", teamId),
      supabase.from("hq_reservations").select("*,hq_offers!hq_reservations_offer_id_fkey(city,country,tier)").eq("team_id", teamId),
      supabase.from("team_documents").select("id,storage_path,file_name,content_type,size_bytes,created_at").eq("team_id", teamId).order("created_at", { ascending: false }),
    ]);
  const results = [teamResult, snapshotResult, invoiceResult, ledgerResult, claimsResult, contractsResult, reservationResult, documentResult];
  results.forEach(({ error }) => { if (error) throw error; });
  return {
    team: teamResult.data,
    snapshot: snapshotResult.data,
    invoices: invoiceResult.data || [],
    journal: ledgerResult.data || [],
    claims: claimsResult.data || [],
    contracts: contractsResult.data || [],
    reservations: reservationResult.data || [],
    documents: documentResult.data || [],
  };
}

export async function loadFinanceWorkspace() {
  const [{ data: dashboard, error: dashboardError }, { data: teams, error: teamsError }, { data: requests, error: requestsError }, { data: profiles, error: profilesError }, { data: invoices, error: invoicesError }, { data: claims, error: claimsError }, { data: races, error: racesError }, { data: season, error: seasonError }] =
    await Promise.all([
      supabase.rpc("finance_dashboard"),
      supabase.from("teams").select("id,name,owner_id,ownership_active,active_hq_offer_id,hq_offers(city,tier)").order("name"),
      supabase.from("team_presidency_requests").select("id,team_id,user_id,status,created_at,teams(name),profiles(email,display_name)").eq("status", "pending").order("created_at"),
      supabase.from("profiles").select("id,email,display_name,role").order("email"),
      supabase.from("invoices").select("*,teams(name),invoice_items(*)").in("status", ["draft", "open", "overdue"]).order("created_at", { ascending: false }),
      supabase.from("sponsor_claims").select("*,teams(name),sponsor_contracts(sponsor_templates(display_name))").in("status", ["pending", "approved"]).order("due_on"),
      supabase.from("races").select("id,season_id,round_number,name,country,race_date,published,race_entries(id,team_id,started_drivers,teams(name))").order("round_number"),
      supabase.from("seasons").select("id,name,starts_on,ends_on,invoice_fee_cents,initial_capital_cents,is_active").eq("is_active", true).single(),
    ]);
  const results = [dashboardError, teamsError, requestsError, profilesError, invoicesError, claimsError, racesError, seasonError];
  const error = results.find(Boolean);
  if (error) throw error;
  return { dashboard, teams: teams || [], requests: requests || [], profiles: profiles || [], invoices: invoices || [], claims: claims || [], races: races || [], season };
}

export async function loadTeamPortal(userId) {
  const [{ data: memberships, error: memberError }, { data: requests, error: requestError }] =
    await Promise.all([
      supabase.from("team_members").select("team_id,member_role,teams(id,name,ownership_active,active_hq_offer_id,hq_offers(city,tier))").eq("user_id", userId),
      supabase.from("team_presidency_requests").select("id,team_id,status,created_at,teams(name)").eq("user_id", userId).order("created_at", { ascending: false }),
    ]);
  if (memberError) throw memberError;
  if (requestError) throw requestError;
  return { memberships: memberships || [], requests: requests || [] };
}

export async function createPrivateDocument(teamId, file, userId) {
  if (file.size > 20 * 1024 * 1024) throw new Error("Datei überschreitet die Grenze von 20 MB.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${teamId}/${crypto.randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from("team-documents").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upload.error) throw upload.error;
  const metadata = await supabase.from("team_documents").insert({
    team_id: teamId,
    storage_path: path,
    file_name: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    uploaded_by: userId,
  });
  if (metadata.error) {
    await supabase.storage.from("team-documents").remove([path]);
    throw metadata.error;
  }
}

export async function getPrivateDocumentUrl(path) {
  const result = await supabase.storage.from("team-documents").createSignedUrl(path, 60);
  if (result.error) throw result.error;
  return result.data.signedUrl;
}

export async function exportFinanceBackup() {
  return rpc("finance_export");
}