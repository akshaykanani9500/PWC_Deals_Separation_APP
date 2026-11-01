import 'dotenv/config';
import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 4000),
  dbDriver: (env.DB_DRIVER || 'local').toLowerCase() as 'local' | 'sheets',
  dataDir: path.resolve(env.DATA_DIR || './data'),
  googleSheetId: env.GOOGLE_SHEET_ID || '',
  googleCredentials: env.GOOGLE_APPLICATION_CREDENTIALS || './credentials/service-account.json',
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me-in-env',
  geminiApiKey: env.GEMINI_API_KEY || '',
  geminiModels: (env.GEMINI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
  appVersion: '1.0.0',
};

export type AppConfig = typeof config;
