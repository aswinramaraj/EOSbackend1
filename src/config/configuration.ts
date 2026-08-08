export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'appraisal-attachments',
  },

  app: {
    name: 'EOS Backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  },
});
