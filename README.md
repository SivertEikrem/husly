# Husly

Kollektivet samlet på ett sted: beskjeder, felles utgifter, kalender, vaskeliste, handleliste og info om huset.

- **Frontend:** statiske sider i `docs/` på GitHub Pages (HTML, CSS og JS uten byggesteg)
- **Backend:** Supabase (innlogging, database med Row Level Security, sanntid)

## Filer

```
docs/
  index.html        Forside med innlogging og ny konto
  app.html          Selve appen (alle sidene)
  app.js            All logikk for appen
  auth.html         Bekreft e-post og lag nytt passord
  personvern.html   Personvernerklæring
  common.js         Felles kode: tema, norske datoer, kroner, ikoner, dialoger
  style.css         Alt utseende. Fargene er variabler i :root
  config.js         Supabase-URL og anon-nøkkel (fylles ut én gang)
  favicon.svg       Ikonet i fanen
supabase/
  schema.sql        Hele databasen. Endringer kommer som 002_..., 003_...
```

## Oppsett

### 1. Supabase-prosjekt
1. Gå til supabase.com → **New project**. Velg region **Stockholm (eu-north-1)**.
2. Når prosjektet er klart: **SQL Editor** → **New query**.
3. Lim inn hele `supabase/schema.sql` → **Run**. Det skal stå «Success».

### 2. Fyll inn config.js
1. I Supabase: **Project Settings** → **API Keys** (eller **API**).
2. Kopier **Project URL** og **anon / publishable**-nøkkelen.
3. Lim dem inn i `docs/config.js`. Bruk aldri `service_role`- eller secret-nøkkelen.

### 3. GitHub
1. Lag et nytt **offentlig** repo, f.eks. `husly`.
2. **Add file** → **Upload files** → dra inn mappene `docs` og `supabase` (eller lag filene én og én med **Create new file**).
3. **Commit changes**.
4. **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main`, mappe `/docs` → **Save**.
5. Etter et minutt ligger siden på `https://siverteikrem.github.io/husly/`.

### 4. Innlogging i Supabase
1. **Authentication** → **URL Configuration**:
   - **Site URL:** `https://siverteikrem.github.io/husly` (uten skråstrek til slutt)
   - **Redirect URLs:** legg til `https://siverteikrem.github.io/husly/**`
2. **Authentication** → **Email Templates** → **Confirm signup**. Bytt lenken i malen til:
   ```
   {{ .SiteURL }}/auth.html?token_hash={{ .TokenHash }}&type=email
   ```
3. Samme sted → **Reset password**. Bytt lenken til:
   ```
   {{ .SiteURL }}/auth.html?token_hash={{ .TokenHash }}&type=recovery
   ```
4. (Valgfritt) **Authentication** → **Sign In / Providers** → Email: sett minste passordlengde til 8.

### 5. Test
1. Åpne siden → **Ny konto** → bekreft e-posten.
2. Opprett et kollektiv. Du havner på **Huset**, der invitasjonskoden og lenken ligger.
3. Send lenken til en husfelle.

## Egen domene (senere)
1. Hos Domeneshop: lag en CNAME-post for f.eks. `www` som peker til `siverteikrem.github.io`.
2. GitHub → **Settings** → **Pages** → **Custom domain**.
3. Oppdater **Site URL** og **Redirect URLs** i Supabase til det nye domenet.

## Sikkerhet i korte trekk
- Row Level Security på alle tabeller. Du ser bare data fra kollektiv du er medlem av.
- Invitasjonskoder, roller og medlemskap kan bare endres via databasefunksjoner som sjekker tilgang.
- Noen kolonner, som invitasjonskoden, kan ikke endres direkte fra nettsiden.
- Sletting av konto skjer i databasen (`delete_my_account`) og fjerner alt brukeren har lagt inn.

## Merk
Supabase sin innebygde e-post sender bare noen få e-poster i timen. Når flere skal bruke siden, bør du legge inn egen SMTP under **Authentication** → **Emails** → **SMTP Settings**.
