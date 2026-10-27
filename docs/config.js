// =====================================================================
// Husly – oppsett. Fylles ut én gang.
// Nøkkelen her er den offentlige (anon / publishable) nøkkelen. Den er
// trygg å ha i et offentlig repo, fordi Row Level Security i databasen
// bestemmer hva hver bruker får se. Lim ALDRI inn service_role-nøkkelen.
// =====================================================================

window.HUSLY_CONFIG = {
  supabaseUrl: 'https://hhqzrxxjivrpcamtkutz.supabase.co',
  supabaseAnonKey: 'sb_publishable_aKgvrlwl8Ny9OIguVEHbOA_tldZXO0t',
  contactEmail: 'trevis.eikrem@gmail.com'
};
