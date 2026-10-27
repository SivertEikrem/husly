// =====================================================================
// Husly – oppsett. Fylles ut én gang.
// Nøkkelen her er den offentlige (anon / publishable) nøkkelen. Den er
// trygg å ha i et offentlig repo, fordi Row Level Security i databasen
// bestemmer hva hver bruker får se. Lim ALDRI inn service_role-nøkkelen.
// =====================================================================

window.HUSLY_CONFIG = {
  supabaseUrl: 'https://DITT-PROSJEKT.supabase.co',
  supabaseAnonKey: 'LIM-INN-ANON-NØKKELEN-HER',
  contactEmail: 'trevis.eikrem@gmail.com'
};
