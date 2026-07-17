// Supabase client for the cleaning-bids board.
// The anon key is meant to live in client-side code (it only grants what
// the table's Row-Level-Security policies allow). Do NOT put the
// service_role / secret key here.
const SUPABASE_URL = "https://vzmgzladckyagnrpqatb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6bWd6bGFkY2t5YWducnBxYXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyODI5MzIsImV4cCI6MjA5OTg1ODkzMn0.1BIoXOa_DT9Sxo2JovPfXdFPTjyGwYPLJbtvT5EA2lE";

// `supabase` is the global from the CDN <script>; createClient makes our client.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
