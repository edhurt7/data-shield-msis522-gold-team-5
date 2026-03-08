

# Privacy Shield — Agentic Personal Data Removal Platform

## Authentication
- Google OAuth via Supabase Auth with "Continue with Google" button
- Clean, centered login page with shield branding
- First-login detection routes new users to onboarding

## Onboarding Flow (first login only)
- Single-page friendly form: first name, last name, choice of state dropdown OR date of birth
- Short explainer text and consent checkbox
- "Start My First Scan" CTA that triggers mock scan and redirects to dashboard

## Privacy Email System
- Auto-generated proxy email per user (e.g., shield-a7x29k@privacyshield.io)
- Displayed in profile/settings with copy button and tooltip explainer

## Pages & Layout
- **Desktop**: Sidebar navigation with shield logo
- **Mobile**: Bottom tab navigation
- Fully responsive, mobile-first

### 1. Scan Dashboard (main view)
- Summary bar: "12 sites scanned · 4 listings found · 2 removals submitted"
- Table of broker sites with columns: site name, status (Scanning / Found / Not Found / Opted Out / Failed) with color-coded badges
- Animated progress indicator during active scans
- All populated with realistic mock data (Spokeo, WhitePages, BeenVerified, etc.)

### 2. Listing Detail Panel
- Side panel (desktop) / bottom sheet (mobile) on clicking a "Found" row
- Shows: site name, discovered data fields as chips (address, phone, relatives), drafted opt-out message preview
- "Submit Removal" button

### 3. Conversational Chat Bar
- Persistent input at bottom of dashboard
- Message history above with mock responses
- Supports natural language commands (mock responses)

### 4. History / Activity Log Tab
- Table: date, site, action, status (Pending / Confirmed / Re-listed)
- Populated with mock historical data

### 5. Profile / Settings Page
- Proxy email with copy button and explainer
- View-only onboarding info (name, state/DOB)
- "Trigger Manual Re-scan" button

## Design System
- Light grey/white base with medium blue and steel blue accents
- Trustworthy, calm aesthetic (1Password/Bitwarden feel)
- Shield/lock motif in logo and empty states
- Clean typography, generous whitespace, subtle shadows

## Backend
- Supabase Auth (Google OAuth) + profiles table for onboarding data
- All scan/removal data is mock/client-side state for now
- No real backend logic yet

