const { Client } = require('pg');
require('dotenv').config();

const names = [
  'student_certifications','student_competitions','student_hackathon_participations',
  'faculty_development_programs','faculty_certifications','faculty_research_projects',
  'faculty_research_project_members','faculty_patents','faculty_patent_inventors',
  'iqac_accreditation_criteria','iqac_accreditation_evidence_items'
];

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    [names]
  );
  const found = new Set(res.rows.map(r => r.table_name));
  for (const n of names) console.log(found.has(n) ? 'EXISTS' : 'missing', n);
  await client.end();
})();
