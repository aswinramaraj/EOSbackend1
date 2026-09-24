const axios = require("axios");
const API = "https://eosbackend1-weop.onrender.com/api/v1";

async function main() {
  const loginRes = await axios.post(`${API}/auth/login`, {
    email: "madhavan.c2023cse@sece.ac.in",
    password: "EOS@test123",
  });
  const { accessToken } = loginRes.data.data;
  console.log("login ok");

  const res = await axios.get(`${API}/me/academic-calendar`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  console.log("status:", res.status);
  console.log("response:", JSON.stringify(res.data, null, 2));
}
main().catch((err) => {
  console.error("FAILED:", err.response?.status, JSON.stringify(err.response?.data ?? err.message));
  process.exit(1);
});
