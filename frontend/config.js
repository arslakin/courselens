// CourseLens frontend configuration.
//
// Set API_BASE_URL to the deployed API Gateway base URL after `sam deploy`
// (the ApiBaseUrl stack output), e.g.:
//   "https://abc123.execute-api.us-east-1.amazonaws.com"
//
// Leaving it empty makes the app run in DEMO MODE: it returns canned sample
// results locally so the UI (and My Notes) can be exercised end-to-end without
// any backend or AWS calls. This is what the local walkthrough uses.
window.COURSELENS_CONFIG = {
  API_BASE_URL: "",
};
