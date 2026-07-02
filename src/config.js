require("dotenv").config();

const requiredInProduction = [
  "APP_BASE_URL",
  "SESSION_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_WEBHOOK_SECRET",
  "SLACK_WEBHOOK_URL"
];

if (process.env.NODE_ENV === "production") {
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = {
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || "dev-only-change-me",
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "dev-webhook-secret"
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || ""
  },
  databaseUrl: process.env.DATABASE_URL || ""
};
