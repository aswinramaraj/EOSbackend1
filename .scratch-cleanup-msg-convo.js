require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const convo = await client.query(
    "SELECT id, dm_key FROM message_conversations WHERE dm_key LIKE '%:%' AND id IN (SELECT conversation_id FROM message_participants WHERE user_id = (SELECT id FROM users WHERE email = 'uday.u.cs4@sece.ac.in'))",
  );
  console.log("candidate conversations involving Uday Rajan:", convo.rows);

  for (const row of convo.rows) {
    const messages = await client.query("SELECT id, body, is_deleted_for_everyone FROM messages WHERE conversation_id = $1", [row.id]);
    console.log(`conversation ${row.id} messages:`, messages.rows);
  }

  await client.end();
}
main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
