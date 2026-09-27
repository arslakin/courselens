// RojLearn frontend configuration.
// (COURSELENS_CONFIG global key is retained as an internal/legacy identifier.)
//
// API_BASE_URL: the deployed API Gateway base URL (the ApiBaseUrl stack
//   output). This is the production default and is baked into the deployed
//   site.
//
// DEMO_MODE: when true, the app returns canned sample results locally with NO
//   backend/AWS calls — useful only for offline UI development. It must be
//   explicitly enabled. Production never sets this to true, so the deployed
//   site can never silently fall back to mock data: if the real API fails, the
//   student sees a clear error instead.
//
// To run the UI offline for local development, either set DEMO_MODE: true here
// temporarily, or open index.html with "?demo=1" in the URL.
window.COURSELENS_CONFIG = {
  API_BASE_URL: "https://dnc6ojmat7.execute-api.us-east-1.amazonaws.com",
  DEMO_MODE: false,
};
